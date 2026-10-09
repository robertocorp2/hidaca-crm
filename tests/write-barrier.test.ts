import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { database } from "./prospecting-support";
import type { MaintenanceBucket } from "../app/lib/maintenance-authority";
import {
  acquireWriteLease,
  assertWriteLeaseActive,
  enterMaintenance,
  getMaintenanceStatus,
  maintenanceResponse,
  reopenMaintenance,
  renewWriteLease,
  releaseWriteLease,
  withWriteLease,
} from "../app/lib/write-barrier";
import { captureRollbackInventory, compareRollbackInventory, reconcileRollback } from "../app/lib/rollback-reconciliation";
import ecfGateway from "../worker/ecf-gateway";

test("production writer entry points stay behind the shared barrier", async () => {
  const [worker, gateway, scheduled, webhook] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/ecf-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/prospecting.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/whatsapp/webhook/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /withWriteLease\(env\.DB, env\.FILES, writerKind\(url\.pathname\)/);
  assert.match(worker, /WRITE_LEASE_ID_HEADER/);
  assert.match(worker, /WRITE_LEASE_GENERATION_HEADER/);
  assert.match(gateway, /withWriteLease\(env\.DB, env\.FILES, "ecf-gateway"/);
  assert.match(scheduled, /withWriteLease\(env\.DB, env\.FILES, "prospecting-scheduled"/);
  assert.match(webhook, /assertRequestWriteLease\(d1, getFiles\(\), request\)/);
});

test("write leases are visible, fenced, and released", async () => {
  const { binding, sqlite, files } = database();
  try {
    const lease = await acquireWriteLease(binding, files, "api:test", "request-1");
    const active = await getMaintenanceStatus(binding, files);
    assert.equal(active.mode, "open");
    assert.equal(active.activeWriterCount, 1);
    assert.equal(active.activeWriters[0]?.requestId, "request-1");
    await assertWriteLeaseActive(binding, files, lease);
    await releaseWriteLease(binding, lease);
    assert.equal((await getMaintenanceStatus(binding, files)).activeWriterCount, 0);
  } finally {
    sqlite.close();
  }
});

test("failed writers are marked failed and do not block a later drain", async () => {
  const { binding, sqlite, files } = database();
  try {
    await assert.rejects(
      () => withWriteLease(binding, files, "api:failed", async () => {
        throw new Error("synthetic writer failure");
      }, "request-failed"),
      /synthetic writer failure/,
    );
    assert.equal((await getMaintenanceStatus(binding, files)).activeWriterCount, 0);
    const row = sqlite.prepare("SELECT outcome FROM write_leases WHERE request_id = ?").get("request-failed") as { outcome?: string } | undefined;
    assert.equal(row?.outcome, "failed");
  } finally {
    sqlite.close();
  }
});

test("entering maintenance drains old-generation writers and fences new ones", async () => {
  const { binding, sqlite, files } = database();
  try {
    const lease = await acquireWriteLease(binding, files, "api:slow", "request-slow");
    const entering = enterMaintenance(binding, { reason: "staging drill", operatorEmail: "admin@example.com", timeoutMs: 1_000 }, files);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await getMaintenanceStatus(binding, files)).mode, "maintenance");
    await assert.rejects(() => acquireWriteLease(binding, files, "api:new", "request-new"), { code: "MAINTENANCE_MODE" });
    await releaseWriteLease(binding, lease);
    const status = await entering;
    assert.equal(status.mode, "maintenance");
    assert.equal(status.activeWriterCount, 0);
    await assert.rejects(() => assertWriteLeaseActive(binding, files, lease), { code: "MAINTENANCE_MODE" });
    const reopened = await reopenMaintenance(binding, "admin@example.com", files);
    assert.equal(reopened.mode, "open");
    const next = await acquireWriteLease(binding, files, "api:after-reopen", "request-after-reopen");
    await releaseWriteLease(binding, next);
  } finally {
    sqlite.close();
  }
});

test("reopen refuses to bypass an active drain", async () => {
  const { binding, sqlite, files } = database();
  try {
    const lease = await acquireWriteLease(binding, files, "api:slow", "request-slow");
    sqlite.prepare("UPDATE maintenance_state SET mode='maintenance', generation=generation+1, activated_at='2026-09-14T04:00:00.000Z', updated_at='2026-09-14T04:00:00.000Z' WHERE id=1").run();
    await assert.rejects(() => reopenMaintenance(binding, "admin@example.com", files), { code: "MAINTENANCE_DRAIN_TIMEOUT" });
    await releaseWriteLease(binding, lease);
  } finally {
    sqlite.close();
  }
});

test("an expired unreleased lease remains an unknown writer until resolved", async () => {
  const { binding, sqlite, files } = database();
  try {
    const lease = await acquireWriteLease(binding, files, "api:unknown", "request-unknown", 1_000);
    sqlite.prepare("UPDATE write_leases SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", lease.id);
    await assert.rejects(
      () => enterMaintenance(binding, { reason: "expired lease drill", operatorEmail: "admin@example.com", timeoutMs: 0 }, files),
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

test("maintenance survives a D1 restore", async () => {
  const first = database();
  await enterMaintenance(first.binding, { reason: "restore drill", operatorEmail: "admin@example.com" }, first.files);
  first.sqlite.close();
  const restored = database();
  try {
    await assert.rejects(
      () => acquireWriteLease(restored.binding, first.files, "api:restored", "restored-request"),
      { code: "MAINTENANCE_MODE" },
    );
    assert.equal((await getMaintenanceStatus(restored.binding, first.files)).mode, "maintenance");
  } finally {
    restored.sqlite.close();
  }
});

test("missing authoritative maintenance state fails closed", async () => {
  const { binding, sqlite } = database();
  const missing = { async get() { return null; } } as unknown as MaintenanceBucket;
  try {
    await assert.rejects(
      () => acquireWriteLease(binding, missing, "api:missing-authority", "missing-authority-request"),
      { code: "MAINTENANCE_AUTHORITY_UNAVAILABLE" },
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM write_leases").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("rollback reconciliation reports missing, orphaned, and post-snapshot evidence", async () => {
  const { binding, sqlite } = database();
  try {
    sqlite.prepare("INSERT INTO documents (id,name,object_key,content_type,size,created_by,created_at) VALUES (?,?,?,?,?,?,?)").run("document-1", "Evidence", "documents/missing.pdf", "application/pdf", 10, "admin@example.com", "2026-09-14T03:00:00.000Z");
    sqlite.prepare("INSERT INTO audit_log (actor_email,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)").run("admin@example.com", "upload", "document", "document-1", "", "2026-09-14T05:00:00.000Z");
    sqlite.prepare("INSERT INTO whatsapp_webhook_events (event_hash,event_type,processing_status,received_at) VALUES (?,?,?,?)").run("rollback-event", "message", "processing", "2026-09-14T03:00:00.000Z");
    const report = await reconcileRollback(binding, {
      async get() { return { etag: "test", async json<T>() { return { schemaVersion: 1, revision: 2, mode: "maintenance", reason: "drill", operatorEmail: "admin@example.com", activatedAt: "2026-09-14T04:00:01.000Z", updatedAt: "2026-09-14T04:00:01.000Z" } as T; } }; },
      async list() {
        return { objects: [{ key: "documents/missing.pdf" }, { key: "unexpected/file.bin", uploaded: "2026-09-14T05:00:00.000Z" }, { key: "backups/restore-proof.json" }, { key: "__control/maintenance-state.v1.json", uploaded: "2026-09-14T05:00:00.000Z" }], truncated: false };
      },
    }, "2026-09-14T04:00:00.000Z");
    assert.deepEqual(report.r2.missingReferencedObjects, []);
    assert.deepEqual(report.r2.orphanedObjects, ["unexpected/file.bin"]);
    assert.deepEqual(report.r2.postSnapshotObjects, ["unexpected/file.bin"]);
    assert.deepEqual(report.r2.maintenanceAuthority, { present: true, mode: "maintenance", revision: 2, updatedAfterSnapshot: true });
    assert.match(report.r2.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.d1.postSnapshot.auditLog.count, 1);
    assert.equal(report.d1.postSnapshot.auditLog.sample[0]?.id, "1");
    assert.equal(report.d1.unresolvedWriters.whatsappWebhooks.count, 1);
    assert.equal(report.d1.unresolvedWriters.whatsappWebhooks.sample[0]?.id, "1");
  } finally {
    sqlite.close();
  }
});

test("rollback reconciliation separates the drill's own maintenance-entry audit", async () => {
  const { binding, sqlite, files } = database();
  try {
    const snapshotAt = new Date(Date.now() - 5_000).toISOString();
    await enterMaintenance(binding, { reason: "controlled staging drill", operatorEmail: "admin@example.com" }, files);
    const report = await reconcileRollback(binding, {
      get: files.get.bind(files),
      async list() { return { objects: [{ key: "__control/maintenance-state.v1.json", uploaded: new Date() }], truncated: false }; },
    }, snapshotAt);
    assert.equal(report.d1.postSnapshot.auditLog.count, 0);
    assert.equal(report.d1.maintenanceEntryAudit.count, 1);
    assert.equal(report.d1.maintenanceEntryAudit.sample.length, 1);
    assert.deepEqual(report.r2.postSnapshotObjects, []);
    assert.deepEqual(report.r2.orphanedObjects, []);
    assert.equal(report.r2.maintenanceAuthority.present, true);
    assert.equal(report.r2.maintenanceAuthority.mode, "maintenance");
    assert.equal(report.r2.maintenanceAuthority.updatedAfterSnapshot, true);
  } finally {
    sqlite.close();
  }
});

test("rollback reconciliation flags projects and every project row created after the snapshot", async () => {
  const { binding, sqlite, files } = database();
  try {
    const createdAt = "2026-09-14T05:00:00.000Z";
    sqlite.prepare("INSERT INTO businesses (id, name, normalized_name, owner_email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("business-rollback", "Post-snapshot business", "post-snapshot business", "owner@example.test", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO contacts (id, business_id, name, owner_email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("contact-rollback", "business-rollback", "Project contact", "owner@example.test", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO projects (id, business_id, name, owner_email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("project-after-snapshot", "business-rollback", "New project", "owner@example.test", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO addresses (id, project_id, type, line1, created_by, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?, ?)")
      .run("address-after-snapshot", "project-after-snapshot", "Main street", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO project_locations (id, project_id, address_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("location-after-snapshot", "project-after-snapshot", "address-after-snapshot", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO project_contacts (project_id, contact_id, created_by, created_at) VALUES (?, ?, ?, ?)")
      .run("project-after-snapshot", "contact-rollback", "owner@example.test", createdAt);
    sqlite.prepare("INSERT INTO search_documents (entity_type, entity_id, title, owner_email, updated_at) VALUES ('project', ?, ?, ?, ?)")
      .run("project-after-snapshot", "New project", "owner@example.test", createdAt);
    sqlite.prepare("INSERT INTO entity_history (entity_type, entity_id, action, actor_email, created_at) VALUES ('project', ?, 'created', ?, ?)")
      .run("project-after-snapshot", "owner@example.test", createdAt);

    const report = await reconcileRollback(binding, {
      get: files.get.bind(files),
      async list() { return { objects: [], truncated: false }; },
    }, "2026-09-14T04:00:00.000Z");
    for (const item of ["projects", "projectAddresses", "projectLocations", "projectContacts", "projectSearchDocuments", "projectHistory"] as const) {
      assert.equal(report.d1.postSnapshot[item].count, 1, `${item} must be reported after snapshot restore`);
    }
    assert.equal(report.d1.postSnapshot.projects.sample[0]?.id, "project-after-snapshot");
  } finally {
    sqlite.close();
  }
});

test("rollback restore evidence survives D1 restore and reports erased post-snapshot rows", async () => {
  const { binding, sqlite } = database();
  try {
    const snapshotAt = "2026-09-14T04:00:00.000Z";
    const createdAt = "2026-09-14T05:00:00.000Z";
    sqlite.prepare("INSERT INTO businesses (id, name, normalized_name, owner_email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("restore-business", "Restore test", "restore test", "owner@example.test", "owner@example.test", createdAt, createdAt);
    sqlite.prepare("INSERT INTO projects (id, business_id, name, owner_email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("erased-project", "restore-business", "Post-snapshot project", "owner@example.test", "owner@example.test", createdAt, createdAt);

    const files = { get: async () => null, async list() { return { objects: [], truncated: false }; } };
    const beforeRestore = await reconcileRollback(binding, files, snapshotAt);
    const beforeInventory = await captureRollbackInventory(binding, snapshotAt);
    assert.equal(beforeRestore.d1.postSnapshot.projects.count, 1);
    assert.equal(beforeInventory.projects.length, 1);

    sqlite.prepare("DELETE FROM projects WHERE id = ?").run("erased-project");
    const afterRestore = await reconcileRollback(binding, files, snapshotAt);
    const afterInventory = await captureRollbackInventory(binding, snapshotAt);
    const evidence = compareRollbackInventory(beforeInventory, afterInventory, beforeRestore.checkedAt);
    assert.equal(afterRestore.d1.postSnapshot.projects.count, 0);
    assert.equal(evidence.erasedPostSnapshot.projects.count, 1);
    assert.equal(evidence.erasedPostSnapshot.projects.sample[0]?.id, "erased-project");
    assert.equal(evidence.erasedPostSnapshot.businesses, undefined);
  } finally {
    sqlite.close();
  }
});

test("rollback reconciliation flags post-snapshot quotation edits recorded only in entity history", async () => {
  const { binding, sqlite, files } = database();
  try {
    sqlite.prepare("INSERT INTO entity_history (entity_type, entity_id, action, actor_email, created_at) VALUES ('quotation', ?, 'updated', ?, ?)")
      .run("quotation-after-snapshot", "owner@example.test", "2026-09-14T05:00:00.000Z");

    const report = await reconcileRollback(binding, {
      get: files.get.bind(files),
      async list() { return { objects: [], truncated: false }; },
    }, "2026-09-14T04:00:00.000Z");

    assert.equal(report.d1.postSnapshot.entityHistory.count, 1);
    assert.equal(report.d1.postSnapshot.entityHistory.sample[0]?.id, "1");
    assert.equal(report.d1.postSnapshot.auditLog.count, 0);
  } finally {
    sqlite.close();
  }
});

test("a failed authority renewal keeps the active D1 lease visible to maintenance drain", async () => {
  const { binding, sqlite, files } = database();
  try {
    const lease = await acquireWriteLease(binding, files, "api:renewal-test", "renewal-request");
    const before = sqlite.prepare("SELECT expires_at FROM write_leases WHERE id = ?").get(lease.id) as { expires_at: string };
    await assert.rejects(
      () => enterMaintenance(binding, { reason: "drain test", operatorEmail: "admin@example.test", timeoutMs: 0 }, files),
      { code: "MAINTENANCE_DRAIN_TIMEOUT" },
    );
    await assert.rejects(
      () => renewWriteLease(binding, lease, { ...files, async get() { throw Object.assign(new Error("authority unavailable"), { code: "MAINTENANCE_AUTHORITY_UNAVAILABLE" }); } }),
      { code: "MAINTENANCE_AUTHORITY_UNAVAILABLE" },
    );
    const after = sqlite.prepare("SELECT expires_at, outcome FROM write_leases WHERE id = ?").get(lease.id) as { expires_at: string; outcome: string | null };
    assert.notEqual(after.expires_at, before.expires_at);
    assert.equal(after.outcome, null);
    assert.equal((await getMaintenanceStatus(binding, files)).activeWriterCount, 1);
  } finally {
    sqlite.close();
  }
});

test("rollback reconciliation verifies ECF inbound XML references and rejects legacy untracked rows", async () => {
  const { binding, sqlite, files } = database();
  try {
    const snapshotAt = new Date(Date.now() + 60_000).toISOString();
    sqlite.prepare("INSERT INTO ecf_inbound_messages (id, environment, operation, object_key, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("ecf-1", "test", "ecf", "ecf-gateway/inbound/test/ecf-1.xml", new Date().toISOString());
    sqlite.prepare("INSERT INTO ecf_inbound_messages (id, environment, operation, created_at) VALUES (?, ?, ?, ?)")
      .run("legacy-ecf", "test", "ecf", new Date().toISOString());
    const report = await reconcileRollback(binding, {
      get: files.get.bind(files),
      async list() { return { objects: [{ key: "__control/maintenance-state.v1.json" }], truncated: false }; },
    }, snapshotAt);
    assert.deepEqual(report.r2.missingReferencedObjects, ["ecf-gateway/inbound/test/ecf-1.xml"]);
    assert.equal(report.d1.untrackedInboundMessages.count, 1);
    assert.equal(report.d1.untrackedInboundMessages.sample[0]?.id, "legacy-ecf");
  } finally {
    sqlite.close();
  }
});

test("ECF gateway persists the inbound XML key alongside its D1 row", async () => {
  const { binding, sqlite, files } = database();
  const objects = new Map<string, string>();
  const bucket = {
    get: files.get.bind(files),
    async put(key: string, body: string | Uint8Array, options?: { onlyIf?: { etagMatches: string } }) {
      if (key === "__control/maintenance-state.v1.json") return files.put(key, String(body), options as Parameters<MaintenanceBucket["put"]>[2]);
      objects.set(key, new TextDecoder().decode(body instanceof Uint8Array ? body : new TextEncoder().encode(body)));
      return { etag: "test-object" };
    },
  } as unknown as R2Bucket;
  try {
    const xml = "<ECF><eNCF>E310000000001</eNCF><RNCEmisor>101010101</RNCEmisor><Signature>test</Signature></ECF>";
    const response = await ecfGateway.fetch(new Request("https://ecf-staging.example.test/fe/recepcion/api/ecf", { method: "POST", body: xml }), { DB: binding, FILES: bucket, ECF_GATEWAY_ENABLED: "true" });
    assert.equal(response.status, 200);
    const row = sqlite.prepare("SELECT id, object_key FROM ecf_inbound_messages").get() as { id: string; object_key: string };
    assert.ok(row.object_key.endsWith(`/${row.id}.xml`));
    assert.equal(objects.get(row.object_key), xml);
  } finally {
    sqlite.close();
  }
});

test("the controlled drill drains browser, webhook, scheduled, and blob writers", async () => {
  const { binding, sqlite, files } = database();
  try {
    const writers = ["api:browser", "whatsapp-webhook", "prospecting-scheduled", "api:blob-upload"];
    const work = Promise.all(writers.map((writerKind, index) => withWriteLease(binding, files, writerKind, async (lease) => {
      await new Promise((resolve) => setTimeout(resolve, 75 + index * 5));
      assert.ok(lease.id);
    }, `drill-${writerKind}`)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const entering = enterMaintenance(binding, { reason: "controlled staging drill", operatorEmail: "admin@example.com", timeoutMs: 1_000 }, files);
    const completed = await work;
    const drained = await entering;
    assert.equal(drained.activeWriterCount, 0);
    assert.equal(completed.length, writers.length);
    assert.equal(drained.mode, "maintenance");
  } finally {
    sqlite.close();
  }
});
