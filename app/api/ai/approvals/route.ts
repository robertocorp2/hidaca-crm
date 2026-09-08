import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { aiApprovals, aiToolCalls } from "../../../../db/schema";
import { createActivityRecord } from "../../../lib/activity-service";
import { validateProposedAiAction } from "../../../lib/ai-actions";
import { authorizeApi } from "../../../lib/authorization";
import { writeAudit } from "../../../lib/audit";

export async function GET() {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  const approvals = await getDb().select().from(aiApprovals).where(or(eq(aiApprovals.status, "pending"), eq(aiApprovals.status, "approved"))).orderBy(desc(aiApprovals.createdAt)).limit(100);
  return Response.json({ approvals: auth.user.role === "admin" ? approvals : approvals.filter((approval) => approval.requestedBy === auth.user.email) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "approve" });
  if (!auth.ok) return auth.response;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  const id = String(payload.id ?? "").slice(0, 80);
  const decision = payload.decision === "approved" || payload.decision === "rejected" ? payload.decision : null;
  if (!id || !decision) return Response.json({ error: "id y una decisión válida son obligatorios." }, { status: 400 });
  const db = getDb();
  const [approval] = await db.select().from(aiApprovals).where(eq(aiApprovals.id, id)).limit(1);
  const retryApproved = approval?.status === "approved" && decision === "approved";
  if (!approval || (approval.status !== "pending" && !retryApproved)) return Response.json({ error: "La aprobación no está disponible." }, { status: 404 });
  if (approval.requestedBy !== auth.user.email && auth.user.role !== "admin") return Response.json({ error: "No tienes permiso para resolver esta aprobación." }, { status: 403 });
  if (approval.expiresAt && approval.expiresAt < new Date().toISOString()) {
    await db.update(aiApprovals).set({ status: "expired", executionResult: JSON.stringify({ error: "APPROVAL_EXPIRED" }) }).where(eq(aiApprovals.id, id));
    return Response.json({ error: "La aprobación expiró." }, { status: 409 });
  }
  const now = new Date().toISOString();
  if (decision === "rejected") {
    const [updated] = await db.update(aiApprovals).set({ status: "rejected", decidedBy: auth.user.email, decisionNote: String(payload.note ?? "").slice(0, 1000), decidedAt: now }).where(and(eq(aiApprovals.id, id), eq(aiApprovals.status, "pending"))).returning();
    if (!updated) return Response.json({ error: "La aprobación ya fue resuelta." }, { status: 409 });
    await db.update(aiToolCalls).set({ authorization: "denied", resultJson: JSON.stringify({ status: "rejected" }) }).where(eq(aiToolCalls.runId, approval.runId));
    await writeAudit(auth.user.email, "ai.approval.rejected", "ai_approval", id, JSON.stringify({ runId: approval.runId, actionType: approval.actionType }));
    return Response.json({ approval: updated });
  }

  let proposed: unknown;
  try { proposed = JSON.parse(approval.proposedAction); } catch { proposed = null; }
  const validated = await validateProposedAiAction(auth.user, proposed);
  if (!validated.ok) {
    const executionResult = JSON.stringify({ error: "ACTION_REVALIDATION_FAILED", detail: validated.error });
    const [updated] = await db.update(aiApprovals).set({ status: "approved", decidedBy: auth.user.email, decisionNote: String(payload.note ?? "").slice(0, 1000), decidedAt: approval.decidedAt ?? now, executionResult }).where(eq(aiApprovals.id, id)).returning();
    await db.update(aiToolCalls).set({ authorization: "denied", resultJson: executionResult }).where(eq(aiToolCalls.runId, approval.runId));
    await writeAudit(auth.user.email, "ai.approval.execution_blocked", "ai_approval", id, executionResult);
    return Response.json({ error: "La acción ya no es válida y no fue ejecutada.", approval: updated }, { status: 409 });
  }

  const activityId = `ai-activity-${approval.id}`;
  try {
    const result = await createActivityRecord({ actorEmail: auth.user.email, id: activityId, input: validated.activity });
    const executionResult = JSON.stringify({ entityType: "activity", entityId: activityId, created: result.created });
    const [updated] = await db.update(aiApprovals).set({ status: "executed", decidedBy: auth.user.email, decisionNote: String(payload.note ?? "").slice(0, 1000), decidedAt: approval.decidedAt ?? now, executionResult }).where(and(eq(aiApprovals.id, id), or(eq(aiApprovals.status, "pending"), eq(aiApprovals.status, "approved")))).returning();
    if (!updated) {
      const [current] = await db.select().from(aiApprovals).where(eq(aiApprovals.id, id)).limit(1);
      return Response.json({ approval: current, execution: { entityType: "activity", entityId: activityId, created: false } });
    }
    await db.update(aiToolCalls).set({ authorization: "allowed", resultJson: executionResult }).where(eq(aiToolCalls.runId, approval.runId));
    await writeAudit(auth.user.email, "ai.approval.executed", "ai_approval", id, executionResult);
    return Response.json({ approval: updated, execution: { entityType: "activity", entityId: activityId, created: result.created } });
  } catch (error) {
    const executionResult = JSON.stringify({ error: "ACTION_EXECUTION_FAILED", detail: error instanceof Error ? error.message.slice(0, 500) : "unknown" });
    const [updated] = await db.update(aiApprovals).set({ status: "approved", decidedBy: auth.user.email, decidedAt: approval.decidedAt ?? now, executionResult }).where(eq(aiApprovals.id, id)).returning();
    await writeAudit(auth.user.email, "ai.approval.execution_failed", "ai_approval", id, executionResult);
    return Response.json({ error: "La aprobación fue registrada, pero la actividad no pudo crearse. Puedes reintentar de forma segura.", approval: updated }, { status: 502 });
  }
}
