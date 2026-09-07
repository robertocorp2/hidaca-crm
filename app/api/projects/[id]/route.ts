import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { cleanText } from "../../../lib/crm";

type RouteContext = { params: Promise<{ id: string }> };

async function projectDetail(id: string) {
  const d1 = getD1();
  const project = await d1
    .prepare(
      `SELECT p.*, p.project_type AS projectType,
        p.service_category AS serviceCategory, p.business_id AS businessId,
        b.name AS businessName, p.primary_contact_id AS primaryContactId,
        c.name AS contactName, c.email AS contactEmail,
        p.owner_email AS ownerEmail, p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        (SELECT count(*) FROM quotations q
         WHERE q.project_id = p.id AND q.archived_at IS NULL) AS quotationCount
       FROM projects p
       JOIN businesses b ON b.id = p.business_id
       LEFT JOIN contacts c ON c.id = p.primary_contact_id
       WHERE p.id = ? AND p.archived_at IS NULL`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!project) return null;
  const query = async (sql: string) =>
    (await d1.prepare(sql).bind(id).all<Record<string, unknown>>()).results ??
    [];
  const [contacts, locations, quotations, documents, history] =
    await Promise.all([
      query(
        `SELECT c.id, c.name, c.title, c.email, c.phone,
          c.mobile_phone AS mobilePhone, pc.role, pc.is_primary AS isPrimary,
          pc.notes
         FROM project_contacts pc JOIN contacts c ON c.id = pc.contact_id
         WHERE pc.project_id = ? ORDER BY pc.is_primary DESC, c.name`,
      ),
      query(
        `SELECT l.id, l.address_id AS addressId, l.label, l.building, l.apartment, l.floor, l.area,
          l.room, l.balcony, l.notes, a.line1 AS projectAddress,
          a.city, a.province, a.country
         FROM project_locations l
         LEFT JOIN addresses a ON a.id = l.address_id
         WHERE l.project_id = ? ORDER BY l.created_at`,
      ),
      query(
        `SELECT q.id, q.quotation_number AS quotationNumber, q.title,
          q.status, q.currency, q.quotation_year AS quotationYear,
          r.quotation_date AS quotationDate,
          f.source_total AS sourceTotal, f.payment_status AS paymentStatus
         FROM quotations q
         LEFT JOIN quotation_revisions r ON r.id = (
           SELECT qr.id FROM quotation_revisions qr
           WHERE qr.quotation_id = q.id
           ORDER BY qr.is_current DESC, qr.revision_number DESC LIMIT 1
         )
         LEFT JOIN quotation_financials f ON f.revision_id = r.id
         WHERE q.project_id = ? AND q.archived_at IS NULL
         ORDER BY coalesce(r.quotation_date, q.updated_at) DESC`,
      ),
      query(
        `SELECT DISTINCT d.id, d.name, d.size, d.extension, sr.original_uri AS originalUri,
          sr.original_filename AS originalFilename, sr.availability
         FROM quotations q
         JOIN quotation_revisions r ON r.quotation_id = q.id
         LEFT JOIN source_references sr ON sr.revision_id = r.id
         LEFT JOIN documents d ON d.id = sr.document_id
         WHERE q.project_id = ?`,
      ),
      query(
        `SELECT action, field_name AS fieldName, previous_value AS previousValue,
          new_value AS newValue, actor_email AS actorEmail, reason,
          created_at AS createdAt
         FROM entity_history
         WHERE entity_type = 'project' AND entity_id = ?
         ORDER BY created_at DESC LIMIT 250`,
      ),
    ]);
  return { project, contacts, locations, quotations, documents, history };
}

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const detail = await projectDetail(id);
  if (!detail) {
    return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
  }
  return Response.json(detail, {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const current = await projectDetail(id);
  if (!current) {
    return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
  }
  const payload = (await request.json()) as Record<string, unknown>;
  const name = cleanText(payload.name, 240);
  const businessId = cleanText(payload.businessId, 80);
  const contactId = cleanText(payload.primaryContactId, 80) || null;
  if (!name || !businessId) {
    return Response.json(
      { error: "Proyecto y cliente son obligatorios." },
      { status: 400 },
    );
  }
  const business = await getD1()
    .prepare("SELECT id FROM businesses WHERE id = ? AND archived_at IS NULL")
    .bind(businessId)
    .first<{ id: string }>();
  if (!business) {
    return Response.json({ error: "El cliente no existe." }, { status: 400 });
  }
  if (contactId) {
    const contact = await getD1()
      .prepare(
        "SELECT id FROM contacts WHERE id = ? AND business_id = ? AND archived_at IS NULL",
      )
      .bind(contactId, businessId)
      .first<{ id: string }>();
    if (!contact) {
      return Response.json(
        { error: "El contacto no pertenece al cliente seleccionado." },
        { status: 400 },
      );
    }
  }
  const now = new Date().toISOString();
  const previous = current.project;
  const address = cleanText(payload.projectAddress, 600);
  const location = current.locations[0];
  const addressId = String(location?.id ? (location.addressId ?? "") : "");
  const statements = [
    getD1()
      .prepare(
        `UPDATE projects
         SET business_id = ?, primary_contact_id = ?, name = ?,
             description = ?, project_type = ?, service_category = ?,
             status = ?, notes = ?, owner_email = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL`,
      )
      .bind(
        businessId,
        contactId,
        name,
        cleanText(payload.description, 4_000),
        cleanText(payload.projectType, 120),
        cleanText(payload.serviceCategory, 120),
        cleanText(payload.status, 40) || "active",
        cleanText(payload.notes, 4_000),
        cleanText(payload.ownerEmail, 180) || auth.user.email,
        now,
        id,
      ),
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, field_name, previous_value,
           new_value, actor_email, reason, created_at
         ) VALUES ('project', ?, 'updated', 'record', ?, ?, ?, 'Formulario CRM', ?)`,
      )
      .bind(
        id,
        JSON.stringify(previous),
        JSON.stringify(payload),
        auth.user.email,
        now,
      ),
  ];
  if (address && addressId) {
    statements.push(
      getD1()
        .prepare("UPDATE addresses SET line1 = ?, updated_at = ? WHERE id = ?")
        .bind(address, now, addressId),
    );
  }
  if (location?.id) {
    statements.push(
      getD1()
        .prepare(
          `UPDATE project_locations
           SET building = ?, apartment = ?, floor = ?, area = ?, room = ?,
               balcony = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          cleanText(payload.building, 180),
          cleanText(payload.apartment, 120),
          cleanText(payload.floor, 120),
          cleanText(payload.area, 180),
          cleanText(payload.room, 120),
          cleanText(payload.balcony, 120),
          cleanText(payload.locationNotes, 1_000),
          now,
          location.id,
        ),
    );
  }
  statements.push(
    getD1()
      .prepare(
        `INSERT INTO search_documents (
           entity_type, entity_id, title, subtitle, search_text, owner_email,
           updated_at
         ) VALUES ('project', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           title = excluded.title,
           subtitle = excluded.subtitle,
           search_text = excluded.search_text,
           owner_email = excluded.owner_email,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        name,
        businessId,
        [
          name,
          cleanText(payload.description, 4_000),
          cleanText(payload.projectType, 120),
          cleanText(payload.serviceCategory, 120),
          address,
          cleanText(payload.building, 180),
          cleanText(payload.apartment, 120),
          cleanText(payload.floor, 120),
          cleanText(payload.area, 180),
          cleanText(payload.room, 120),
          cleanText(payload.balcony, 120),
        ].join(" "),
        cleanText(payload.ownerEmail, 180) || auth.user.email,
        now,
      ),
  );
  await getD1().batch(statements);
  return Response.json({ project: { id, name } });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const linked = await getD1()
    .prepare(
      "SELECT id FROM quotations WHERE project_id = ? AND archived_at IS NULL LIMIT 1",
    )
    .bind(id)
    .first<{ id: string }>();
  if (linked) {
    return Response.json(
      { error: "No se puede archivar un proyecto con cotizaciones activas." },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  await getD1()
    .prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, id)
    .run();
  return Response.json({ ok: true });
}
