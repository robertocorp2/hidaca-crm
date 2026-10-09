import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { reconcileRollback, type RollbackFiles } from "../../../lib/rollback-reconciliation";

export async function GET(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const snapshotAt = new URL(request.url).searchParams.get("snapshotAt")?.trim() ?? "";
  if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt))) {
    return Response.json({ error: "snapshotAt debe ser una fecha RFC3339 válida." }, { status: 400 });
  }
  if (!env.FILES) return Response.json({ error: "El binding R2 FILES no está disponible." }, { status: 503 });
  const result = await reconcileRollback(getD1(), env.FILES as unknown as RollbackFiles, new Date(snapshotAt).toISOString());
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
