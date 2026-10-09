import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { captureRollbackInventory, compareRollbackInventory, reconcileRollback, type RollbackFiles, type RollbackReconciliation, type RollbackSnapshotInventory } from "../../../lib/rollback-reconciliation";
import { getMaintenanceStatus } from "../../../lib/write-barrier";
import type { MaintenanceBucket } from "../../../lib/maintenance-authority";

const inventoryKey = (snapshotAt: string) => `backups/rollback-evidence/${encodeURIComponent(snapshotAt)}.json`;

type StoredInventory = { schemaVersion: 1; snapshotAt: string; report: RollbackReconciliation; inventory: RollbackSnapshotInventory };

export async function GET(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const snapshotAt = params.get("snapshotAt")?.trim() ?? "";
  const phase = params.get("phase");
  if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt))) {
    return Response.json({ error: "snapshotAt debe ser una fecha RFC3339 válida." }, { status: 400 });
  }
  if (phase !== "before-restore" && phase !== "after-restore") {
    return Response.json({ error: "phase debe ser before-restore o after-restore." }, { status: 400 });
  }
  if (!env.FILES) return Response.json({ error: "El binding R2 FILES no está disponible." }, { status: 503 });
  const d1 = getD1();
  const files = env.FILES as unknown as RollbackFiles;
  const normalizedSnapshotAt = new Date(snapshotAt).toISOString();
  const key = inventoryKey(normalizedSnapshotAt);
  if (phase === "before-restore") {
    const maintenance = await getMaintenanceStatus(d1, env.FILES as unknown as MaintenanceBucket);
    if (maintenance.mode !== "maintenance" || maintenance.activeWriterCount !== 0) {
      return Response.json({ error: "La captura requiere mantenimiento activo y cero escritores." , maintenance }, { status: 409 });
    }
    const report = await reconcileRollback(d1, files, normalizedSnapshotAt);
    const inventory = await captureRollbackInventory(d1, normalizedSnapshotAt);
    const stored: StoredInventory = { schemaVersion: 1, snapshotAt: normalizedSnapshotAt, report, inventory };
    const object = await env.FILES.put(key, JSON.stringify(stored), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    });
    if (!object) return Response.json({ error: "Ya existe evidencia previa para este timestamp; no se sobrescribió." }, { status: 409 });
    return Response.json({ ...report, restoreEvidence: { phase, key } }, { headers: { "cache-control": "private, no-store" } });
  }

  const savedObject = await env.FILES.get(key);
  if (!savedObject) return Response.json({ error: "No existe la evidencia externa capturada antes de restaurar." }, { status: 409 });
  const saved = await savedObject.json<StoredInventory>();
  if (saved.schemaVersion !== 1 || saved.snapshotAt !== normalizedSnapshotAt || !saved.report?.d1?.postSnapshot || !saved.inventory) {
    return Response.json({ error: "La evidencia externa de restauración es inválida o no coincide con el timestamp." }, { status: 409 });
  }
  const result = await reconcileRollback(d1, files, normalizedSnapshotAt);
  const restoredInventory = await captureRollbackInventory(d1, normalizedSnapshotAt);
  result.d1.restoreEvidence = compareRollbackInventory(saved.inventory, restoredInventory, saved.report.checkedAt);
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
