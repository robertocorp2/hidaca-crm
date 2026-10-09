import { getD1, getFiles } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { MaintenanceDrainTimeoutError, MaintenanceStateConflictError, reopenMaintenance } from "../../../lib/write-barrier";

export async function POST() {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await reopenMaintenance(getD1(), auth.user.email, getFiles()), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MaintenanceStateConflictError) {
      return Response.json({ error: error.message, code: error.code }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof MaintenanceDrainTimeoutError) {
      return Response.json({ error: error.message, code: error.code, activeWriterCount: error.activeWriters.length, activeWriters: error.activeWriters }, { status: 409, headers: { "cache-control": "no-store", "retry-after": "1" } });
    }
    throw error;
  }
}
