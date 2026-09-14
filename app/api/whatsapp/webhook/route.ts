import { and, eq, isNull, or } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { getD1, getDb } from "../../../../db";
import { contacts, leads, opportunities, whatsappConversations } from "../../../../db/schema";
import { normalizePhone } from "../../../lib/crm";
import { persistInboundWhatsAppMessage, renewWhatsAppWebhookClaim, resolveWhatsAppWebhookEventHash, runWhatsAppWebhookDelivery, updateWhatsAppDeliveryStatus, webhookClaimIsActive, type WhatsAppWebhookClaim, whatsappWebhookResponse } from "../../../lib/whatsapp-webhook";
import { downloadMetaMedia, verifyWhatsAppSignature } from "../../../lib/whatsapp";
import { canonicalWhatsAppMessageIdentity, canonicalWhatsAppWebhookIdentity } from "../../../lib/whatsapp-webhook-identity";
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
  const eventIdentity = canonicalWhatsAppWebhookIdentity(payload);
  const legacyEventHash = await hashBody(rawBody);
  const canonicalEventHash = await hashBody(eventIdentity ?? rawBody);
  const d1 = getD1();
  const eventHash = await resolveWhatsAppWebhookEventHash(d1, canonicalEventHash, legacyEventHash);
  const now = new Date().toISOString();
  try {
    const delivery = await runWhatsAppWebhookDelivery(d1, { eventHash, eventType: "batch", now }, async (claim) => {
      for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const metadata = value.metadata as { phone_number_id?: string } | undefined;
        const phoneNumberId = metadata?.phone_number_id ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
        for (const message of (value.messages as Array<Record<string, unknown>> | undefined) ?? []) {
          const from = String(message.from ?? "");
          if (!from) continue;
          const profile = ((value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? []).find((contact) => contact.wa_id === from);
          const conversationId = await upsertConversation(phoneNumberId, from, profile?.profile?.name ?? from, now, claim);
          const type = String(message.type ?? "unsupported");
          const content = message[type] as { body?: string; caption?: string; id?: string } | undefined;
          const mediaId = content?.id ?? null;
          let mediaKey: string | null = null;
          let contentType: string | null = null;
          const messageIdentity = canonicalWhatsAppMessageIdentity(phoneNumberId, message);
          const fallbackMessageId = message.id ? String(message.id) : await hashBody(messageIdentity);
          if (mediaId && ["image", "document", "audio", "video"].includes(type)) {
            if (!env.FILES) throw new Error("WHATSAPP_MEDIA_STORAGE_UNAVAILABLE");
            if (!(await renewWhatsAppWebhookClaim(d1, claim, new Date().toISOString()))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
            const media = await downloadMetaMedia(mediaId);
            const mediaPart = String(message.id ?? `event-${fallbackMessageId}`).replace(/[^a-zA-Z0-9_.-]/g, "_");
            mediaKey = `whatsapp/${conversationId}/${mediaPart}`;
            contentType = media.contentType;
            if (!(await renewWhatsAppWebhookClaim(d1, claim, new Date().toISOString()))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
            await env.FILES.put(mediaKey, media.body, { httpMetadata: { contentType } });
            if (!(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
          }
          await persistInboundWhatsAppMessage(d1, {
            id: crypto.randomUUID(),
            conversationId,
            metaMessageId: message.id ? String(message.id) : `hidaca:${fallbackMessageId}`,
            type: ["text", "image", "document", "audio", "video", "sticker", "location"].includes(type) ? type : "unsupported",
            body: content?.body ?? "",
            caption: content?.caption ?? "",
            mediaId,
            mediaKey,
            contentType,
            now,
            claim,
          });
        }
        for (const status of (value.statuses as Array<Record<string, unknown>> | undefined) ?? []) await applyStatus(String(status.id ?? ""), String(status.status ?? ""), status.errors, now, claim, String(status.biz_opaque_callback_data ?? ""));
      }
    });
    return whatsappWebhookResponse(delivery.status);
  } catch {
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function insertAutomaticLead(d1: D1Database, leadId: string, name: string, waId: string, now: string, claim: WhatsAppWebhookClaim) {
  const claimCheckAt = new Date().toISOString();
  await d1
    .prepare(
      `INSERT INTO leads (id,business_name,contact_name,email,normalized_email,phone,normalized_phone,source,status,owner_email,notes,created_by,created_at,updated_at)
       SELECT ?, ?, ?, '', '', ?, ?, 'WhatsApp', 'new', '', 'Prospecto creado automáticamente desde WhatsApp.', 'whatsapp:webhook', ?, ?
       WHERE EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(leadId, name, name, waId, normalizePhone(waId), now, now, claim.eventHash, claim.attemptCount, claimCheckAt)
    .run();
  if (!(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
}

async function updateConversationMatch(
  d1: D1Database,
  id: string,
  values: { businessId: string | null; contactId: string | null; leadId: string | null; opportunityId: string | null; matchState: string; updatedAt: string },
  claim: WhatsAppWebhookClaim,
) {
  const claimCheckAt = new Date().toISOString();
  await d1
    .prepare(
      `UPDATE whatsapp_conversations
       SET business_id=?,contact_id=?,lead_id=?,opportunity_id=?,match_state=?,updated_at=?
       WHERE id=? AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)`,
    )
    .bind(values.businessId, values.contactId, values.leadId, values.opportunityId, values.matchState, values.updatedAt, id, claim.eventHash, claim.attemptCount, claimCheckAt)
    .run();
  if (!(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
}

async function upsertConversation(phoneNumberId: string, waId: string, name: string, now: string, claim: WhatsAppWebhookClaim) {
  const db = getDb();
  const d1 = getD1();
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
      await insertAutomaticLead(d1, leadId, name, waId, now, claim);
      await updateConversationMatch(d1, existing.id, { businessId: null, contactId: null, leadId, opportunityId: null, matchState: "created_prospect", updatedAt: now }, claim);
    } else {
      await updateConversationMatch(d1, existing.id, { businessId, contactId: contact?.id ?? null, leadId: lead?.id ?? null, opportunityId, matchState: ambiguous ? "ambiguous" : "matched", updatedAt: now }, claim);
    }
    return existing.id;
  }
  const id = crypto.randomUUID();
  const claimCheckAt = new Date().toISOString();
  const inserted = await d1
    .prepare(
      `INSERT INTO whatsapp_conversations (id,phone_number_id,wa_id,display_name,profile_name,business_id,contact_id,lead_id,opportunity_id,match_state,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)
       ON CONFLICT(phone_number_id,wa_id) DO NOTHING
       RETURNING id`,
    )
    .bind(id, phoneNumberId, waId, name, name, businessId, contact?.id ?? null, lead?.id ?? null, opportunityId, ambiguous ? "ambiguous" : contact || lead ? "matched" : "unmatched", now, now, claim.eventHash, claim.attemptCount, claimCheckAt)
    .first<{ id: string }>();
  if (!inserted) {
    if (!(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
    const [concurrent] = await db.select({ id: whatsappConversations.id }).from(whatsappConversations).where(and(eq(whatsappConversations.phoneNumberId, phoneNumberId), eq(whatsappConversations.waId, waId))).limit(1);
    if (!concurrent) throw new Error("WHATSAPP_CONVERSATION_INSERT_FAILED");
    return concurrent.id;
  }
  if (!contact && !lead && !ambiguous) {
    const leadId = `whatsapp:${id}:lead`;
    await insertAutomaticLead(d1, leadId, name, waId, now, claim);
    await updateConversationMatch(d1, id, { businessId: null, contactId: null, leadId, opportunityId: null, matchState: "created_prospect", updatedAt: now }, claim);
  }
  return id;
}

async function applyStatus(metaMessageId: string, incoming: string, errors: unknown, now: string, claim: WhatsAppWebhookClaim, deliveryToken: string) {
  if (!["sent", "delivered", "read", "failed"].includes(incoming)) return;
  if ((await updateWhatsAppDeliveryStatus(getD1(), metaMessageId, incoming, errors, now, claim, deliveryToken || undefined)) === "missing") {
    throw new Error("WHATSAPP_STATUS_MESSAGE_NOT_FOUND");
  }
}
