import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("WhatsApp read receipt maps unavailable R2 maintenance authority to a retryable maintenance response", () => {
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    import { pathToFileURL } from "node:url";
    import { resolve } from "node:path";
    let selectCount = 0;
    const conversation = { id: "conversation-1" };
    const messages = [{ id: "inbound-1", direction: "inbound", metaMessageId: "provider-message-1" }];
    const query = {
      from() { return this; }, where() { return this; }, orderBy() { return this; },
      async limit() { selectCount += 1; return selectCount === 1 ? [conversation] : messages; },
    };
    const authorityUnavailable = Object.assign(new Error("authority unavailable"), { code: "MAINTENANCE_AUTHORITY_UNAVAILABLE" });
    mock.module(pathToFileURL(resolve("db/index.ts")).href, {
      namedExports: {
        getDb: () => ({ select: () => Object.create(query) }),
        getD1: () => ({}),
        getFiles: () => ({ async get() { throw authorityUnavailable; } }),
      },
    });
    mock.module(pathToFileURL(resolve("app/lib/authorization.ts")).href, {
      namedExports: { authorizeApi: async () => ({ ok: true, user: { email: "support@example.test", staffUserId: 7 } }) },
    });
    mock.module(pathToFileURL(resolve("app/lib/whatsapp.ts")).href, {
      namedExports: { markWhatsAppMessageRead: async () => {} },
    });
    const { GET } = await import("./app/api/whatsapp/conversations/[id]/route.ts");
    const response = await GET(new Request("https://crm.example.test/api/whatsapp/conversations/conversation-1"), { params: Promise.resolve({ id: "conversation-1" }) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal((await response.json()).code, "MAINTENANCE_MODE");
  `], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
