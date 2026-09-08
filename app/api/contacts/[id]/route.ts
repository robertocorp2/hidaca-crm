import { and, eq, isNull, ne, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { businesses, contacts, opportunities } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from "../../../lib/crm";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "contactos", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
    .limit(1);
  if (!contact) {
    return Response.json({ error: "Contact no encontrado." }, { status: 404 });
  }
  const query = async (sqlText: string) =>
    (await getD1().prepare(sqlText).bind(id, id).all<Record<string, unknown>>())
      .results ?? [];
  const queryOne = async (sqlText: string) =>
    (await getD1().prepare(sqlText).bind(id).all<Record<string, unknown>>())
      .results ?? [];
  const queryMany = async (sqlText: string, ...bindings: string[]) =>
    (await getD1().prepare(sqlText).bind(...bindings).all<Record<string, unknown>>())
      .results ?? [];
  const [business, projects, opportunities, quotations, invoices, documents, sourceDocuments, cases, history] = await Promise.all([
    queryOne(`SELECT b.id, b.name, b.customer_type AS customerType, b.rnc,
      b.email, b.phone, b.mobile_phone AS mobilePhone, b.address,
      b.owner_email AS ownerEmail, b.updated_at AS updatedAt
      FROM businesses b JOIN contacts c ON c.business_id = b.id
      WHERE c.id = ? AND b.archived_at IS NULL LIMIT 1`),
    query(
      `SELECT DISTINCT p.id, p.name, p.status,
        p.service_category AS serviceCategory, pc.role,
        pc.is_primary AS isPrimary
       FROM projects p
       LEFT JOIN project_contacts pc ON pc.project_id = p.id
       WHERE p.archived_at IS NULL
         AND (p.primary_contact_id = ? OR pc.contact_id = ?)
       ORDER BY p.updated_at DESC LIMIT 250`,
    ),
    queryOne(
      `SELECT id, title, stage, outcome, estimated_value AS estimatedValue,
        expected_close_date AS expectedCloseDate, updated_at AS updatedAt
       FROM opportunities
       WHERE primary_contact_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 250`,
    ),
    query(
      `SELECT q.id, q.quotation_number AS quotationNumber, q.title, q.status,
        q.currency, r.quotation_date AS quotationDate,
        f.source_total AS sourceTotal
       FROM quotations q
       LEFT JOIN project_contacts pc ON pc.project_id = q.project_id
       LEFT JOIN quotation_revisions r ON r.id = (
         SELECT qr.id FROM quotation_revisions qr
         WHERE qr.quotation_id = q.id
         ORDER BY qr.is_current DESC, qr.revision_number DESC LIMIT 1
       )
       LEFT JOIN quotation_financials f ON f.revision_id = r.id
       WHERE q.archived_at IS NULL
         AND (q.primary_contact_id = ? OR pc.contact_id = ?)
       ORDER BY coalesce(r.quotation_date, q.updated_at) DESC LIMIT 250`,
    ),
    queryOne(
      `SELECT i.id, i.invoice_number_raw AS invoiceNumberRaw,
        i.status, i.issue_date AS issueDate, i.due_date AS dueDate,
        i.currency, i.total_amount AS totalAmount,
        i.balance_amount_snapshot AS balanceAmount,
        i.updated_at AS updatedAt
       FROM invoices i
       WHERE i.contact_id = ? AND i.archived_at IS NULL
       ORDER BY COALESCE(i.issue_date, i.created_at) DESC LIMIT 250`,
    ),
    queryMany(`SELECT DISTINCT d.id, d.name, d.content_type AS contentType,
        d.size, d.extension, dl.purpose, dl.created_at AS linkedAt
       FROM documents d JOIN document_links dl ON dl.document_id = d.id
       WHERE (dl.entity_type IN ('contact', 'contacts') AND dl.entity_id = ?)
          OR (dl.entity_type = 'business' AND dl.entity_id = (SELECT business_id FROM contacts WHERE id = ?))
          OR (dl.entity_type = 'project' AND dl.entity_id IN (
            SELECT p.id FROM projects p LEFT JOIN project_contacts pc ON pc.project_id = p.id
            WHERE p.primary_contact_id = ? OR pc.contact_id = ?
          ))
          OR (dl.entity_type = 'opportunity' AND dl.entity_id IN (
            SELECT o.id FROM opportunities o WHERE o.primary_contact_id = ?
               OR o.business_id = (SELECT business_id FROM contacts WHERE id = ?)
          ))
          OR (dl.entity_type = 'quotation' AND dl.entity_id IN (
            SELECT q.id FROM quotations q LEFT JOIN project_contacts pc ON pc.project_id = q.project_id
            WHERE q.primary_contact_id = ? OR pc.contact_id = ?
               OR q.business_id = (SELECT business_id FROM contacts WHERE id = ?)
          ))
          OR (dl.entity_type = 'quotation_revision' AND dl.entity_id IN (
            SELECT r.id FROM quotation_revisions r JOIN quotations q ON q.id = r.quotation_id
            LEFT JOIN project_contacts pc ON pc.project_id = q.project_id
            WHERE q.primary_contact_id = ? OR pc.contact_id = ?
               OR q.business_id = (SELECT business_id FROM contacts WHERE id = ?)
          ))
          OR (dl.entity_type = 'invoice' AND dl.entity_id IN (
            SELECT i.id FROM invoices i WHERE i.contact_id = ?
               OR i.business_id = (SELECT business_id FROM contacts WHERE id = ?)
          ))
       ORDER BY linkedAt DESC LIMIT 250`, id, id, id, id, id, id, id, id, id, id, id, id, id, id),
    queryMany(`SELECT NULL AS id, sr.original_filename AS name, NULL AS contentType,
      NULL AS size, NULL AS extension, 'source' AS purpose, sr.created_at AS linkedAt,
      sr.original_uri AS originalUri, sr.availability
      FROM source_references sr
      WHERE sr.original_filename <> '' AND sr.revision_id IN (
        SELECT r.id FROM quotation_revisions r JOIN quotations q ON q.id = r.quotation_id
        LEFT JOIN project_contacts pc ON pc.project_id = q.project_id
        WHERE q.primary_contact_id = ? OR pc.contact_id = ?
           OR q.business_id = (SELECT business_id FROM contacts WHERE id = ?)
      )
      ORDER BY sr.created_at DESC LIMIT 250`, id, id, id),
    queryOne(
      `SELECT id, title, status, customer_name AS customerName,
        contact, amount, balance, due_date AS dueDate,
        created_at AS createdAt, updated_at AS updatedAt
       FROM business_records
       WHERE module = 'ordenes-cambio' AND archived_at IS NULL
         AND contact = (SELECT name FROM contacts WHERE id = ?)
       ORDER BY updated_at DESC LIMIT 250`,
    ),
    query(
      `SELECT action, actor_email AS actorEmail, reason,
        created_at AS createdAt
       FROM entity_history
       WHERE (entity_type = 'contact' AND entity_id = ?)
          OR entity_id IN (
            SELECT r.id FROM quotation_revisions r
            JOIN quotations q ON q.id = r.quotation_id
            WHERE q.primary_contact_id = ?
          )
       ORDER BY created_at DESC LIMIT 250`,
    ),
  ]);
  const mergedDocuments = [...documents, ...sourceDocuments].filter((item, index, all) => {
    const key = String(item.id ?? item.originalUri ?? `${item.name}:${item.linkedAt}`);
    return all.findIndex((candidate) => String(candidate.id ?? candidate.originalUri ?? `${candidate.name}:${candidate.linkedAt}`) === key) === index;
  });
  return Response.json(
    {
      contact,
      business: business[0] ?? null,
      projects,
      opportunities,
      quotations,
      invoices,
      documents: mergedDocuments,
      cases,
      history,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "contactos", action: "edit" });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [current] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
    .limit(1);
  if (!current) {
    return Response.json({ error: "Contact no encontrado." }, { status: 404 });
  }
  const name = cleanText(payload.name, 180);
  const email = cleanText(payload.email, 180);
  const phone = cleanText(payload.phone, 60);
  const mobilePhone = Object.hasOwn(payload, "mobilePhone")
    ? cleanText(payload.mobilePhone, 60)
    : current.mobilePhone;
  const businessId = cleanText(payload.businessId, 80) || null;
  if (!name) {
    return Response.json(
      { error: "Contact Name es obligatorio." },
      { status: 400 },
    );
  }

  if (businessId) {
    const [business] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
      .limit(1);
    if (!business) {
      return Response.json(
        { error: "El Business relacionado no existe." },
        { status: 400 },
      );
    }
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const normalizedMobilePhone = normalizePhone(mobilePhone);
  const duplicateMatch = [];
  if (normalizedEmail)
    duplicateMatch.push(eq(contacts.normalizedEmail, normalizedEmail));
  if (normalizedPhone)
    duplicateMatch.push(eq(contacts.normalizedPhone, normalizedPhone));
  if (normalizedMobilePhone)
    duplicateMatch.push(
      eq(contacts.normalizedMobilePhone, normalizedMobilePhone),
    );
  if (duplicateMatch.length) {
    const [duplicate] = await db
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(
        and(
          or(...duplicateMatch),
          ne(contacts.id, id),
          isNull(contacts.archivedAt),
        ),
      )
      .limit(1);
    if (duplicate && payload.confirmDuplicate !== true) {
      return Response.json(
        {
          error: "Ya existe otro Contact con ese correo o teléfono.",
          duplicate,
        },
        { status: 409 },
      );
    }
  }

  const now = new Date().toISOString();
  const [contact] = await db
    .update(contacts)
    .set({
      businessId,
      name,
      normalizedName: normalizeText(name),
      email,
      normalizedEmail,
      phone,
      normalizedPhone,
      mobilePhone,
      normalizedMobilePhone,
      title: cleanText(payload.title, 140),
      notes: cleanText(payload.notes, 4000),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      updatedAt: now,
    })
    .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
    .returning();
  if (!contact) {
    return Response.json({ error: "Contact no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "update", "contact", id, name),
    upsertSearchDocument({
      entityType: "contact",
      entityId: id,
      title: name,
      subtitle: contact.email || contact.mobilePhone || contact.phone,
      searchText: `${name} ${contact.email} ${contact.phone} ${contact.mobilePhone} ${contact.title} ${contact.notes}`,
      ownerEmail: contact.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ contact });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "contactos", action: "delete" });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const db = getDb();
  const [activeOpportunity] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.primaryContactId, id),
        isNull(opportunities.archivedAt),
      ),
    )
    .limit(1);
  if (activeOpportunity) {
    return Response.json(
      { error: "No se puede archivar un Contact vinculado a Opportunities." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const [contact] = await db
    .update(contacts)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
    .returning();
  if (!contact) {
    return Response.json({ error: "Contact no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "archive", "contact", id, contact.name),
    deleteSearchDocument("contact", id),
  ]);
  return Response.json({ ok: true });
}
