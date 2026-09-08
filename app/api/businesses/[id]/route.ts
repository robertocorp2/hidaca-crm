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
  const auth = await authorizeApi({ module: "clientes", action: "view" });
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
  const queryMany = async (sqlText: string, ...bindings: string[]) =>
    (await getD1().prepare(sqlText).bind(...bindings).all<Record<string, unknown>>())
      .results ?? [];
  const queryTwice = async (sqlText: string) =>
    (await getD1().prepare(sqlText).bind(id, id).all<Record<string, unknown>>())
      .results ?? [];
  const [
    relatedContacts,
    projects,
    relatedOpportunities,
    quotations,
    invoices,
    payments,
    addresses,
    documents,
    sourceDocuments,
    cases,
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
    query(`SELECT q.id, q.quotation_number AS quotationNumber, q.title, q.status,
      q.currency, q.updated_at AS updatedAt,
      (SELECT source_total FROM quotation_financials f
       JOIN quotation_revisions r ON r.id = f.revision_id
       WHERE r.quotation_id = q.id ORDER BY r.is_current DESC,
       r.revision_number DESC LIMIT 1) AS sourceTotal
      FROM quotations q WHERE q.business_id = ? AND q.archived_at IS NULL
      ORDER BY q.updated_at DESC LIMIT 250`),
    query(`SELECT i.id, i.invoice_number_raw AS invoiceNumberRaw,
      i.status, i.issue_date AS issueDate, i.due_date AS dueDate,
      i.currency, i.total_amount AS totalAmount,
      i.balance_amount_snapshot AS balanceAmount,
      i.updated_at AS updatedAt
      FROM invoices i WHERE i.business_id = ? AND i.archived_at IS NULL
      ORDER BY COALESCE(i.issue_date, i.created_at) DESC LIMIT 250`),
    query(`SELECT id, type, amount, currency, payment_date AS paymentDate,
      method, status, label FROM payments
      WHERE business_id = ? ORDER BY COALESCE(payment_date, created_at) DESC LIMIT 250`),
    query(`SELECT id, type, label, line1, line2, city, province,
      country, is_primary AS isPrimary FROM addresses
      WHERE business_id = ? LIMIT 250`),
    queryMany(`SELECT DISTINCT d.id, d.name, d.content_type AS contentType,
      d.size, d.extension, dl.purpose, dl.created_at AS linkedAt
      FROM documents d JOIN document_links dl ON dl.document_id = d.id
      WHERE (dl.entity_type IN ('business', 'businesses', 'empresa') AND dl.entity_id = ?)
         OR (dl.entity_type = 'contact' AND dl.entity_id IN (SELECT id FROM contacts WHERE business_id = ?))
         OR (dl.entity_type = 'project' AND dl.entity_id IN (SELECT id FROM projects WHERE business_id = ?))
         OR (dl.entity_type = 'opportunity' AND dl.entity_id IN (SELECT id FROM opportunities WHERE business_id = ?))
         OR (dl.entity_type = 'quotation' AND dl.entity_id IN (SELECT id FROM quotations WHERE business_id = ?))
         OR (dl.entity_type = 'quotation_revision' AND dl.entity_id IN (
           SELECT r.id FROM quotation_revisions r JOIN quotations q ON q.id = r.quotation_id WHERE q.business_id = ?
         ))
         OR (dl.entity_type = 'invoice' AND dl.entity_id IN (SELECT id FROM invoices WHERE business_id = ?))
         OR (dl.entity_type = 'payment' AND dl.entity_id IN (SELECT id FROM payments WHERE business_id = ?))
         OR d.id IN (SELECT source_document_id FROM invoices WHERE business_id = ? AND source_document_id IS NOT NULL)
      ORDER BY linkedAt DESC LIMIT 250`, id, id, id, id, id, id, id, id, id),
    queryMany(`SELECT NULL AS id, sr.original_filename AS name, NULL AS contentType,
      NULL AS size, NULL AS extension, 'source' AS purpose, sr.created_at AS linkedAt,
      sr.original_uri AS originalUri, sr.availability
      FROM source_references sr
      WHERE sr.original_filename <> '' AND sr.revision_id IN (
        SELECT r.id FROM quotation_revisions r JOIN quotations q ON q.id = r.quotation_id WHERE q.business_id = ?
      )
      ORDER BY sr.created_at DESC LIMIT 250`, id),
    query(`SELECT id, title, status, customer_name AS customerName,
      contact, amount, balance, due_date AS dueDate,
      created_at AS createdAt, updated_at AS updatedAt
      FROM business_records
      WHERE module = 'ordenes-cambio' AND archived_at IS NULL
        AND customer_name = (SELECT name FROM businesses WHERE id = ?)
      ORDER BY updated_at DESC LIMIT 250`),
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
  const mergedDocuments = [...documents, ...sourceDocuments].filter((item, index, all) => {
    const key = String(item.id ?? item.originalUri ?? `${item.name}:${item.linkedAt}`);
    return all.findIndex((candidate) => String(candidate.id ?? candidate.originalUri ?? `${candidate.name}:${candidate.linkedAt}`) === key) === index;
  });
  return Response.json(
    {
      business,
      contacts: relatedContacts,
      projects,
      opportunities: relatedOpportunities,
      quotations,
      invoices,
      payments,
      addresses,
      documents: mergedDocuments,
      cases,
      history,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "clientes", action: "edit" });
  if (!auth.ok) return auth.response;

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
  const auth = await authorizeApi({ module: "clientes", action: "delete" });
  if (!auth.ok) return auth.response;

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
