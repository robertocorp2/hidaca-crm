import { asc, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { leads } from "../../../db/schema";
import { authorizeApi } from "../../lib/authorization";
import {
  cleanText,
  normalizeEmail,
  normalizePhone,
} from "../../lib/crm";
import { searchDocumentStatement } from "../../lib/search";

export async function GET() {
  const auth = await authorizeApi({ module: "prospectos", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(leads)
    .where(isNull(leads.archivedAt))
    .orderBy(asc(leads.businessName))
    .limit(500);
  return Response.json({ leads: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "prospectos", action: "create" });
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as Record<string, unknown>;
  const businessName = cleanText(payload.businessName, 180);
  const contactName = cleanText(payload.contactName, 180);
  if (!businessName || !contactName) {
    return Response.json(
      { error: "Business Name y Contact Name son obligatorios." },
      { status: 400 },
    );
  }

  const email = cleanText(payload.email, 180);
  const phone = cleanText(payload.phone, 60);
  const now = new Date().toISOString();
  const lead = {
    id: crypto.randomUUID(),
    businessName,
    contactName,
    email,
    normalizedEmail: normalizeEmail(email),
    phone,
    normalizedPhone: normalizePhone(phone),
    source: cleanText(payload.source, 120),
    status: "new" as const,
    ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
    notes: cleanText(payload.notes, 4000),
    convertedBusinessId: null,
    convertedContactId: null,
    convertedOpportunityId: null,
    convertedAt: null,
    convertedBy: null,
    createdBy: auth.user.email,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO leads (
          id, business_name, contact_name, email, normalized_email, phone,
          normalized_phone, source, status, owner_email, notes, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        lead.id,
        lead.businessName,
        lead.contactName,
        lead.email,
        lead.normalizedEmail,
        lead.phone,
        lead.normalizedPhone,
        lead.source,
        lead.status,
        lead.ownerEmail,
        lead.notes,
        lead.createdBy,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO lead_status_history
          (lead_id, from_status, to_status, changed_by, changed_at, note)
         VALUES (?, NULL, 'new', ?, ?, 'Lead creado')`,
      )
      .bind(lead.id, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'create', 'lead', ?, ?, ?)`,
      )
      .bind(auth.user.email, lead.id, businessName, now),
    searchDocumentStatement({
      entityType: "lead",
      entityId: lead.id,
      title: businessName,
      subtitle: `${contactName} ${email || phone}`.trim(),
      searchText: `${businessName} ${contactName} ${email} ${phone} ${lead.source} ${lead.notes}`,
      ownerEmail: lead.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({ lead }, { status: 201 });
}
