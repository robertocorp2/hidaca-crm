import { asc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { whatsappTemplates } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";
import { syncWhatsAppTemplates, whatsappConfig } from "../../../lib/whatsapp";

export async function GET() {
  const auth = await authorizeApi({ module: "whatsapp", action: "view" });
  if (!auth.ok) return auth.response;
  return Response.json({ templates: await getDb().select().from(whatsappTemplates).orderBy(asc(whatsappTemplates.name)) });
}

export async function POST() {
  const auth = await authorizeApi({ module: "whatsapp", action: "administer" });
  if (!auth.ok) return auth.response;
  if (!whatsappConfig().configured) return Response.json({ error: "Meta todavía no está configurado." }, { status: 503 });
  const result = await syncWhatsAppTemplates();
  const now = new Date().toISOString();
  const db = getDb();
  for (const template of result.data ?? []) {
    const name = String(template.name ?? "");
    const language = String(template.language ?? "es");
    if (!name) continue;
    await db.insert(whatsappTemplates).values({ id: String(template.id ?? crypto.randomUUID()), metaId: String(template.id ?? ""), name, language, category: String(template.category ?? "UTILITY"), status: String(template.status ?? "PENDING"), quality: template.quality_score ? JSON.stringify(template.quality_score) : null, components: JSON.stringify(template.components ?? []), syncedAt: now, updatedAt: now }).onConflictDoUpdate({ target: [whatsappTemplates.name, whatsappTemplates.language], set: { status: String(template.status ?? "PENDING"), quality: template.quality_score ? JSON.stringify(template.quality_score) : null, components: JSON.stringify(template.components ?? []), syncedAt: now, updatedAt: now } });
  }
  return Response.json({ ok: true, count: result.data?.length ?? 0 });
}
