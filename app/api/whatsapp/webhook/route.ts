import { and, eq, isNull, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { contacts, leads, opportunities, whatsappConversations, whatsappMessages } from "../../../../db/schema";
import { normalizePhone } from "../../../lib/crm";
import { downloadMetaMedia, nextWhatsAppStatus, verifyWhatsAppSignature } from "../../../lib/whatsapp";
import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("hub.verify_token") !== env.WHATSAPP_VERIFY_TOKEN) return new Response("Forbidden", { status: 403 });
  return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

async function hashBody(rawBody: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256")))) return new Response("Invalid signature", { status: 401 });
  const payload = JSON.parse(rawBody) as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> };
  const eventHash = await hashBody(rawBody);
  const d1 = getD1();
  const now = new Date().toISOString();
  try {
    await d1.prepare("INSERT INTO whatsapp_webhook_events (event_hash,event_type,processing_status,received_at) VALUES (?, ?, 'processed', ?)").bind(eventHash, "batch", now).run();
  } catch { return Response.json({ ok: true, duplicate: true }); }
  try {
    for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const metadata = value.metadata as { phone_number_id?: string } | undefined;
      const phoneNumberId = metadata?.phone_number_id ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
      for (const message of (value.messages as Array<Record<string, unknown>> | undefined) ?? []) {
        const from = String(message.from ?? "");
        if (!from) continue;
        const profile = ((value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? []).find((contact) => contact.wa_id === from);
        const conversationId = await upsertConversation(phoneNumberId, from, profile?.profile?.name ?? from, now);
        const type = String(message.type ?? "unsupported");
        const content = message[type] as { body?: string; caption?: string; id?: string } | undefined;
        const mediaId = content?.id ?? null;
        let mediaKey: string | null = null;
        let contentType: string | null = null;
        if (mediaId && ["image", "document", "audio", "video"].includes(type) && env.FILES) {
          try { const media = await downloadMetaMedia(mediaId); mediaKey = `whatsapp/${conversationId}/${crypto.randomUUID()}`; contentType = media.contentType; await env.FILES.put(mediaKey, media.body, { httpMetadata: { contentType } }); } catch { /* retain Meta media id for a safe retry/placeholder */ }
        }
        await d1.prepare("INSERT OR IGNORE INTO whatsapp_messages (id,conversation_id,meta_message_id,direction,type,body,caption,status,media_id,media_key,content_type,created_at) VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'received', ?, ?, ?, ?)").bind(crypto.randomUUID(), conversationId, String(message.id ?? ""), ["text", "image", "document", "audio", "video", "sticker", "location"].includes(type) ? type : "unsupported", content?.body ?? "", content?.caption ?? "", mediaId, mediaKey, contentType, now).run();
        await d1.prepare("UPDATE whatsapp_conversations SET unread_count=unread_count+1,last_inbound_at=?,last_message_at=?,service_window_expires_at=?,updated_at=? WHERE id=?").bind(now, now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), now, conversationId).run();
      }
      for (const status of (value.statuses as Array<Record<string, unknown>> | undefined) ?? []) await applyStatus(String(status.id ?? ""), String(status.status ?? ""), status.errors, now);
    }
    await d1.prepare("UPDATE whatsapp_webhook_events SET processed_at=? WHERE event_hash=?").bind(now, eventHash).run();
    return Response.json({ ok: true });
  } catch (error) {
    await d1.prepare("UPDATE whatsapp_webhook_events SET processing_status='failed',error=?,processed_at=? WHERE event_hash=?").bind(error instanceof Error ? error.message.slice(0, 500) : "Error", now, eventHash).run();
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function upsertConversation(phoneNumberId: string, waId: string, name: string, now: string) {
  const db = getDb();
  const [existing] = await db.select({ id: whatsappConversations.id }).from(whatsappConversations).where(and(eq(whatsappConversations.phoneNumberId, phoneNumberId), eq(whatsappConversations.waId, waId))).limit(1);
  if (existing) return existing.id;
  const normalized = normalizePhone(waId);
  const [contactRows, leadRows] = await Promise.all([
    db.select({ id: contacts.id, businessId: contacts.businessId }).from(contacts).where(and(or(eq(contacts.normalizedPhone, normalized), eq(contacts.normalizedMobilePhone, normalized)), isNull(contacts.archivedAt))),
    db.select({ id: leads.id }).from(leads).where(and(eq(leads.normalizedPhone, normalized), isNull(leads.archivedAt))),
  ]);
  const ambiguous = contactRows.length + leadRows.length > 1;
  const contact = contactRows.length === 1 && leadRows.length === 0 ? contactRows[0] : null;
  const lead = leadRows.length === 1 && contactRows.length === 0 ? leadRows[0] : null;
  const businessId = contact?.businessId ?? null;
  let opportunityId: string | null = null;
  if (businessId) {
    const activeOpportunities = await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.businessId, businessId), isNull(opportunities.archivedAt), or(eq(opportunities.stage, "evaluation"), eq(opportunities.stage, "quote"), eq(opportunities.stage, "negotiation_review"))));
    if (activeOpportunities.length === 1) opportunityId = activeOpportunities[0].id;
    else if (activeOpportunities.length > 1) opportunityId = null;
  }
  const id = crypto.randomUUID();
  await db.insert(whatsappConversations).values({ id, phoneNumberId, waId, displayName: name, profileName: name, businessId, contactId: contact?.id ?? null, leadId: lead?.id ?? null, opportunityId, matchState: ambiguous ? "ambiguous" : contact || lead ? "matched" : "unmatched", createdAt: now, updatedAt: now });
  if (!contact && !lead && !ambiguous) {
    const leadId = crypto.randomUUID();
    await db.insert(leads).values({ id: leadId, businessName: name, contactName: name, email: "", normalizedEmail: "", phone: waId, normalizedPhone: normalizePhone(waId), source: "WhatsApp", status: "new", ownerEmail: "", notes: "Prospecto creado automáticamente desde WhatsApp.", createdBy: "whatsapp:webhook", createdAt: now, updatedAt: now, archivedAt: null, convertedBusinessId: null, convertedContactId: null, convertedOpportunityId: null, convertedAt: null, convertedBy: null });
    await db.update(whatsappConversations).set({ leadId, matchState: "created_prospect" }).where(eq(whatsappConversations.id, id));
  }
  return id;
}

async function applyStatus(metaMessageId: string, incoming: string, errors: unknown, now: string) {
  const db = getDb();
  const [message] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.metaMessageId, metaMessageId)).limit(1);
  if (!message || !["sent", "delivered", "read", "failed"].includes(incoming)) return;
  const status = nextWhatsAppStatus(message.status as never, incoming as never);
  const error = Array.isArray(errors) ? JSON.stringify(errors).slice(0, 1000) : null;
  await db.update(whatsappMessages).set({ status, errorMessage: error, deliveredAt: status === "delivered" ? now : message.deliveredAt, readAt: status === "read" ? now : message.readAt, failedAt: status === "failed" ? now : message.failedAt }).where(eq(whatsappMessages.id, message.id));
}
