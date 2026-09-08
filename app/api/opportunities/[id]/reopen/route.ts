import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { businesses, opportunities } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "oportunidades", action: "administer" });
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
  const db = getDb();
  const [opportunity] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .limit(1);
  if (!opportunity || opportunity.stage !== "closed") {
    return Response.json(
      { error: "Solo se pueden reabrir Opportunities Closed." },
      { status: 409 },
    );
  }
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, opportunity.businessId))
    .limit(1);
  const now = new Date().toISOString();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE opportunities SET
          stage = 'negotiation_review', outcome = NULL, loss_reason = '',
          closed_at = NULL, closed_by = NULL, updated_at = ?
         WHERE id = ? AND stage = 'closed' AND archived_at IS NULL`,
      )
      .bind(now, id),
    d1
      .prepare(
        `INSERT INTO opportunity_stage_history
          (opportunity_id, from_stage, to_stage, changed_by, changed_at, note)
         VALUES (?, 'closed', 'negotiation_review', ?, ?, ?)`,
      )
      .bind(id, auth.user.email, now, note),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'reopen', 'opportunity', ?, ?, ?)`,
      )
      .bind(auth.user.email, id, note, now),
    searchDocumentStatement({
      entityType: "opportunity",
      entityId: id,
      title: opportunity.title,
      subtitle: business?.name ?? "",
      searchText: `${opportunity.title} ${business?.name ?? ""} ${opportunity.notes} Negotiation Review`,
      ownerEmail: opportunity.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({
    opportunity: {
      ...opportunity,
      stage: "negotiation_review",
      outcome: null,
      lossReason: "",
      closedAt: null,
      closedBy: null,
      updatedAt: now,
    },
  });
}
