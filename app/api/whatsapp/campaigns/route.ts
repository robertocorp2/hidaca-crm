import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { contacts, leads, whatsappCampaignRecipients, whatsappCampaigns, whatsappTemplates } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";
import { campaignEligible, isWhatsAppCampaignsEnabled, normalizeWhatsAppNumber } from "../../../lib/whatsapp";

export async function GET() {
  const auth = await authorizeApi({ module: "whatsapp", action: "view" });
  if (!auth.ok) return auth.response;
  return Response.json({ campaigns: await getDb().select().from(whatsappCampaigns).orderBy(asc(whatsappCampaigns.updatedAt)) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "whatsapp", action: "create" });
  if (!auth.ok) return auth.response;
  if (!isWhatsAppCampaignsEnabled()) return Response.json({ error: "Las campañas están desactivadas." }, { status: 503 });
  const payload = (await request.json()) as { name?: string; templateId?: string };
  const db = getDb();
  const [template] = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.id, payload.templateId ?? ""), eq(whatsappTemplates.status, "APPROVED"))).limit(1);
  if (!template) return Response.json({ error: "Selecciona una plantilla aprobada." }, { status: 400 });
  const [contactRows, leadRows] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.whatsappConsent, "opted_in"), isNull(contacts.archivedAt))),
    db.select().from(leads).where(and(eq(leads.whatsappConsent, "opted_in"), isNull(leads.archivedAt))),
  ]);
  const recipients = new Map<string, { contactId?: string; leadId?: string; phone: string; displayName: string }>();
  for (const row of contactRows) { const phone = normalizeWhatsAppNumber(row.mobilePhone || row.phone); if (campaignEligible(row.whatsappConsent, phone)) recipients.set(phone, { contactId: row.id, phone, displayName: row.name }); }
  for (const row of leadRows) { const phone = normalizeWhatsAppNumber(row.phone); if (campaignEligible(row.whatsappConsent, phone) && !recipients.has(phone)) recipients.set(phone, { leadId: row.id, phone, displayName: row.contactName }); }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(whatsappCampaigns).values({ id, name: payload.name?.trim() || `Campaña ${now.slice(0, 10)}`, templateId: template.id, templateName: template.name, templateLanguage: template.language, audienceFilter: JSON.stringify({ consent: "opted_in" }), status: "queued", total: recipients.size, processed: 0, sent: 0, failed: 0, createdBy: auth.user.email, startedAt: null, finishedAt: null, updatedAt: now });
  for (const recipient of recipients.values()) await db.insert(whatsappCampaignRecipients).values({ id: crypto.randomUUID(), campaignId: id, contactId: recipient.contactId ?? null, leadId: recipient.leadId ?? null, phone: recipient.phone, displayName: recipient.displayName, status: "queued", metaMessageId: null, error: null, attempts: 0, lockedAt: null, createdAt: now, updatedAt: now });
  return Response.json({ id, total: recipients.size });
}
