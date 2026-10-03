import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./prospecting-support";
import { acquireWriteLease, enterMaintenance, getMaintenanceStatus, releaseWriteLease, reopenMaintenance } from "../app/lib/write-barrier";

// Execute a competing operation after SQLite has returned the state snapshot,
// but before the caller receives it. All SQL still runs against the real fixture.
function afterNextStateRead(binding: ReturnType<typeof database>["binding"], action: () => Promise<void>) {
  const prepare = binding.prepare.bind(binding);
  binding.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.startsWith("SELECT id, mode, generation")) {
      binding.prepare = prepare;
      const first = statement.first.bind(statement);
      statement.first = async <T>(column?: string) => {
        const result = column === undefined ? await first<T>() : await first<T>(column);
        await action();
        return result;
      };
    }
    return statement;
  };
}

test("reopen that observed open cannot undo a newly entered maintenance window", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:slow", "overlapping-enter");
    afterNextStateRead(binding, async () => {
      await assert.rejects(() => enterMaintenance(binding, {
        reason: "new maintenance window", operatorEmail: "other@example.com", timeoutMs: 0,
      }), { code: "MAINTENANCE_DRAIN_TIMEOUT" });
    });

    await reopenMaintenance(binding, "stale@example.com");

    const status = await getMaintenanceStatus(binding);
    assert.equal(status.mode, "maintenance");
    assert.equal(status.generation, lease.generation + 1);
    assert.equal(status.operatorEmail, "other@example.com");
    assert.equal(status.activeWriterCount, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reopen'").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("a stale reopen cannot reopen a newer drained maintenance generation", async () => {
  const { binding, sqlite } = database();
  try {
    const initial = await enterMaintenance(binding, { reason: "first window", operatorEmail: "admin@example.com" });
    afterNextStateRead(binding, async () => {
      await reopenMaintenance(binding, "other@example.com");
      await enterMaintenance(binding, { reason: "second window", operatorEmail: "other@example.com" });
    });

    await assert.rejects(() => reopenMaintenance(binding, "stale@example.com"), { code: "MAINTENANCE_STATE_CONFLICT" });

    const status = await getMaintenanceStatus(binding);
    assert.equal(status.mode, "maintenance");
    assert.equal(status.generation, initial.generation + 2);
    assert.equal(status.reason, "second window");
    assert.equal(status.activeWriterCount, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reopen'").get()?.count, 1);
  } finally {
    sqlite.close();
  }
});

test("reopen checks unresolved writers in the same statement as the transition", async () => {
  const { binding, sqlite } = database();
  try {
    const lease = await acquireWriteLease(binding, "api:unknown", "unresolved-writer");
    await releaseWriteLease(binding, lease);
    const initial = await enterMaintenance(binding, { reason: "drained", operatorEmail: "admin@example.com" });
    const prepare = binding.prepare.bind(binding);
    let interleaved = false;
    binding.prepare = (sql) => {
      if (sql.includes("SET mode = 'open'")) {
        binding.prepare = prepare;
        interleaved = true;
        // Model an unresolved lease discovered after the earlier drain read.
        // Its expired timestamp must not make it safe to ignore.
        sqlite.prepare("UPDATE write_leases SET outcome = NULL, expires_at = ? WHERE id = ?")
          .run("2020-01-01T00:00:00.000Z", lease.id);
      }
      return prepare(sql);
    };

    await assert.rejects(() => reopenMaintenance(binding, "admin@example.com"), { code: "MAINTENANCE_DRAIN_TIMEOUT" });

    assert.equal(interleaved, true);
    const status = await getMaintenanceStatus(binding);
    assert.equal(status.mode, "maintenance");
    assert.equal(status.generation, initial.generation);
    assert.equal(status.activeWriters[0]?.id, lease.id);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reopen'").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("reopening an already open barrier is a read-only no-op even with an active writer", async () => {
  const { binding, sqlite } = database();
  try {
    await acquireWriteLease(binding, "api:active", "no-op");
    const before = await getMaintenanceStatus(binding);
    const result = await reopenMaintenance(binding, "admin@example.com");
    assert.deepEqual(result, before);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reopen'").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("competing reopens advance a drained generation and audit it only once", async () => {
  const { binding, sqlite } = database();
  try {
    const initial = await enterMaintenance(binding, { reason: "ready", operatorEmail: "admin@example.com" });
    afterNextStateRead(binding, async () => {
      const winner = await reopenMaintenance(binding, "winner@example.com");
      assert.equal(winner.mode, "open");
      assert.equal(winner.generation, initial.generation + 1);
    });

    await assert.rejects(() => reopenMaintenance(binding, "stale@example.com"), { code: "MAINTENANCE_STATE_CONFLICT" });

    const status = await getMaintenanceStatus(binding);
    assert.equal(status.mode, "open");
    assert.equal(status.generation, initial.generation + 1);
    assert.equal(status.operatorEmail, "winner@example.com");
    const audits = sqlite.prepare("SELECT actor_email FROM audit_log WHERE action = 'reopen'").all();
    assert.deepEqual(audits.map((row) => row.actor_email), ["winner@example.com"]);
    const lease = await acquireWriteLease(binding, "api:after-reopen", "after-reopen");
    await releaseWriteLease(binding, lease);
  } finally {
    sqlite.close();
  }
});
