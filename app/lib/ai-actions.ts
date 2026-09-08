import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { aiApprovals, aiRuns, aiToolCalls } from "../../db/schema";
import { validateActivityInput } from "./activity-service";
import type { AuthorizedUser } from "./authorization";
import { can } from "./authorization";

export const allowedAiActionTypes = ["create_activity"] as const;

export type ProposedAiAction = {
  type: "create_activity";
  input: Record<string, unknown>;
};

export function parseProposedAiAction(value: unknown): ProposedAiAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (action.type !== "create_activity" || !action.input || typeof action.input !== "object" || Array.isArray(action.input)) return null;
  return { type: "create_activity", input: action.input as Record<string, unknown> };
}

export async function validateProposedAiAction(user: AuthorizedUser, value: unknown) {
  const action = parseProposedAiAction(value);
  if (!action) return { ok: false as const, error: "La acción propuesta no está permitida." };
  if (!can(user, "agenda", "create")) return { ok: false as const, error: "No tienes permiso para crear actividades." };
  const activity = await validateActivityInput(action.input, user.email);
  if (!activity.ok) return activity;
  return { ok: true as const, action, activity: activity.value };
}

function cleanIdempotencyKey(value: unknown) {
  return String(value ?? "").trim().slice(0, 160).replace(/[^a-zA-Z0-9:_@.\/-]/g, "-");
}

export async function createAiActionProposal({ user, value, idempotencyKey }: { user: AuthorizedUser; value: unknown; idempotencyKey: unknown }) {
  const validated = await validateProposedAiAction(user, value);
  if (!validated.ok) return validated;
  const key = cleanIdempotencyKey(idempotencyKey) || crypto.randomUUID();
  const db = getDb();
  const [existing] = await db.select().from(aiApprovals).where(eq(aiApprovals.idempotencyKey, key)).limit(1);
  if (existing) return { ok: true as const, approval: existing, reused: true };
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const proposedAction = JSON.stringify({ type: validated.action.type, input: validated.activity });
  await db.insert(aiRuns).values({ id: runId, threadId: null, actorEmail: user.email, operation: "action_proposal", provider: "system", model: "typed-allowlist-v1", transport: "direct", status: "succeeded", requestMetadata: JSON.stringify({ actionType: validated.action.type }), responseMetadata: "{}", errorClass: null, latencyMs: 0, inputTokens: null, outputTokens: null, createdAt: now, completedAt: now });
  await db.insert(aiToolCalls).values({ id: crypto.randomUUID(), runId, toolName: validated.action.type, argumentsJson: JSON.stringify(validated.activity), resultJson: "{}", authorization: "approval_required", idempotencyKey: `${key}:tool`, createdAt: now });
  await db.insert(aiApprovals).values({ id: approvalId, runId, actionType: validated.action.type, proposedAction, status: "pending", requestedBy: user.email, decidedBy: null, decisionNote: "", idempotencyKey: key, executionResult: "{}", expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), createdAt: now, decidedAt: null });
  const [approval] = await db.select().from(aiApprovals).where(and(eq(aiApprovals.id, approvalId), eq(aiApprovals.idempotencyKey, key))).limit(1);
  return { ok: true as const, approval, reused: false };
}
