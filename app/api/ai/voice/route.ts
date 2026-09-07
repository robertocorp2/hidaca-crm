import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { voiceRecordings, voiceTranscriptions } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";
import { createAiProviderRouter, isAiEnabled } from "../../../lib/ai";

const maxBytes = 10 * 1024 * 1024;
const supportedTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]);

export async function GET(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Falta el identificador de la grabación." }, { status: 400 });
  const [recording] = await getDb().select().from(voiceRecordings).where(eq(voiceRecordings.id, id)).limit(1);
  if (!recording || (recording.createdBy !== auth.user.email && auth.user.role !== "admin")) return Response.json({ error: "Grabación no encontrada." }, { status: 404 });
  const [transcription] = await getDb().select().from(voiceTranscriptions).where(eq(voiceTranscriptions.recordingId, id)).orderBy(desc(voiceTranscriptions.createdAt)).limit(1);
  return Response.json({ recording, transcription: transcription ?? null });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "create" });
  if (!auth.ok) return auth.response;
  if (!isAiEnabled(env) || env.VOICE_AI_ENABLED !== "true") return Response.json({ error: "La inteligencia de voz está desactivada." }, { status: 503 });
  if (!env.FILES) return Response.json({ error: "El almacenamiento de audio no está configurado." }, { status: 503 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "Formulario de audio inválido." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Debes adjuntar un archivo de audio." }, { status: 400 });
  if (file.size <= 0 || file.size > maxBytes) return Response.json({ error: "El audio debe pesar entre 1 byte y 10 MB." }, { status: 400 });
  if (!supportedTypes.has(file.type)) return Response.json({ error: "Formato de audio no compatible." }, { status: 400 });
  const sourceValue = String(form.get("source") ?? "browser");
  const source = sourceValue === "whatsapp" ? "whatsapp" : "browser";
  const recordingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const retention = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const objectKey = `voice/${recordingId}`;
  const bytes = await file.arrayBuffer();
  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
  const db = getDb();
  await db.insert(voiceRecordings).values({ id: recordingId, source, entityType: typeof form.get("entityType") === "string" ? String(form.get("entityType")).slice(0, 80) : null, entityId: typeof form.get("entityId") === "string" ? String(form.get("entityId")).slice(0, 80) : null, objectKey, contentType: file.type, size: file.size, durationSeconds: null, language: String(form.get("language") ?? "es").slice(0, 12), sha256: "", status: "processing", retentionUntil: retention, createdBy: auth.user.email, createdAt: now, updatedAt: now });
  try {
    const result = await createAiProviderRouter(env).transcribe({ audio: bytes, contentType: file.type, language: String(form.get("language") ?? "es").slice(0, 12) });
    await db.insert(voiceTranscriptions).values({ id: crypto.randomUUID(), recordingId, provider: result.provider, model: result.model, originalText: result.text, cleanedText: result.text, structuredPayload: "{}", confidence: "{}", status: "ready", error: null, createdAt: now, updatedAt: new Date().toISOString() });
    await db.update(voiceRecordings).set({ status: "ready", updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, recordingId));
    return Response.json({ recordingId, status: "ready", transcription: result }, { status: 201 });
  } catch {
    await db.insert(voiceTranscriptions).values({ id: crypto.randomUUID(), recordingId, provider: "unavailable", model: "", originalText: "", cleanedText: "", structuredPayload: "{}", confidence: "{}", status: "failed", error: "No hay un proveedor de transcripción disponible.", createdAt: now, updatedAt: new Date().toISOString() });
    await db.update(voiceRecordings).set({ status: "failed", updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, recordingId));
    return Response.json({ recordingId, status: "failed", error: "El audio fue guardado, pero no pudo transcribirse todavía." }, { status: 202 });
  }
}
