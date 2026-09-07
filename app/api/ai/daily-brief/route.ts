import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { generateDailyBrief, loadDailyBrief } from "../../../lib/daily-brief";
import { writeAudit } from "../../../lib/audit";

function requestedDate(request: Request) {
  const value = new URL(request.url).searchParams.get("date");
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export async function GET(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  const brief = await loadDailyBrief(auth.user, requestedDate(request));
  return Response.json({ brief }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "create" });
  if (!auth.ok) return auth.response;
  const brief = await generateDailyBrief(auth.user, requestedDate(request));
  await writeAudit(auth.user.email, "ai.daily_brief.generate", "ai_daily_brief", brief.id, JSON.stringify({ itemCount: brief.items.length, provider: brief.provider }));
  return Response.json({ brief });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "edit" });
  if (!auth.ok) return auth.response;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  const briefId = String(payload.briefId ?? "").slice(0, 180);
  const itemKey = String(payload.itemKey ?? "").slice(0, 180);
  if (!briefId || !itemKey || payload.status !== "dismissed") return Response.json({ error: "Brief, elemento y estado válidos son obligatorios." }, { status: 400 });
  const now = new Date().toISOString();
  const result = await getD1().prepare(`UPDATE ai_daily_brief_items SET status = 'dismissed', dismissed_by = ?, dismissed_at = ?, updated_at = ? WHERE brief_id = ? AND item_key = ? AND brief_id IN (SELECT id FROM ai_daily_briefs WHERE owner_email = ?) RETURNING id`).bind(auth.user.email, now, now, briefId, itemKey, auth.user.email).all();
  if (!result.results?.length) return Response.json({ error: "El elemento no está disponible." }, { status: 404 });
  await writeAudit(auth.user.email, "ai.daily_brief.dismiss", "ai_daily_brief", briefId, itemKey);
  return Response.json({ ok: true });
}
