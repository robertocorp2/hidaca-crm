import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { leads } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { isLeadStatus, leadStatusLabels } from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = (await request.json()) as { note?: unknown };
  const note = String(payload.note ?? "").trim().slice(0, 500);
  if (!note) {
    return Response.json(
      { error: "La razón de reapertura es obligatoria." },
      { status: 400 },
    );
  }

  const [lead] = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .limit(1);
  if (
    !lead ||
    !isLeadStatus(lead.status) ||
    !["unqualified", "converted"].includes(lead.status)
  ) {
    return Response.json(
      { error: "Solo se pueden reabrir Leads terminales." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE leads SET status = 'working', updated_at = ?
         WHERE id = ? AND status = ? AND archived_at IS NULL`,
      )
      .bind(now, id, lead.status),
    d1
      .prepare(
        `INSERT INTO lead_status_history
          (lead_id, from_status, to_status, changed_by, changed_at, note)
         VALUES (?, ?, 'working', ?, ?, ?)`,
      )
      .bind(id, lead.status, auth.user.email, now, note),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'reopen', 'lead', ?, ?, ?)`,
      )
      .bind(auth.user.email, id, note, now),
    searchDocumentStatement({
      entityType: "lead",
      entityId: id,
      title: lead.businessName,
      subtitle: `${lead.contactName} ${lead.email || lead.phone}`.trim(),
      searchText: `${lead.businessName} ${lead.contactName} ${lead.email} ${lead.phone} ${lead.source} ${lead.notes} ${leadStatusLabels.working}`,
      ownerEmail: lead.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({
    lead: { ...lead, status: "working", updatedAt: now },
  });
}
