import { and, asc, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { businesses, contacts, opportunities } from "../../../db/schema";
import { authorizeApi } from "../../lib/authorization";
import {
  cleanText,
  nonNegativeNumber,
  optionalIsoDate,
} from "../../lib/crm";
import { searchDocumentStatement } from "../../lib/search";

export async function GET() {
  const auth = await authorizeApi({ module: "oportunidades", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(opportunities)
    .where(isNull(opportunities.archivedAt))
    .orderBy(asc(opportunities.title))
    .limit(500);
  return Response.json({ opportunities: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "oportunidades", action: "create" });
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as Record<string, unknown>;
  const title = cleanText(payload.title, 200);
  const businessId = cleanText(payload.businessId, 80);
  const primaryContactId = cleanText(payload.primaryContactId, 80) || null;
  if (!title || !businessId) {
    return Response.json(
      { error: "Title y Business son obligatorios." },
      { status: 400 },
    );
  }

  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Business no encontrado." }, { status: 400 });
  }

  let contact = null;
  if (primaryContactId) {
    [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.id, primaryContactId), isNull(contacts.archivedAt)),
      )
      .limit(1);
    if (!contact || (contact.businessId && contact.businessId !== businessId)) {
      return Response.json(
        { error: "Primary Contact no pertenece al Business seleccionado." },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const opportunity = {
    id: crypto.randomUUID(),
    title,
    businessId,
    primaryContactId,
    relatedLeadId: null,
    stage: "evaluation" as const,
    outcome: null,
    estimatedValue: nonNegativeNumber(payload.estimatedValue),
    expectedCloseDate: optionalIsoDate(payload.expectedCloseDate),
    lossReason: "",
    ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
    notes: cleanText(payload.notes, 4000),
    closedAt: null,
    closedBy: null,
    createdBy: auth.user.email,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO opportunities (
          id, title, business_id, primary_contact_id, stage, estimated_value,
          expected_close_date, owner_email, notes, created_by, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'evaluation', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        opportunity.id,
        title,
        businessId,
        primaryContactId,
        opportunity.estimatedValue,
        opportunity.expectedCloseDate,
        opportunity.ownerEmail,
        opportunity.notes,
        auth.user.email,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO opportunity_stage_history
          (opportunity_id, from_stage, to_stage, changed_by, changed_at, note)
         VALUES (?, NULL, 'evaluation', ?, ?, 'Opportunity creada')`,
      )
      .bind(opportunity.id, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'create', 'opportunity', ?, ?, ?)`,
      )
      .bind(auth.user.email, opportunity.id, title, now),
    searchDocumentStatement({
      entityType: "opportunity",
      entityId: opportunity.id,
      title,
      subtitle: business.name,
      searchText: `${title} ${business.name} ${contact?.name ?? ""} ${opportunity.notes} Evaluation`,
      ownerEmail: opportunity.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({ opportunity }, { status: 201 });
}
