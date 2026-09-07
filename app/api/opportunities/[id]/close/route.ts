import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { businesses, contacts, opportunities } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import {
  cleanText,
  isOpportunityOutcome,
  opportunityOutcomeLabels,
} from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const outcome = payload.outcome;
  const lossReason = cleanText(payload.lossReason, 500);
  if (!isOpportunityOutcome(outcome)) {
    return Response.json(
      { error: "Selecciona Won o Lost." },
      { status: 400 },
    );
  }
  if (outcome === "lost" && lossReason.length < 3) {
    return Response.json(
      { error: "Indica una razón de pérdida." },
      { status: 400 },
    );
  }

  const db = getDb();
  const [opportunity] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .limit(1);
  if (!opportunity) {
    return Response.json(
      { error: "Opportunity no encontrada." },
      { status: 404 },
    );
  }
  if (opportunity.stage !== "negotiation_review" || opportunity.outcome) {
    return Response.json(
      {
        error:
          "Solo una Opportunity en Negotiation / Review puede cerrarse.",
      },
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
        `UPDATE opportunities SET
          stage = 'closed', outcome = ?, loss_reason = ?, closed_at = ?,
          closed_by = ?, updated_at = ?
         WHERE id = ? AND stage = 'negotiation_review' AND outcome IS NULL
           AND archived_at IS NULL`,
      )
      .bind(outcome, lossReason, now, auth.user.email, now, id),
    d1
      .prepare(
        `INSERT INTO opportunity_stage_history
          (opportunity_id, from_stage, to_stage, outcome, changed_by, changed_at, note)
         VALUES (?, 'negotiation_review', 'closed', ?, ?, ?, ?)`,
      )
      .bind(id, outcome, auth.user.email, now, lossReason),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'close', 'opportunity', ?, ?, ?)`,
      )
      .bind(auth.user.email, id, opportunityOutcomeLabels[outcome], now),
    searchDocumentStatement({
      entityType: "opportunity",
      entityId: id,
      title: opportunity.title,
      subtitle: business?.name ?? "",
      searchText: `${opportunity.title} ${business?.name ?? ""} ${contact?.name ?? ""} ${opportunity.notes} Closed ${opportunityOutcomeLabels[outcome]} ${lossReason}`,
      ownerEmail: opportunity.ownerEmail,
      updatedAt: now,
    }),
  ]);

  return Response.json({
    opportunity: {
      ...opportunity,
      stage: "closed",
      outcome,
      lossReason,
      closedAt: now,
      closedBy: auth.user.email,
      updatedAt: now,
    },
  });
}
