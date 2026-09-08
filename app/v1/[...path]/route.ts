import { env } from "cloudflare:workers";
import { getD1 } from "../../../db";
import { authorizeApi } from "../../lib/authorization";
import { handleApi } from "../../lib/prospecting/api";
import { HIDACA_TENANT } from "../../lib/prospecting/crm";
import { Repository } from "../../lib/prospecting/repository";
import { ProspectingService } from "../../lib/prospecting/service";
type RouteContext = { params: Promise<{ path: string[] }> };
async function route(request: Request, { params }: RouteContext) {
  const requestId = crypto.randomUUID(), auth = await authorizeApi();
  if (!auth.ok) return Response.json({ apiVersion: "v1", requestId, error: { code: auth.response.status === 401 ? "unauthorized" : "forbidden", message: "Acceso restringido.", retryable: false } }, { status: auth.response.status, headers: { "Cache-Control": "no-store" } });
  return handleApi(request, (await params).path, { tenantId: HIDACA_TENANT, actor: auth.user.email, role: auth.user.role, requestId }, new ProspectingService(new Repository(getD1()), env));
}
export { route as GET, route as POST, route as PUT, route as DELETE };
