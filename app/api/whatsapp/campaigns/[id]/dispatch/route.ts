import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { whatsappCampaignDeliveryAttempts, whatsappCampaignRecipients, whatsappCampaigns } from "../../../../../../db/schema";
import { authorizeApi } from "../../../../../lib/authorization";
import { refreshWhatsAppCampaignSummary } from "../../../../../lib/whatsapp-webhook";
import { getD1 } from "../../../../../../db";
import { isWhatsAppCampaignsEnabled, sendWhatsAppMessage } from "../../../../../lib/whatsapp";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "create" });
  if (!auth.ok) return auth.response;
  if (!isWhatsAppCampaignsEnabled()) return Response.json({ error: "Las campañas están desactivadas." }, { status: 503 });
  const { id } = await params;
  const db = getDb();
  const [campaign] = await db.select().from(whatsappCampaigns).where(eq(whatsappCampaigns.id, id)).limit(1);
  if (!campaign) return Response.json({ error: "Campaña no encontrada." }, { status: 404 });
  if (campaign.status === "paused") return Response.json({ error: "La campaña está pausada." }, { status: 409 });
  const now = new Date().toISOString();
  const staleSendingBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await db.update(whatsappCampaignRecipients)
    .set({ status: "uncertain", error: "El intento de envío expiró; reconcilia el estado en Meta antes de reintentar.", lockedAt: null, updatedAt: now })
    .where(and(eq(whatsappCampaignRecipients.campaignId, id), eq(whatsappCampaignRecipients.status, "sending"), or(isNull(whatsappCampaignRecipients.lockedAt), lt(whatsappCampaignRecipients.lockedAt, staleSendingBefore))));
  const recipients = await db.select().from(whatsappCampaignRecipients).where(and(eq(whatsappCampaignRecipients.campaignId, id), or(eq(whatsappCampaignRecipients.status, "queued"), and(eq(whatsappCampaignRecipients.status, "failed"), isNull(whatsappCampaignRecipients.metaMessageId))))).limit(25);
  let sent = 0; let failed = 0;
  for (const recipient of recipients) {
    const claimedAt = new Date().toISOString();
    const deliveryToken = `${recipient.id}:${recipient.attempts + 1}:${crypto.randomUUID()}`;
    const attemptId = crypto.randomUUID();
    // Claiming the recipient and recording the attempt must commit together;
    // otherwise a crash between two writes can strand a send without history.
    const claimBatch = await getD1().batch([
      getD1().prepare(
        `UPDATE whatsapp_campaign_recipients
         SET status='sending', locked_at=?, delivery_token=?, error=NULL, updated_at=?
         WHERE id=? AND status IN ('queued','failed')
           AND EXISTS (SELECT 1 FROM whatsapp_campaigns AS c WHERE c.id=? AND c.status <> 'paused')`,
      ).bind(claimedAt, deliveryToken, claimedAt, recipient.id, id),
      getD1().prepare(
        `INSERT INTO whatsapp_campaign_delivery_attempts
          (id,recipient_id,delivery_token,meta_message_id,status,error,created_at,updated_at)
         SELECT ?,id,?,NULL,'sending',NULL,?,?
         FROM whatsapp_campaign_recipients
         WHERE id=? AND status='sending' AND delivery_token=?`,
      ).bind(attemptId, deliveryToken, claimedAt, claimedAt, recipient.id, deliveryToken),
    ]);
    const claimed = Number(claimBatch[0]?.meta?.changes ?? 0) === 1;
    if (!claimed) continue;
    let providerAccepted = false;
    let providerMetaMessageId: string | null = null;
    try {
      const result = await sendWhatsAppMessage(recipient.phone, { type: "template", template: { name: campaign.templateName, language: { code: campaign.templateLanguage } }, biz_opaque_callback_data: deliveryToken });
      providerAccepted = true;
      providerMetaMessageId = result.messages?.[0]?.id?.trim() || null;
      if (!providerMetaMessageId) {
        await db.update(whatsappCampaignRecipients)
          .set({ status: "uncertain", error: "Meta aceptó una respuesta sin ID de mensaje; reconcilia el callback antes de reintentar.", attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
          .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.status, "sending")));
        await db.update(whatsappCampaignDeliveryAttempts).set({ status: "uncertain", error: "Meta aceptó una respuesta sin ID de mensaje; reconcilia el callback antes de reintentar.", updatedAt: new Date().toISOString() }).where(and(eq(whatsappCampaignDeliveryAttempts.deliveryToken, deliveryToken), eq(whatsappCampaignDeliveryAttempts.status, "sending")));
        continue;
      }
      await db.update(whatsappCampaignDeliveryAttempts)
        .set({ metaMessageId: providerMetaMessageId, status: sql`CASE WHEN ${whatsappCampaignDeliveryAttempts.status}='sending' THEN 'sent' ELSE ${whatsappCampaignDeliveryAttempts.status} END`, updatedAt: new Date().toISOString() })
        .where(eq(whatsappCampaignDeliveryAttempts.deliveryToken, deliveryToken));
      const [updated] = await db.update(whatsappCampaignRecipients)
        .set({ status: sql`CASE WHEN ${whatsappCampaignRecipients.status}='sending' THEN 'sent' ELSE ${whatsappCampaignRecipients.status} END`, metaMessageId: providerMetaMessageId, attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
        .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.deliveryToken, deliveryToken), inArray(whatsappCampaignRecipients.status, ["sending", "sent", "delivered", "read", "failed"])))
        .returning({ id: whatsappCampaignRecipients.id });
      if (updated) sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta failure";
      const uncertain = providerAccepted || /WHATSAPP_PROVIDER_RESPONSE_INVALID|META_GRAPH_(?:429|5\d\d)|timeout|timed out|abort|network|fetch failed/i.test(message);
      const [updated] = await db.update(whatsappCampaignRecipients)
        .set({ status: uncertain ? "uncertain" : "failed", metaMessageId: providerMetaMessageId, error: message.slice(0, 500), attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
        .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.status, "sending")))
        .returning({ id: whatsappCampaignRecipients.id });
      await db.update(whatsappCampaignDeliveryAttempts)
        .set({ status: uncertain ? "uncertain" : "failed", error: message.slice(0, 500), updatedAt: new Date().toISOString() })
        .where(and(eq(whatsappCampaignDeliveryAttempts.deliveryToken, deliveryToken), eq(whatsappCampaignDeliveryAttempts.status, "sending")));
      if (updated) failed += 1;
    }
  }
  const summary = await refreshWhatsAppCampaignSummary(getD1(), id, new Date().toISOString());
  return Response.json({ ok: true, processed: summary?.processed ?? sent + failed, remaining: summary?.active ?? 0 });
}
