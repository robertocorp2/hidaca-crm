import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { database } from "./prospecting-support";
import {
  acquireWriteLease,
  assertWriteLeaseActive,
  enterMaintenance,
  getMaintenanceStatus,
  maintenanceResponse,
  reopenMaintenance,
  releaseWriteLease,
  withWriteLease,
} from "../app/lib/write-barrier";
import { reconcileRollback } from "../app/lib/rollback-reconciliation";

test("production writer entry points stay behind the shared barrier", async () => {
  const [worker, gateway, scheduled, webhook] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/ecf-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/prospecting.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/whatsapp/webhook/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /withWriteLease\(env\.DB, writerKind\(url\.pathname\)/);
  assert.match(worker, /WRITE_LEASE_ID_HEADER/);
  assert.match(worker, /WRITE_LEASE_GENERATION_HEADER/);
  assert.match(gateway, /withWriteLease\(env\.DB, "ecf-gateway"/);
  assert.match(scheduled, /withWriteLease\(env\.DB, "prospecting-scheduled"/);
  assert.match(webhook, /assertRequestWriteLease\(d1, request\)/);
});

test("write leases are visible, fenced, and released", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:test", "request-1");
    const active = await getMaintenanceStatus(binding);
    assert.equal(active.mode, "open");
    assert.equal(active.activeWriterCount, 1);
    assert.equal(active.activeWriters[0]?.requestId, "request-1");
    await assertWriteLeaseActive(binding, lease);
    await releaseWriteLease(binding, lease);
    assert.equal((await getMaintenanceStatus(binding)).activeWriterCount, 0);
  } finally {
    sqlite.close();
  }
});

test("entering maintenance drains old-generation writers and fences new ones", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:slow", "request-slow");
    const entering = enterMaintenance(binding, { reason: "staging drill", operatorEmail: "admin@example.com", timeoutMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await getMaintenanceStatus(binding)).mode, "maintenance");
    await assert.rejects(() => acquireWriteLease(binding, "api:new", "request-new"), { code: "MAINTENANCE_MODE" });
    await releaseWriteLease(binding, lease);
    const status = await entering;
    assert.equal(status.mode, "maintenance");
    assert.equal(status.activeWriterCount, 0);
    await assert.rejects(() => assertWriteLeaseActive(binding, lease), { code: "MAINTENANCE_MODE" });
    const reopened = await reopenMaintenance(binding, "admin@example.com");
    assert.equal(reopened.mode, "open");
    const next = await acquireWriteLease(binding, "api:after-reopen", "request-after-reopen");
    await releaseWriteLease(binding, next);
  } finally {
    sqlite.close();
  }
});

test("reopen refuses to bypass an active drain", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:slow", "request-slow");
    sqlite.prepare("UPDATE maintenance_state SET mode='maintenance', generation=generation+1, activated_at='2026-09-14T04:00:00.000Z', updated_at='2026-09-14T04:00:00.000Z' WHERE id=1").run();
    await assert.rejects(() => reopenMaintenance(binding, "admin@example.com"), { code: "MAINTENANCE_DRAIN_TIMEOUT" });
    await releaseWriteLease(binding, lease);
  } finally {
    sqlite.close();
  }
});

test("an expired unreleased lease remains an unknown writer until resolved", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:unknown", "request-unknown", 1_000);
    sqlite.prepare("UPDATE write_leases SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", lease.id);
    await assert.rejects(
      () => enterMaintenance(binding, { reason: "expired lease drill", operatorEmail: "admin@example.com", timeoutMs: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "MAINTENANCE_DRAIN_TIMEOUT");
        assert.equal((error as { activeWriters?: Array<{ id: string }> }).activeWriters?.[0]?.id, lease.id);
        return true;
      },
    );
    await releaseWriteLease(binding, lease, "failed");
  } finally {
    sqlite.close();
  }
});

test("maintenance mode response is retryable and does not cache", () => {
  const response = maintenanceResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rollback reconciliation reports missing, orphaned, and post-snapshot evidence", async () => {
  const { binding, sqlite } = database();
  try {
    sqlite.prepare("INSERT INTO documents (id,name,object_key,content_type,size,created_by,created_at) VALUES (?,?,?,?,?,?,?)").run("document-1", "Evidence", "documents/missing.pdf", "application/pdf", 10, "admin@example.com", "2026-09-14T03:00:00.000Z");
    sqlite.prepare("INSERT INTO audit_log (actor_email,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)").run("admin@example.com", "upload", "document", "document-1", "", "2026-09-14T05:00:00.000Z");
    const report = await reconcileRollback(binding, {
      async list() {
        return { objects: [{ key: "documents/missing.pdf" }, { key: "unexpected/file.bin", uploaded: "2026-09-14T05:00:00.000Z" }, { key: "backups/restore-proof.json" }], truncated: false };
      },
    }, "2026-09-14T04:00:00.000Z");
    assert.deepEqual(report.r2.missingReferencedObjects, []);
    assert.deepEqual(report.r2.orphanedObjects, ["unexpected/file.bin"]);
    assert.deepEqual(report.r2.postSnapshotObjects, ["unexpected/file.bin"]);
    assert.match(report.r2.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.d1.postSnapshot.auditLog.count, 1);
    assert.equal(report.d1.postSnapshot.auditLog.sample[0]?.id, "1");
  } finally {
    sqlite.close();
  }
});

test("the controlled drill drains browser, webhook, scheduled, and blob writers", async () => {
  const { binding, sqlite } = database();
  try {
    const writers = ["api:browser", "whatsapp-webhook", "prospecting-scheduled", "api:blob-upload"];
    const work = Promise.all(writers.map((writerKind, index) => withWriteLease(binding, writerKind, async (lease) => {
      await new Promise((resolve) => setTimeout(resolve, 75 + index * 5));
      assert.ok(lease.id);
    }, `drill-${writerKind}`)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const entering = enterMaintenance(binding, { reason: "controlled staging drill", operatorEmail: "admin@example.com", timeoutMs: 1_000 });
    const completed = await work;
    const drained = await entering;
    assert.equal(drained.activeWriterCount, 0);
    assert.equal(completed.length, writers.length);
    assert.equal(drained.mode, "maintenance");
  } finally {
    sqlite.close();
  }
});
