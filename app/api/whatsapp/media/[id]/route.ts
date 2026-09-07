import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { whatsappMessages } from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { env } from "cloudflare:workers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi({ module: "whatsapp", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const [message] = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.id, id)).limit(1);
  if (!message?.mediaKey) return Response.json({ error: "Media no encontrada." }, { status: 404 });
  const object = await env.FILES.get(message.mediaKey);
  if (!object) return Response.json({ error: "Media no encontrada." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": message.contentType ?? "application/octet-stream", "Content-Disposition": `inline; filename="${(message.fileName ?? "archivo").replace(/[^\w. -]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
