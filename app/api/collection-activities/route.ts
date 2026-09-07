import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  businesses,
  collectionActivities,
  invoices,
} from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeInvoiceApi } from "../../lib/invoice-api";
import {
  collectionActivityTypes,
  enumValue,
  optionalAmount,
} from "../../lib/invoice-domain";
import { cleanText } from "../../lib/crm";

export async function GET(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "cobranza" });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const invoiceId = (url.searchParams.get("invoiceId") ?? "").trim();
  const activities =
    (
      await getD1()
        .prepare(
          `SELECT ca.id, ca.invoice_id AS invoiceId,
             i.invoice_number_raw AS invoiceNumberRaw,
             ca.business_id AS businessId, b.name AS businessName,
             ca.activity_type AS activityType, ca.occurred_at AS occurredAt,
             ca.next_action_at AS nextActionAt, ca.owner_email AS ownerEmail,
             ca.outcome, ca.promised_amount AS promisedAmount,
             ca.promised_date AS promisedDate, ca.notes
           FROM collection_activities ca
           JOIN invoices i ON i.id = ca.invoice_id
           JOIN businesses b ON b.id = ca.business_id
           WHERE ca.archived_at IS NULL AND (? = '' OR ca.invoice_id = ?)
           ORDER BY ca.occurred_at DESC LIMIT 500`,
        )
        .bind(invoiceId, invoiceId)
        .all()
    ).results ?? [];
  return Response.json({ activities });
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "cobranza", write: true, action: "create" });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const invoiceId = cleanText(payload.invoiceId, 80);
  const occurredAt =
    cleanText(payload.occurredAt, 40) || new Date().toISOString();
  if (!invoiceId) {
    return Response.json(
      { error: "La factura es obligatoria." },
      { status: 400 },
    );
  }
  const db = getDb();
  const [invoice] = await db
    .select({ id: invoices.id, businessId: invoices.businessId })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)))
    .limit(1);
  if (!invoice) {
    return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  }
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, invoice.businessId))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Empresa no encontrada." }, { status: 404 });
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [activity] = await db
    .insert(collectionActivities)
    .values({
      id,
      invoiceId,
      businessId: invoice.businessId,
      contactId: cleanText(payload.contactId, 80) || null,
      activityType: enumValue(
        payload.activityType,
        collectionActivityTypes,
        "note",
      ),
      occurredAt,
      nextActionAt: cleanText(payload.nextActionAt, 40) || null,
      ownerEmail: cleanText(payload.ownerEmail, 254) || auth.user.email,
      outcome: cleanText(payload.outcome, 1000),
      promisedAmount: optionalAmount(payload.promisedAmount),
      promisedDate: cleanText(payload.promisedDate, 20) || null,
      notes: cleanText(payload.notes, 4000),
      sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await writeAudit(
    auth.user.email,
    "create",
    "collection_activity",
    id,
    activity.activityType,
  );
  return Response.json({ activity }, { status: 201 });
}
