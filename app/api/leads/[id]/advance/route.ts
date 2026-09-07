import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { leads } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import {
  isLeadStatus,
  leadStatusLabels,
  nextLeadStatus,
} from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const [lead] = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .limit(1);
  if (!lead || !isLeadStatus(lead.status)) {
    return Response.json({ error: "Lead no encontrado." }, { status: 404 });
  }
  const next = nextLeadStatus(lead.status);
  if (!next) {
    return Response.json(
      { error: "Este Lead está en un estado terminal." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE leads SET status = ?, updated_at = ?
         WHERE id = ? AND status = ? AND archived_at IS NULL`,
      )
      .bind(next, now, id, lead.status),
    d1
      .prepare(
        `INSERT INTO lead_status_history
          (lead_id, from_status, to_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, 'Advance Stage')`,
      )
      .bind(id, lead.status, next, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'stage', 'lead', ?, ?, ?)`,
      )
      .bind(
        auth.user.email,
        id,
        `${leadStatusLabels[lead.status]} → ${leadStatusLabels[next]}`,
        now,
      ),
    searchDocumentStatement({
      entityType: "lead",
      entityId: id,
      title: lead.businessName,
      subtitle: `${lead.contactName} ${lead.email || lead.phone}`.trim(),
      searchText: `${lead.businessName} ${lead.contactName} ${lead.email} ${lead.phone} ${lead.source} ${lead.notes} ${leadStatusLabels[next]}`,
      ownerEmail: lead.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({ lead: { ...lead, status: next, updatedAt: now } });
}
