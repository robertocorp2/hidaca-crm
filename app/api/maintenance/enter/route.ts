import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { enterMaintenance, MaintenanceDrainTimeoutError } from "../../../lib/write-barrier";

export async function POST(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    // An empty body is a valid operator request; the default reason is useful
    // for emergency restores where the operator is moving quickly.
  }
  const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : "rollback";
  const timeoutMs = typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs) ? payload.timeoutMs : undefined;
  try {
    return Response.json(await enterMaintenance(getD1(), { reason, operatorEmail: auth.user.email, timeoutMs }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MaintenanceDrainTimeoutError) {
      return Response.json({ error: error.message, code: error.code, activeWriterCount: error.activeWriters.length, activeWriters: error.activeWriters }, { status: 409, headers: { "cache-control": "no-store", "retry-after": "1" } });
    }
    throw error;
  }
}
