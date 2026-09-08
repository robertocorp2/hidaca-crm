import { createAiActionProposal } from "../../../../lib/ai-actions";
import { authorizeApi } from "../../../../lib/authorization";
import { writeAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "create" });
  if (!auth.ok) return auth.response;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  const values = Array.isArray(payload.actions) ? payload.actions.slice(0, 10) : [payload.action];
  if (!values.length || values.some((value) => !value)) return Response.json({ error: "Debes incluir al menos una acción propuesta." }, { status: 400 });
  const baseKey = String(payload.idempotencyKey ?? crypto.randomUUID()).slice(0, 140);
  const proposals = [];
  for (const [index, value] of values.entries()) {
    const result = await createAiActionProposal({ user: auth.user, value, idempotencyKey: `${baseKey}:${index}` });
    if (!result.ok) return Response.json({ error: result.error, index }, { status: result.error.includes("permiso") ? 403 : 400 });
    proposals.push(result.approval);
  }
  await writeAudit(auth.user.email, "ai.action.propose", "ai_approval", proposals[0]?.id ?? baseKey, JSON.stringify({ count: proposals.length, actionType: "create_activity" }));
  return Response.json({ approvals: proposals }, { status: 201 });
}
