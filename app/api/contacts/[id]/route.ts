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
  const auth = await authorizeApi();
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
  const [projects, quotations, opportunities, invoices, documents, history] = await Promise.all([
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
      `SELECT o.id, o.title, o.stage, o.outcome,
        o.estimated_value AS estimatedValue,
        o.expected_close_date AS expectedCloseDate
       FROM opportunities o
       WHERE o.primary_contact_id = ? AND o.archived_at IS NULL
       ORDER BY o.updated_at DESC LIMIT 250`,
    ),
    queryOne(
      `SELECT id, invoice_number_raw AS invoiceNumber, status, currency,
        total_amount AS totalAmount, balance_amount_snapshot AS balanceAmountSnapshot,
        issue_date AS issueDate, due_date AS dueDate
       FROM invoices WHERE contact_id = ? AND archived_at IS NULL
       ORDER BY COALESCE(issue_date, updated_at) DESC LIMIT 250`,
    ),
    query(
      `SELECT DISTINCT d.id, d.name, d.size, d.extension,
        sr.original_filename AS originalFilename,
        sr.original_uri AS originalUri, sr.availability
       FROM source_references sr
       LEFT JOIN documents d ON d.id = sr.document_id
       JOIN quotation_revisions r ON r.id = sr.revision_id
       JOIN quotations q ON q.id = r.quotation_id
       LEFT JOIN project_contacts pc ON pc.project_id = q.project_id
       WHERE q.primary_contact_id = ? OR pc.contact_id = ?
       ORDER BY sr.created_at DESC LIMIT 250`,
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
  return Response.json(
    { contact, projects, opportunities, quotations, invoices, documents, history },
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
