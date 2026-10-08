import { getD1 } from "../../../db";
import { env } from "cloudflare:workers";
import { authorizeApi } from "../../lib/authorization";
import { getMaintenanceStatus } from "../../lib/write-barrier";

export async function GET() {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  return Response.json(await getMaintenanceStatus(getD1(), env.FILES), { headers: { "cache-control": "private, no-store" } });
}
