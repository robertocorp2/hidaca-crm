import { getD1, getFiles } from "../../db";
import {
  assertRequestWriteLease,
  MaintenanceModeError,
  maintenanceResponse,
  withWriteLease,
} from "./write-barrier";

export async function withDocumentWriteLease(
  request: Request,
  writerKind: string,
  operation: () => Promise<Response>,
) {
  const d1 = getD1();
  const files = getFiles();
  const hasWorkerLease =
    request.headers.has("x-hidaca-write-lease") ||
    request.headers.has("x-hidaca-write-generation");
  try {
    if (hasWorkerLease) {
      await assertRequestWriteLease(d1, files, request);
      return await operation();
    }
    return await withWriteLease(d1, files, writerKind, operation);
  } catch (error) {
    if (
      error instanceof MaintenanceModeError ||
      (error as { code?: string })?.code === "MAINTENANCE_AUTHORITY_UNAVAILABLE"
    ) {
      return maintenanceResponse();
    }
    throw error;
  }
}
