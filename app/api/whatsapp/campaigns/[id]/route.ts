import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { whatsappCampaigns } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const payload = (await request.json()) as { status?: "paused" | "queued" };
  if (!payload.status) return Response.json({ error: "Estado requerido." }, { status: 400 });
  await getDb().update(whatsappCampaigns).set({ status: payload.status, updatedAt: new Date().toISOString() }).where(eq(whatsappCampaigns.id, id));
  return Response.json({ ok: true });
}
