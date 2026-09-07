import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { whatsappConversations, whatsappMessages } from "../../../../../../db/schema";
import { whatsappTemplates } from "../../../../../../db/schema";
import { authorizeApi } from "../../../../../lib/authorization";
import { isServiceWindowOpen, isWhatsAppEnabled, sendWhatsAppMessage, whatsappConfig } from "../../../../../lib/whatsapp";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "create" });
  if (!auth.ok) return auth.response;
  if (!isWhatsAppEnabled()) return Response.json({ error: "WhatsApp está desactivado." }, { status: 503 });
  if (!whatsappConfig().configured) return Response.json({ error: "WhatsApp todavía no está conectado. Un administrador debe configurar la integración de Meta." }, { status: 503 });
  const { id } = await params;
  const payload = (await request.json()) as { body?: string; type?: string; mediaId?: string; caption?: string; fileName?: string; templateName?: string; templateLanguage?: string; templateParameters?: string[] };
  const db = getDb();
  const [conversation] = await db.select().from(whatsappConversations).where(eq(whatsappConversations.id, id)).limit(1);
  if (!conversation) return Response.json({ error: "Conversación no encontrada." }, { status: 404 });
  const type = payload.type ?? "text";
  if (!payload.templateName && !isServiceWindowOpen(conversation.serviceWindowExpiresAt)) return Response.json({ error: "La ventana de servicio expiró. Selecciona una plantilla aprobada." }, { status: 409 });
  if (payload.templateName) {
    const [approved] = await db.select({ id: whatsappTemplates.id }).from(whatsappTemplates).where(and(eq(whatsappTemplates.name, payload.templateName), eq(whatsappTemplates.status, "APPROVED"))).limit(1);
    if (!approved) return Response.json({ error: "La plantilla no está sincronizada o aprobada por Meta." }, { status: 400 });
  }
  if (type === "text" && !payload.body?.trim()) return Response.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
  const requestPayload = payload.templateName
    ? { type: "template", template: { name: payload.templateName, language: { code: payload.templateLanguage ?? "es" }, components: payload.templateParameters?.length ? [{ type: "body", parameters: payload.templateParameters.map((text) => ({ type: "text", text })) }] : undefined } }
    : type === "text" ? { type: "text", text: { body: payload.body?.trim() } } : { type, [type]: { id: payload.mediaId, caption: payload.caption, filename: payload.fileName } };
  try {
    const result = await sendWhatsAppMessage(conversation.waId, requestPayload);
    const metaMessageId = result.messages?.[0]?.id ?? null;
    const now = new Date().toISOString();
    const message = { id: crypto.randomUUID(), conversationId: id, metaMessageId, direction: "outbound" as const, type: type as "text" | "image" | "document" | "audio" | "video", body: payload.body ?? "", caption: payload.caption ?? "", status: "sent" as const, templateName: payload.templateName ?? null, templateLanguage: payload.templateLanguage ?? null, sentBy: auth.user.email, createdAt: now, sentAt: now };
    await db.insert(whatsappMessages).values(message);
    await db.update(whatsappConversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(whatsappConversations.id, id));
    return Response.json({ message });
  } catch (error) {
    return Response.json({ error: "Meta no aceptó el mensaje.", detail: error instanceof Error ? error.message.replace(/Bearer[^ ]+/g, "Bearer [redacted]") : "" }, { status: 502 });
  }
}
