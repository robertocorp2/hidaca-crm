import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getD1 } from "../../../../../db";
import { whatsappConversations, whatsappMessages } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { markWhatsAppMessageRead } from "../../../../lib/whatsapp";
import { MaintenanceModeError, maintenanceResponse, withWriteLease } from "../../../../lib/write-barrier";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const [conversation] = await db.select().from(whatsappConversations).where(eq(whatsappConversations.id, id)).limit(1);
  if (!conversation) return Response.json({ error: "Conversación no encontrada." }, { status: 404 });
  const messages = await db.select().from(whatsappMessages).where(eq(whatsappMessages.conversationId, id)).orderBy(asc(whatsappMessages.createdAt)).limit(500);
  const latestInbound = messages.filter((message) => message.direction === "inbound" && message.metaMessageId).at(-1);
  if (latestInbound?.metaMessageId) {
    const d1 = getD1();
    const metaMessageId = latestInbound.metaMessageId;
    try {
      // GET has read-receipt side effects, so the method-based Worker gate is insufficient.
      await withWriteLease(d1, "whatsapp-conversation-read", async () => {
        await db.update(whatsappConversations).set({ unreadCount: 0, updatedAt: new Date().toISOString() }).where(eq(whatsappConversations.id, id));
        await d1.prepare("INSERT INTO whatsapp_conversation_reads (conversation_id,user_id,last_read_message_id,last_read_at) VALUES (?, ?, ?, ?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at").bind(id, auth.user.staffUserId, latestInbound.id, new Date().toISOString()).run();
        await d1.prepare("INSERT INTO audit_log (actor_email,action,entity_type,entity_id,detail,created_at) VALUES (?, 'read', 'whatsapp_conversation', ?, 'inbound messages marked read', ?)").bind(auth.user.email, id, new Date().toISOString()).run();
        try { await markWhatsAppMessageRead(metaMessageId); } catch { /* diagnostics surface failures, opening must remain usable */ }
      });
    } catch (error) {
      if (error instanceof MaintenanceModeError) return maintenanceResponse(error);
      throw error;
    }
  }
  return Response.json({ conversation, messages });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const payload = (await request.json()) as { status?: "open" | "pending" | "closed"; assignedUserId?: number | null; contactId?: string | null; leadId?: string | null; businessId?: string | null; opportunityId?: string | null };
  const allowedStatus = ["open", "pending", "closed"];
  if (payload.status && !allowedStatus.includes(payload.status)) return Response.json({ error: "Estado inválido." }, { status: 400 });
  const db = getDb();
  const now = new Date().toISOString();
  await db.update(whatsappConversations).set({ ...payload, updatedAt: now }).where(eq(whatsappConversations.id, id));
  await getD1().prepare("INSERT INTO whatsapp_conversation_events (conversation_id,actor_email,action,detail,created_at) VALUES (?, ?, ?, ?, ?)").bind(id, auth.user.email, payload.status ? "status_changed" : "conversation_updated", JSON.stringify(payload), now).run();
  await getD1().prepare("INSERT INTO audit_log (actor_email,action,entity_type,entity_id,detail,created_at) VALUES (?, ?, 'whatsapp_conversation', ?, ?, ?)").bind(auth.user.email, payload.status ? "status_change" : "update", id, payload.status ?? "conversation metadata", now).run();
  return Response.json({ ok: true });
}
