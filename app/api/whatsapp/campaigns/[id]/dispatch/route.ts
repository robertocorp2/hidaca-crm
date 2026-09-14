import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { whatsappCampaignRecipients, whatsappCampaigns } from "../../../../../../db/schema";
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
    const [claimed] = await db.update(whatsappCampaignRecipients)
      .set({ status: "sending", lockedAt: claimedAt, deliveryToken: `${recipient.id}:${recipient.attempts + 1}`, error: null, updatedAt: claimedAt })
      .where(and(eq(whatsappCampaignRecipients.id, recipient.id), inArray(whatsappCampaignRecipients.status, ["queued", "failed"])))
      .returning({ id: whatsappCampaignRecipients.id });
    if (!claimed) continue;
    try {
      const deliveryToken = `${recipient.id}:${recipient.attempts + 1}`;
      const result = await sendWhatsAppMessage(recipient.phone, { type: "template", template: { name: campaign.templateName, language: { code: campaign.templateLanguage } }, biz_opaque_callback_data: deliveryToken });
      const metaMessageId = result.messages?.[0]?.id?.trim();
      if (!metaMessageId) {
        await db.update(whatsappCampaignRecipients)
          .set({ status: "uncertain", error: "Meta aceptó una respuesta sin ID de mensaje; reconcilia el callback antes de reintentar.", attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
          .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.status, "sending")));
        continue;
      }
      const [updated] = await db.update(whatsappCampaignRecipients)
        .set({ status: "sent", metaMessageId, attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
        .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.status, "sending")))
        .returning({ id: whatsappCampaignRecipients.id });
      if (updated) sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta failure";
      const uncertain = /timeout|timed out|abort|network|fetch failed/i.test(message);
      const [updated] = await db.update(whatsappCampaignRecipients)
        .set({ status: uncertain ? "uncertain" : "failed", error: message.slice(0, 500), attempts: recipient.attempts + 1, lockedAt: null, updatedAt: new Date().toISOString() })
        .where(and(eq(whatsappCampaignRecipients.id, recipient.id), eq(whatsappCampaignRecipients.status, "sending")))
        .returning({ id: whatsappCampaignRecipients.id });
      if (updated) failed += 1;
    }
  }
  const summary = await refreshWhatsAppCampaignSummary(getD1(), id, new Date().toISOString());
  return Response.json({ ok: true, processed: summary?.processed ?? sent + failed, remaining: summary?.active ?? 0 });
}
