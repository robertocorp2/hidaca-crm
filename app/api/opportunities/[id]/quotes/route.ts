import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  businessRecords,
  businesses,
  contacts,
  opportunities,
  opportunityQuotes,
} from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { cleanText, nonNegativeNumber } from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const quotes = await getDb()
    .select({ quote: businessRecords })
    .from(opportunityQuotes)
    .innerJoin(
      businessRecords,
      eq(opportunityQuotes.quoteRecordId, businessRecords.id),
    )
    .where(
      and(
        eq(opportunityQuotes.opportunityId, id),
        isNull(businessRecords.archivedAt),
      ),
    );
  return Response.json({ quotes: quotes.map((row) => row.quote) });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [opportunity] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .limit(1);
  if (!opportunity) {
    return Response.json(
      { error: "Opportunity no encontrada." },
      { status: 404 },
    );
  }

  if (payload.quoteRecordId) {
    const quoteRecordId = cleanText(payload.quoteRecordId, 80);
    const [quote] = await db
      .select()
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.id, quoteRecordId),
          eq(businessRecords.module, "cotizaciones"),
          isNull(businessRecords.archivedAt),
        ),
      )
      .limit(1);
    if (!quote) {
      return Response.json(
        { error: "Quote existente no encontrada." },
        { status: 400 },
      );
    }
    await db
      .insert(opportunityQuotes)
      .values({
        opportunityId: id,
        quoteRecordId,
        createdBy: auth.user.email,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    return Response.json({ quote }, { status: 201 });
  }

  const title = cleanText(payload.title, 200);
  if (!title) {
    return Response.json(
      { error: "Quote Title es obligatorio." },
      { status: 400 },
    );
  }
  const [[business], [contact]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(eq(businesses.id, opportunity.businessId))
      .limit(1),
    opportunity.primaryContactId
      ? db
          .select()
          .from(contacts)
          .where(eq(contacts.id, opportunity.primaryContactId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  if (!business) {
    return Response.json(
      { error: "El Business de la Opportunity no está disponible." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const quote = {
    id: crypto.randomUUID(),
    module: "cotizaciones",
    title,
    status: cleanText(payload.status, 60) || "Pendiente",
    customerName: business.name,
    contact: contact?.name ?? "",
    amount: nonNegativeNumber(payload.amount),
    balance: nonNegativeNumber(payload.amount),
    dueDate: cleanText(payload.dueDate, 40) || null,
    notes: cleanText(payload.notes, 4000),
    metadata: JSON.stringify({ opportunityId: id }),
    createdBy: auth.user.email,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO business_records (
          id, module, title, status, customer_name, contact, amount, balance,
          due_date, notes, metadata, created_by, created_at, updated_at
        ) VALUES (?, 'cotizaciones', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        quote.id,
        quote.title,
        quote.status,
        quote.customerName,
        quote.contact,
        quote.amount,
        quote.balance,
        quote.dueDate,
        quote.notes,
        quote.metadata,
        quote.createdBy,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO opportunity_quotes
          (opportunity_id, quote_record_id, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, quote.id, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'create_from_opportunity', 'quote', ?, ?, ?)`,
      )
      .bind(auth.user.email, quote.id, id, now),
    searchDocumentStatement({
      entityType: "quote",
      entityId: quote.id,
      title: quote.title,
      subtitle: business.name,
      searchText: `${quote.title} ${business.name} ${quote.contact} ${quote.notes}`,
      ownerEmail: auth.user.email,
      updatedAt: now,
    }),
  ]);

  return Response.json({ quote }, { status: 201 });
}
