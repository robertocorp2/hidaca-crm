import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { businesses, contacts, opportunities } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import {
  isOpportunityStage,
  nextOpportunityStage,
  opportunityStageLabels,
} from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "oportunidades", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = getDb();
  const [opportunity] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .limit(1);
  if (!opportunity || !isOpportunityStage(opportunity.stage)) {
    return Response.json(
      { error: "Opportunity no encontrada." },
      { status: 404 },
    );
  }
  const next = nextOpportunityStage(opportunity.stage);
  if (!next) {
    return Response.json(
      { error: "Esta Opportunity ya está Closed." },
      { status: 409 },
    );
  }
  if (next === "closed") {
    return Response.json(
      { error: "Selecciona Won o Lost para cerrar la Opportunity." },
      { status: 409 },
    );
  }

  const [[business], [contact]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(eq(businesses.id, opportunity.businessId))
      .limit(1),
    opportunity.primaryContactId
      ? db
          .select()
          .from(contacts)
          .where(eq(contacts.id, opportunity.primaryContactId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const now = new Date().toISOString();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE opportunities SET stage = ?, updated_at = ?
         WHERE id = ? AND stage = ? AND archived_at IS NULL`,
      )
      .bind(next, now, id, opportunity.stage),
    d1
      .prepare(
        `INSERT INTO opportunity_stage_history
          (opportunity_id, from_stage, to_stage, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, 'Advance Stage')`,
      )
      .bind(id, opportunity.stage, next, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'stage', 'opportunity', ?, ?, ?)`,
      )
      .bind(
        auth.user.email,
        id,
        `${opportunityStageLabels[opportunity.stage]} → ${opportunityStageLabels[next]}`,
        now,
      ),
    searchDocumentStatement({
      entityType: "opportunity",
      entityId: id,
      title: opportunity.title,
      subtitle: business?.name ?? "",
      searchText: `${opportunity.title} ${business?.name ?? ""} ${contact?.name ?? ""} ${opportunity.notes} ${opportunityStageLabels[next]}`,
      ownerEmail: opportunity.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({
    opportunity: { ...opportunity, stage: next, updatedAt: now },
  });
}
