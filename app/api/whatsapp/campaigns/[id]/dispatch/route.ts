import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { whatsappCampaignRecipients, whatsappCampaigns } from "../../../../../../db/schema";
import { authorizeApi } from "../../../../../lib/authorization";
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
  const recipients = await db.select().from(whatsappCampaignRecipients).where(and(eq(whatsappCampaignRecipients.campaignId, id), inArray(whatsappCampaignRecipients.status, ["queued", "failed"]))).limit(25);
  let sent = 0; let failed = 0;
  for (const recipient of recipients) {
    try {
      const result = await sendWhatsAppMessage(recipient.phone, { type: "template", template: { name: campaign.templateName, language: { code: campaign.templateLanguage } } });
      await db.update(whatsappCampaignRecipients).set({ status: "sent", metaMessageId: result.messages?.[0]?.id ?? null, attempts: recipient.attempts + 1, updatedAt: new Date().toISOString() }).where(eq(whatsappCampaignRecipients.id, recipient.id));
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta failure";
      const uncertain = /timeout|timed out|abort|network|fetch failed/i.test(message);
      await db.update(whatsappCampaignRecipients).set({ status: uncertain ? "uncertain" : "failed", error: message.slice(0, 500), attempts: recipient.attempts + 1, updatedAt: new Date().toISOString() }).where(eq(whatsappCampaignRecipients.id, recipient.id));
      failed += 1;
    }
  }
  const remaining = await db.select({ id: whatsappCampaignRecipients.id }).from(whatsappCampaignRecipients).where(and(eq(whatsappCampaignRecipients.campaignId, id), inArray(whatsappCampaignRecipients.status, ["queued", "failed"])));
  await db.update(whatsappCampaigns).set({ status: remaining.length ? "running" : "completed", processed: campaign.processed + sent + failed, sent: campaign.sent + sent, failed: campaign.failed + failed, updatedAt: new Date().toISOString(), finishedAt: remaining.length ? null : new Date().toISOString() }).where(eq(whatsappCampaigns.id, id));
  return Response.json({ ok: true, processed: sent + failed, remaining: remaining.length });
}
