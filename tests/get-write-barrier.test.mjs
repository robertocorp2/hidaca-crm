import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Real routes, authorization, Drizzle queries and lease SQL over local SQLite.
// Only the identity, D1 binding and provider boundaries are replaced.
const scenarios = [
  "conversation-maintenance",
  "conversation-open-provider-failure",
  "conversation-inflight",
  "conversation-readonly-maintenance",
  "conversation-denied",
  "owner-existing-maintenance",
  "owner-missing-maintenance",
  "owner-missing-open",
  "owner-inactive",
];

for (const scenario of scenarios) {
  test(`GET write barrier: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { mock } from "node:test";
      import { pathToFileURL } from "node:url";
      import { resolve } from "node:path";
      import { drizzle } from "drizzle-orm/d1";
      import * as schema from "./db/schema.ts";
      import { database } from "./tests/prospecting-support.ts";
      import { enterMaintenance, getMaintenanceStatus, MaintenanceDrainTimeoutError } from "./app/lib/write-barrier.ts";
      const scenario = process.argv[1];
      const { sqlite, binding, files } = database();
      const db = drizzle(binding, { schema });
      const owner = "robertocorp2@gmail.com"; // Existing application bootstrap identity, not a credential.
      const email = scenario.startsWith("owner-") ? owner : "operator@example.com";
      const user = { id: "fixture-user", email, displayName: "Test User", fullName: "Test User" };
      let providerCalls = 0;
      let providerSawLease = false;
      let releaseProvider;
      let reachedProvider;
      const providerStarted = new Promise(resolve => { reachedProvider = resolve; });
      const providerRelease = new Promise(resolve => { releaseProvider = resolve; });
      const activeCount = () => sqlite.prepare("SELECT COUNT(*) AS n FROM write_leases WHERE outcome IS NULL").get().n;
      mock.module(pathToFileURL(resolve("db/index.ts")).href, { namedExports: { getD1: () => binding, getDb: () => db, getFiles: () => files } });
      mock.module(pathToFileURL(resolve("app/chatgpt-auth.ts")).href, { namedExports: {
        getChatGPTUser: async () => user, requireChatGPTUser: async () => user,
      } });
      mock.module(pathToFileURL(resolve("app/lib/whatsapp.ts")).href, { namedExports: {
        markWhatsAppMessageRead: async (id) => {
          assert.equal(id, "meta-fixture");
          providerCalls++;
          providerSawLease = activeCount() === 1;
          reachedProvider();
          if (scenario === "conversation-inflight") await providerRelease;
          if (scenario === "conversation-open-provider-failure") throw new Error("provider unavailable");
        },
      } });
      const { authorizeApi } = await import("./app/lib/authorization.ts");
      const { GET } = await import("./app/api/whatsapp/conversations/[id]/route.ts");
      if (scenario === "owner-existing-maintenance" || scenario === "owner-inactive") {
        sqlite.prepare("INSERT INTO staff_users(email,name,role,active,created_at,updated_at) VALUES (?, 'Owner', 'admin', ?, 'fixture', 'fixture')").run(owner, scenario === "owner-inactive" ? 0 : 1);
      }
      // Existing/inactive users must not even attempt INSERT ON CONFLICT.
      if (scenario === "owner-existing-maintenance" || scenario === "owner-inactive") {
        sqlite.exec("CREATE TRIGGER reject_staff_insert BEFORE INSERT ON staff_users BEGIN SELECT RAISE(ABORT, 'unexpected authorization write'); END");
      }
      if (scenario === "owner-missing-open") {
        sqlite.exec("CREATE TRIGGER require_bootstrap_lease BEFORE INSERT ON staff_users WHEN NOT EXISTS (SELECT 1 FROM write_leases WHERE outcome IS NULL) BEGIN SELECT RAISE(ABORT, 'bootstrap has no lease'); END");
      }
      if (scenario.includes("maintenance")) await enterMaintenance(binding, { reason: "fixture maintenance", operatorEmail: "operator@example.com" }, files);
      if (scenario.startsWith("owner-")) {
        const result = await authorizeApi(true);
        const allowed = scenario === "owner-existing-maintenance" || scenario === "owner-missing-open";
        assert.equal(result.ok, allowed);
        if (!allowed) assert.equal(result.response.status, 403);
        const owners = sqlite.prepare("SELECT * FROM staff_users WHERE email=?").all(owner);
        assert.equal(owners.length, scenario === "owner-missing-maintenance" ? 0 : 1);
        assert.equal(activeCount(), 0);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM write_leases").get().n, scenario === "owner-missing-open" ? 1 : 0);
      } else {
        sqlite.exec("INSERT INTO whatsapp_conversations(id,phone_number_id,wa_id,unread_count,created_at,updated_at) VALUES ('conversation-fixture','phone-fixture','wa-fixture',3,'fixture','fixture')");
        if (scenario !== "conversation-readonly-maintenance") sqlite.exec("INSERT INTO whatsapp_messages(id,conversation_id,meta_message_id,direction,type,created_at) VALUES ('message-fixture','conversation-fixture','meta-fixture','inbound','text','fixture')");
        const originalUnread = sqlite.prepare("SELECT unread_count FROM whatsapp_conversations").get().unread_count;
        if (scenario === "conversation-denied") sqlite.exec("UPDATE staff_users SET active=0 WHERE email='operator@example.com'");
        const pending = GET(new Request("https://example.test/api/whatsapp/conversations/conversation-fixture"), { params: Promise.resolve({ id: "conversation-fixture" }) });
        if (scenario === "conversation-inflight") {
          await providerStarted;
          try {
            assert.equal((await getMaintenanceStatus(binding, files)).activeWriterCount, 1);
            await assert.rejects(() => enterMaintenance(binding, { reason: "drill", operatorEmail: "operator@example.com", timeoutMs: 0 }, files), MaintenanceDrainTimeoutError);
          } finally { releaseProvider(); }
        }
        const response = await pending;
        const blocked = scenario === "conversation-maintenance";
        const denied = scenario === "conversation-denied";
        const readOnly = scenario === "conversation-readonly-maintenance";
        assert.equal(response.status, blocked ? 503 : denied ? 403 : 200);
        if (blocked) {
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.equal(response.headers.get("retry-after"), "60");
          assert.equal((await response.json()).code, "MAINTENANCE_MODE");
        }
        const writesExpected = !blocked && !denied && !readOnly;
        assert.equal(sqlite.prepare("SELECT unread_count FROM whatsapp_conversations").get().unread_count, writesExpected ? 0 : originalUnread);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM whatsapp_conversation_reads").get().n, writesExpected ? 1 : 0);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='whatsapp_conversation'").get().n, writesExpected ? 1 : 0);
        assert.equal(providerCalls, writesExpected ? 1 : 0);
        if (writesExpected) assert.equal(providerSawLease, true);
        assert.equal(activeCount(), 0);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM write_leases").get().n, writesExpected ? 1 : 0);
      }
      sqlite.close();
    `, scenario], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15_000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
