import { authorizeApi } from "../../../lib/authorization";
import { permissionCatalog } from "../../../lib/user-permissions";

export async function GET() {
  const auth = await authorizeApi({ module: "usuarios", action: "view" });
  if (!auth.ok) return auth.response;
  return Response.json(permissionCatalog());
}
