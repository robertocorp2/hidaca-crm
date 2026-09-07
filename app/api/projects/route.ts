import { getD1 } from "../../../db";
import { authorizeApi } from "../../lib/authorization";
import { cleanText } from "../../lib/crm";

export async function GET(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const q = cleanText(params.get("q"), 120);
  const status = cleanText(params.get("status"), 40);
  const businessId = cleanText(params.get("businessId"), 80);
  const serviceCategory = cleanText(params.get("serviceCategory"), 80);
  const where = ["p.archived_at IS NULL"];
  const bindings: unknown[] = [];
  if (q) {
    const like = `%${q}%`;
    where.push(
      "(p.name LIKE ? OR p.description LIKE ? OR b.name LIKE ? OR a.line1 LIKE ? OR p.project_type LIKE ?)",
    );
    bindings.push(like, like, like, like, like);
  }
  if (status) {
    where.push("p.status = ?");
    bindings.push(status);
  }
  if (businessId) {
    where.push("p.business_id = ?");
    bindings.push(businessId);
  }
  if (serviceCategory) {
    where.push("p.service_category = ?");
    bindings.push(serviceCategory);
  }
  const result = await getD1()
    .prepare(
      `SELECT p.id, p.name, p.description, p.project_type AS projectType,
        p.service_category AS serviceCategory, p.status, p.notes,
        p.business_id AS businessId, b.name AS businessName,
        p.primary_contact_id AS primaryContactId, c.name AS contactName,
        a.line1 AS projectAddress, l.building, l.apartment, l.floor,
        l.area, l.room, l.balcony, p.owner_email AS ownerEmail,
        p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT count(*) FROM quotations q
         WHERE q.project_id = p.id AND q.archived_at IS NULL) AS quotationCount
       FROM projects p
       JOIN businesses b ON b.id = p.business_id
       LEFT JOIN contacts c ON c.id = p.primary_contact_id
       LEFT JOIN addresses a ON a.id = (
         SELECT pa.id FROM addresses pa
         WHERE pa.project_id = p.id AND pa.type = 'project'
         ORDER BY pa.is_primary DESC, pa.created_at LIMIT 1
       )
       LEFT JOIN project_locations l ON l.id = (
         SELECT pl.id FROM project_locations pl
         WHERE pl.project_id = p.id ORDER BY pl.created_at LIMIT 1
       )
       WHERE ${where.join(" AND ")}
       ORDER BY p.updated_at DESC
       LIMIT 500`,
    )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return Response.json(
    { projects: result.results ?? [] },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
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
    .prepare(
      "SELECT id, name FROM businesses WHERE id = ? AND archived_at IS NULL",
    )
    .bind(businessId)
    .first<{ id: string; name: string }>();
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
  const projectId = crypto.randomUUID();
  const address = cleanText(payload.projectAddress, 600);
  const addressId = address ? crypto.randomUUID() : null;
  const statements = [
    getD1()
      .prepare(
        `INSERT INTO projects (
           id, business_id, primary_contact_id, name, description, project_type,
           service_category, status, notes, source_metadata, owner_email,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
      )
      .bind(
        projectId,
        businessId,
        contactId,
        name,
        cleanText(payload.description, 4_000),
        cleanText(payload.projectType, 120),
        cleanText(payload.serviceCategory, 120),
        cleanText(payload.status, 40) || "active",
        cleanText(payload.notes, 4_000),
        cleanText(payload.ownerEmail, 180) || auth.user.email,
        auth.user.email,
        now,
        now,
      ),
  ];
  if (addressId) {
    statements.push(
      getD1()
        .prepare(
          `INSERT INTO addresses (
             id, project_id, type, label, line1, is_primary, source_metadata,
             created_by, created_at, updated_at
           ) VALUES (?, ?, 'project', 'Dirección de proyecto', ?, 1, '{}', ?, ?, ?)`,
        )
        .bind(addressId, projectId, address, auth.user.email, now, now),
      getD1()
        .prepare(
          `INSERT INTO project_locations (
             id, project_id, address_id, label, building, apartment, floor,
             area, room, balcony, notes, source_metadata, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, 'Ubicación principal', ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          projectId,
          addressId,
          cleanText(payload.building, 180),
          cleanText(payload.apartment, 120),
          cleanText(payload.floor, 120),
          cleanText(payload.area, 180),
          cleanText(payload.room, 120),
          cleanText(payload.balcony, 120),
          cleanText(payload.locationNotes, 1_000),
          auth.user.email,
          now,
          now,
        ),
    );
  }
  if (contactId) {
    statements.push(
      getD1()
        .prepare(
          `INSERT OR IGNORE INTO project_contacts (
             project_id, contact_id, role, is_primary, notes, created_by,
             created_at
           ) VALUES (?, ?, ?, 1, '', ?, ?)`,
        )
        .bind(
          projectId,
          contactId,
          cleanText(payload.contactRole, 120),
          auth.user.email,
          now,
        ),
    );
  }
  statements.push(
    getD1()
      .prepare(
        `INSERT INTO search_documents (
           entity_type, entity_id, title, subtitle, search_text, owner_email,
           updated_at
         ) VALUES ('project', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        projectId,
        name,
        business.name,
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
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, field_name, previous_value,
           new_value, actor_email, reason, created_at
         ) VALUES ('project', ?, 'created', '', '', ?, ?, 'Formulario CRM', ?)`,
      )
      .bind(projectId, name, auth.user.email, now),
  );
  await getD1().batch(statements);
  return Response.json({ project: { id: projectId, name } }, { status: 201 });
}
