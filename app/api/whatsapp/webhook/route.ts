import { and, eq, isNull, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { contacts, leads, opportunities, whatsappConversations } from "../../../../db/schema";
import { normalizePhone } from "../../../lib/crm";
import { persistInboundWhatsAppMessage, runWhatsAppWebhookDelivery, updateWhatsAppMessageStatus, whatsappWebhookResponse } from "../../../lib/whatsapp-webhook";
import { downloadMetaMedia, verifyWhatsAppSignature } from "../../../lib/whatsapp";
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
    const delivery = await runWhatsAppWebhookDelivery(d1, { eventHash, eventType: "batch", now }, async () => {
      let messageOrdinal = 0;
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
          const ordinal = messageOrdinal++;
          if (mediaId && ["image", "document", "audio", "video"].includes(type)) {
            if (!env.FILES) throw new Error("WHATSAPP_MEDIA_STORAGE_UNAVAILABLE");
            const media = await downloadMetaMedia(mediaId);
          const mediaPart = String(message.id ?? ordinal).replace(/[^a-zA-Z0-9_.-]/g, "_");
            mediaKey = `whatsapp/${conversationId}/${eventHash}-${mediaPart}`;
            contentType = media.contentType;
            await env.FILES.put(mediaKey, media.body, { httpMetadata: { contentType } });
          }
          await persistInboundWhatsAppMessage(d1, {
            id: crypto.randomUUID(),
            conversationId,
            metaMessageId: message.id ? String(message.id) : `hidaca:${eventHash}:${ordinal}`,
            type: ["text", "image", "document", "audio", "video", "sticker", "location"].includes(type) ? type : "unsupported",
            body: content?.body ?? "",
            caption: content?.caption ?? "",
            mediaId,
            mediaKey,
            contentType,
            now,
          });
        }
        for (const status of (value.statuses as Array<Record<string, unknown>> | undefined) ?? []) await applyStatus(String(status.id ?? ""), String(status.status ?? ""), status.errors, now);
      }
    });
    return whatsappWebhookResponse(delivery.status);
  } catch {
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function upsertConversation(phoneNumberId: string, waId: string, name: string, now: string) {
  const db = getDb();
  const [existing] = await db.select({ id: whatsappConversations.id, leadId: whatsappConversations.leadId, matchState: whatsappConversations.matchState }).from(whatsappConversations).where(and(eq(whatsappConversations.phoneNumberId, phoneNumberId), eq(whatsappConversations.waId, waId))).limit(1);
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
  if (existing) {
    if (existing.leadId || existing.matchState !== "unmatched") return existing.id;
    const automaticLeadId = `whatsapp:${existing.id}:lead`;
    if (!contact && !ambiguous && (!lead || lead.id === automaticLeadId)) {
      const leadId = automaticLeadId;
      await db.insert(leads).values({ id: leadId, businessName: name, contactName: name, email: "", normalizedEmail: "", phone: waId, normalizedPhone: normalizePhone(waId), source: "WhatsApp", status: "new", ownerEmail: "", notes: "Prospecto creado automáticamente desde WhatsApp.", createdBy: "whatsapp:webhook", createdAt: now, updatedAt: now, archivedAt: null, convertedBusinessId: null, convertedContactId: null, convertedOpportunityId: null, convertedAt: null, convertedBy: null }).onConflictDoNothing({ target: leads.id });
      await db.update(whatsappConversations).set({ leadId, matchState: "created_prospect", updatedAt: now }).where(eq(whatsappConversations.id, existing.id));
    } else {
      await db.update(whatsappConversations).set({ businessId, contactId: contact?.id ?? null, leadId: lead?.id ?? null, opportunityId, matchState: ambiguous ? "ambiguous" : "matched", updatedAt: now }).where(eq(whatsappConversations.id, existing.id));
    }
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.insert(whatsappConversations).values({ id, phoneNumberId, waId, displayName: name, profileName: name, businessId, contactId: contact?.id ?? null, leadId: lead?.id ?? null, opportunityId, matchState: ambiguous ? "ambiguous" : contact || lead ? "matched" : "unmatched", createdAt: now, updatedAt: now });
  if (!contact && !lead && !ambiguous) {
    const leadId = `whatsapp:${id}:lead`;
    await db.insert(leads).values({ id: leadId, businessName: name, contactName: name, email: "", normalizedEmail: "", phone: waId, normalizedPhone: normalizePhone(waId), source: "WhatsApp", status: "new", ownerEmail: "", notes: "Prospecto creado automáticamente desde WhatsApp.", createdBy: "whatsapp:webhook", createdAt: now, updatedAt: now, archivedAt: null, convertedBusinessId: null, convertedContactId: null, convertedOpportunityId: null, convertedAt: null, convertedBy: null }).onConflictDoNothing({ target: leads.id });
    await db.update(whatsappConversations).set({ leadId, matchState: "created_prospect" }).where(eq(whatsappConversations.id, id));
  }
  return id;
}

async function applyStatus(metaMessageId: string, incoming: string, errors: unknown, now: string) {
  if (!["sent", "delivered", "read", "failed"].includes(incoming)) return;
  if (!(await updateWhatsAppMessageStatus(getD1(), metaMessageId, incoming, errors, now))) {
    throw new Error("WHATSAPP_STATUS_MESSAGE_NOT_FOUND");
  }
}
