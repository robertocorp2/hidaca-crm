import { authorizeApi } from "../../../lib/authorization";
import { whatsappConfig } from "../../../lib/whatsapp";

export async function GET() {
  const auth = await authorizeApi({ module: "whatsapp", action: "administer" });
  if (!auth.ok) return auth.response;
  const config = whatsappConfig();
  return Response.json({ ...config, secretsPresent: Boolean(config.configured) });
}
