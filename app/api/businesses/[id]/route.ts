import { and, eq, isNull, ne } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { businesses, opportunities } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import { cleanText, normalizeText } from "../../../lib/crm";
import {
  inferCustomerType,
  normalizeRnc,
  validateCustomerIdentity,
} from "../../../lib/source-domain";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, id), isNull(businesses.archivedAt)))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Business no encontrado." }, { status: 404 });
  }
  const query = async (sqlText: string) =>
    (await getD1().prepare(sqlText).bind(id).all<Record<string, unknown>>())
      .results ?? [];
  const queryTwice = async (sqlText: string) =>
    (await getD1().prepare(sqlText).bind(id, id).all<Record<string, unknown>>())
      .results ?? [];
  const [
    relatedContacts,
    projects,
    relatedOpportunities,
    invoices,
    quotations,
    payments,
    addresses,
    documents,
    history,
  ] = await Promise.all([
    query(`SELECT id, name, email, phone, mobile_phone AS mobilePhone, title
      FROM contacts WHERE business_id = ? AND archived_at IS NULL
      ORDER BY name LIMIT 250`),
    query(`SELECT id, name, service_category AS serviceCategory, status,
      updated_at AS updatedAt FROM projects
      WHERE business_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 250`),
    query(`SELECT id, title, stage, outcome, estimated_value AS estimatedValue,
      expected_close_date AS expectedCloseDate FROM opportunities
      WHERE business_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 250`),
    query(`SELECT id, invoice_number_raw AS invoiceNumber, status, currency,
      total_amount AS totalAmount, balance_amount_snapshot AS balanceAmountSnapshot,
      issue_date AS issueDate, due_date AS dueDate
      FROM invoices WHERE business_id = ? AND archived_at IS NULL
      ORDER BY COALESCE(issue_date, updated_at) DESC LIMIT 250`),
    query(`SELECT q.id, q.quotation_number AS quotationNumber, q.title, q.status,
      q.currency, q.updated_at AS updatedAt,
      (SELECT source_total FROM quotation_financials f
       JOIN quotation_revisions r ON r.id = f.revision_id
       WHERE r.quotation_id = q.id ORDER BY r.is_current DESC,
       r.revision_number DESC LIMIT 1) AS sourceTotal
      FROM quotations q WHERE q.business_id = ? AND q.archived_at IS NULL
      ORDER BY q.updated_at DESC LIMIT 250`),
    query(`SELECT id, type, amount, currency, payment_date AS paymentDate,
      method, status, label FROM payments
      WHERE business_id = ? ORDER BY COALESCE(payment_date, created_at) DESC LIMIT 250`),
    query(`SELECT id, type, label, line1, line2, city, province,
      country, is_primary AS isPrimary FROM addresses
      WHERE business_id = ? LIMIT 250`),
    query(`SELECT DISTINCT d.id, d.name, d.content_type AS contentType,
      d.size, d.extension, dl.purpose, dl.created_at AS linkedAt
      FROM documents d JOIN document_links dl ON dl.document_id = d.id
      JOIN quotation_revisions r ON r.id = dl.entity_id
        AND dl.entity_type = 'quotation_revision'
      JOIN quotations q ON q.id = r.quotation_id
      WHERE q.business_id = ? ORDER BY dl.created_at DESC LIMIT 250`),
    queryTwice(`SELECT entity_type AS entityType, entity_id AS entityId, action,
      actor_email AS actorEmail, reason, created_at AS createdAt
      FROM entity_history
      WHERE (entity_type = 'business' AND entity_id = ?)
         OR entity_id IN (
           SELECT r.id FROM quotation_revisions r
           JOIN quotations q ON q.id = r.quotation_id
           WHERE q.business_id = ?
         )
      ORDER BY created_at DESC LIMIT 250`),
  ]);
  return Response.json(
    {
      business,
      contacts: relatedContacts,
      projects,
      opportunities: relatedOpportunities,
      invoices,
      quotations,
      payments,
      addresses,
      documents,
      history,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [current] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, id), isNull(businesses.archivedAt)))
    .limit(1);
  if (!current) {
    return Response.json({ error: "Business no encontrado." }, { status: 404 });
  }
  const name = cleanText(payload.name, 180);
  const normalizedName = normalizeText(name);
  const rnc = Object.hasOwn(payload, "rnc") ? payload.rnc : current.rnc;
  const customerType =
    payload.customerType ??
    current.customerType ??
    inferCustomerType(name, rnc);
  const identity = validateCustomerIdentity({
    name,
    type: customerType,
    rnc,
  });
  if (identity.errors.length) {
    return Response.json(
      { error: identity.errors[0], errors: identity.errors },
      { status: 400 },
    );
  }

  const [duplicate] = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(
      and(
        eq(businesses.normalizedName, normalizedName),
        ne(businesses.id, id),
        isNull(businesses.archivedAt),
      ),
    )
    .limit(1);
  if (duplicate && payload.confirmDuplicate !== true) {
    return Response.json(
      { error: "Ya existe otro Business con ese nombre.", duplicate },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const [business] = await db
    .update(businesses)
    .set({
      name,
      normalizedName,
      customerType: identity.type!,
      rnc: cleanText(rnc, 30),
      normalizedRnc: normalizeRnc(rnc),
      email: cleanText(payload.email, 180),
      phone: cleanText(payload.phone, 60),
      mobilePhone: Object.hasOwn(payload, "mobilePhone")
        ? cleanText(payload.mobilePhone, 60)
        : current.mobilePhone,
      address: cleanText(payload.address, 300),
      notes: cleanText(payload.notes, 4000),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      updatedAt: now,
    })
    .where(and(eq(businesses.id, id), isNull(businesses.archivedAt)))
    .returning();
  if (!business) {
    return Response.json({ error: "Business no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "update", "business", id, name),
    upsertSearchDocument({
      entityType: "business",
      entityId: id,
      title: name,
      subtitle: business.rnc || business.email || business.phone,
      searchText: `${name} ${business.rnc} ${business.email} ${business.phone} ${business.mobilePhone} ${business.address} ${business.notes}`,
      ownerEmail: business.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ business });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const db = getDb();
  const [activeOpportunity] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(eq(opportunities.businessId, id), isNull(opportunities.archivedAt)),
    )
    .limit(1);
  if (activeOpportunity) {
    return Response.json(
      { error: "No se puede archivar un Business con Opportunities activas." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const [business] = await db
    .update(businesses)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(businesses.id, id), isNull(businesses.archivedAt)))
    .returning();
  if (!business) {
    return Response.json({ error: "Business no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "archive", "business", id, business.name),
    deleteSearchDocument("business", id),
  ]);
  return Response.json({ ok: true });
}
