import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("reopen route reports non-cacheable conflicts and preserves its admin gate", () => {
  // Exercise the actual route adapter, with auth/database boundaries replaced.
  // This is not an authenticated staging or production smoke test.
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    import { pathToFileURL } from "node:url";
    import { resolve } from "node:path";
    import { MaintenanceDrainTimeoutError, MaintenanceStateConflictError } from "./app/lib/write-barrier.ts";
    let authorized = true;
    let failure = new MaintenanceStateConflictError();
    mock.module(pathToFileURL(resolve("db/index.ts")).href, {
      namedExports: {
        getD1: () => { throw failure; },
        getFiles: () => ({}),
      },
    });
    mock.module(pathToFileURL(resolve("app/lib/authorization.ts")).href, {
      namedExports: { authorizeApi: async (admin) => {
        assert.equal(admin, true);
        return authorized
          ? { ok: true, user: { email: "admin@example.com" } }
          : { ok: false, response: new Response("Forbidden", { status: 403 }) };
      } },
    });
    const { POST } = await import("./app/api/maintenance/reopen/route.ts");
    for (const error of [new MaintenanceStateConflictError(), new MaintenanceDrainTimeoutError([])]) {
      failure = error;
      const response = await POST();
      assert.equal(response.status, 409);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).code, error.code);
    }
    failure = new Error("unexpected database failure");
    await assert.rejects(() => POST(), /unexpected database failure/);
    authorized = false;
    assert.equal((await POST()).status, 403);
  `], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
