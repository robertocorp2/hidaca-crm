import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { MaintenanceDrainTimeoutError, reopenMaintenance } from "../../../lib/write-barrier";

export async function POST() {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await reopenMaintenance(getD1(), auth.user.email), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MaintenanceDrainTimeoutError) {
      return Response.json({ error: error.message, code: error.code, activeWriterCount: error.activeWriters.length, activeWriters: error.activeWriters }, { status: 409, headers: { "cache-control": "no-store", "retry-after": "1" } });
    }
    throw error;
  }
}
