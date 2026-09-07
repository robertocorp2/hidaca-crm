import { env } from "cloudflare:workers";
import { authorizeApi } from "../../../lib/authorization";
import { isAiEnabled, providerAvailability } from "../../../lib/ai";

export async function GET() {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  return Response.json({
    enabled: isAiEnabled(env),
    providers: providerAvailability(env),
    policy: {
      fallback: "read_only_idempotent",
      secrets: "server_only",
      transcription: "openai_then_google",
    },
  });
}
