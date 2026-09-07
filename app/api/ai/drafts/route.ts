import { env } from "cloudflare:workers";
import { authorizeApi } from "../../../lib/authorization";
import { createAiProviderRouter, isAiEnabled, isAiProvider, type AiProvider } from "../../../lib/ai";

const noteSchema = { type: "object", properties: { cleanedText: { type: "string" }, entityType: { type: "string" }, entityId: { type: "string" }, confidence: { type: "number" }, followUps: { type: "array", items: { type: "string" } } }, required: ["cleanedText", "confidence", "followUps"] };
const reportSchema = { type: "object", properties: { summary: { type: "string" }, workCompleted: { type: "string" }, workers: { type: "array", items: { type: "string" } }, materialsUsed: { type: "array", items: { type: "string" } }, materialsMissing: { type: "array", items: { type: "string" } }, blockers: { type: "array", items: { type: "string" } }, incidents: { type: "array", items: { type: "string" } }, clientComments: { type: "string" }, nextPlan: { type: "string" }, confidence: { type: "number" }, followUps: { type: "array", items: { type: "string" } } }, required: ["summary", "workCompleted", "workers", "materialsUsed", "materialsMissing", "blockers", "incidents", "clientComments", "nextPlan", "confidence", "followUps"] };

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "create" });
  if (!auth.ok) return auth.response;
  if (!isAiEnabled(env)) return Response.json({ error: "El asistente IA está desactivado." }, { status: 503 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  const kind = payload.kind === "daily_report" ? "daily_report" : payload.kind === "note" ? "note" : null;
  const sourceText = String(payload.sourceText ?? "").trim().slice(0, 16000);
  if (!kind || !sourceText) return Response.json({ error: "kind y sourceText son obligatorios." }, { status: 400 });
  const provider = payload.provider;
  if (provider !== undefined && !isAiProvider(provider)) return Response.json({ error: "Proveedor IA inválido." }, { status: 400 });
  const projectId = typeof payload.projectId === "string" ? payload.projectId.slice(0, 80) : "";
  const prompt = kind === "note"
    ? `Convierte la siguiente transcripción en una nota operativa breve. No inventes datos. Si no puedes identificar la entidad, deja entityType y entityId vacíos y formula followUps. Transcripción:\n${sourceText}`
    : `Convierte la siguiente transcripción en un borrador de reporte diario de obra. No inventes datos. Usa arreglos vacíos cuando falten datos y formula followUps. ProjectId de contexto: ${projectId || "no indicado"}. Transcripción:\n${sourceText}`;
  try {
    const result = await createAiProviderRouter(env).complete({ provider: provider as AiProvider | undefined, model: typeof payload.model === "string" ? payload.model.slice(0, 120) : undefined, messages: [{ role: "system", content: "Eres el asistente operativo de HIDACA. Devuelve JSON válido y conserva la incertidumbre." }, { role: "user", content: prompt }], responseSchema: kind === "note" ? noteSchema : reportSchema, allowFallback: true, idempotencyKey: crypto.randomUUID() });
    return Response.json({ kind, draft: result.structured ?? { text: result.text }, provider: result.provider, model: result.model });
  } catch { return Response.json({ error: "No fue posible generar el borrador con los proveedores configurados." }, { status: 502 }); }
}
