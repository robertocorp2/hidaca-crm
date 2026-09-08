import { env } from "cloudflare:workers";
import { authorizeApi } from "../../../lib/authorization";
import { listOllamaModels } from "../../../lib/ai";

export async function GET() {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  try {
    const models = await listOllamaModels(env);
    return Response.json({ models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_PROVIDER_UNAVAILABLE";
    return Response.json({ error: { code: message, message: "No se pudieron cargar los modelos." } }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
