import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { DrillFailure, runDrill, validateBaseUrl, validateReconciliation } from "../scripts/rollback-staging-drill.mjs";

function cleanReconciliation() {
  return {
    snapshotAt: "2026-09-18T18:00:00.000Z",
    checkedAt: "2026-09-18T18:01:00.000Z",
    d1: { referencedObjectCount: 0, postSnapshot: { documents: { count: 0, sample: [] } } },
    r2: { inventoryComplete: true, objectCount: 0, manifestSha256: "a".repeat(64), postSnapshotObjects: [], missingReferencedObjects: [], orphanedObjects: [] },
  };
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("staging drill drains, reconciles, reopens, and records authenticated evidence", async () => {
  const calls = [];
  const responses = {
    "/api/maintenance": [
      { mode: "open", generation: 4, activeWriterCount: 0, activeWriters: [] },
      { mode: "maintenance", generation: 5, activeWriterCount: 0, activeWriters: [] },
    ],
    "/api/maintenance/enter": { mode: "maintenance", generation: 5, activeWriterCount: 1, activeWriters: [{ id: "writer-1" }] },
    "/api/maintenance/reconciliation": cleanReconciliation(),
    "/api/maintenance/reopen": { mode: "open", generation: 6, activeWriterCount: 0, activeWriters: [] },
  };
  const evidence = await withServer(async (request, response) => {
    calls.push({ method: request.method, url: request.url, email: request.headers["oai-authenticated-user-email"] });
    const key = request.url.startsWith("/api/maintenance/reconciliation") ? "/api/maintenance/reconciliation" : request.url;
    const value = Array.isArray(responses[key]) ? responses[key].shift() : responses[key];
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(value));
  }, (baseUrl) => runDrill({ baseUrl, authEmail: "admin@example.com", snapshotAt: "2026-09-18T18:00:00Z", now: () => "2026-09-18T18:02:00.000Z" }));

  assert.equal(evidence.outcome, "passed");
  assert.deepEqual(calls.map(({ method, url }) => [method, url.split("?")[0]]), [
    ["GET", "/api/maintenance"], ["POST", "/api/maintenance/enter"], ["GET", "/api/maintenance"],
    ["GET", "/api/maintenance/reconciliation"], ["POST", "/api/maintenance/reopen"],
  ]);
  assert.ok(calls.every((call) => call.email === "admin@example.com"));
});

test("reconciliation findings fail closed and do not reopen the barrier", async () => {
  const paths = [];
  await assert.rejects(() => withServer((request, response) => {
    paths.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/maintenance") response.end(JSON.stringify({ mode: paths.length === 1 ? "open" : "maintenance", activeWriterCount: 0 }));
    else if (request.url === "/api/maintenance/enter") response.end(JSON.stringify({ mode: "maintenance", activeWriterCount: 0 }));
    else if (request.url.startsWith("/api/maintenance/reconciliation")) response.end(JSON.stringify({ ...cleanReconciliation(), r2: { ...cleanReconciliation().r2, orphanedObjects: ["unexpected.bin"] } }));
    else response.end(JSON.stringify({ mode: "open", activeWriterCount: 0 }));
  }, (baseUrl) => runDrill({ baseUrl, authEmail: "admin@example.com", snapshotAt: "2026-09-18T18:00:00Z" })), (error) => {
    assert.ok(error instanceof DrillFailure);
    assert.match(error.message, /reconciliation/i);
    return true;
  });
  assert.equal(paths.some((path) => path === "/api/maintenance/reopen"), false);
});

test("production is rejected before any request", () => {
  assert.throws(() => validateBaseUrl("https://hidaca-constructora-app.robertocorp2.chatgpt.site"), /Production/);
});

test("production's absolute DNS hostname is rejected before any request", async () => {
  let requests = 0;
  await assert.rejects(() => runDrill({
    baseUrl: "https://HIDACA-CONSTRUCTORA-APP.ROBERTOCORP2.CHATGPT.SITE./",
    authEmail: "admin@example.com",
    snapshotAt: "2026-09-18T18:00:00Z",
    fetchImpl: async () => {
      requests++;
      throw new Error("Unexpected request to production");
    },
  }), /Production is not an allowed target/);
  assert.equal(requests, 0);
});

test("staging redirects cannot forward an authenticated maintenance request", async () => {
  let redirectedRequests = 0;
  let reopenRequests = 0;
  await withServer((_request, response) => {
    redirectedRequests++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Redirect target must never be contacted" }));
  }, async (redirectTarget) => {
    await assert.rejects(() => withServer((request, response) => {
      if (request.url === "/api/maintenance/enter") {
        response.writeHead(307, { location: `${redirectTarget}/api/maintenance/enter` });
        response.end();
      } else {
        if (request.url === "/api/maintenance/reopen") reopenRequests++;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ mode: "open", activeWriterCount: 0 }));
      }
    }, (baseUrl) => runDrill({
      baseUrl,
      authEmail: "admin@example.com",
      snapshotAt: "2026-09-18T18:00:00Z",
      timeoutMs: 0,
    })));
  });
  assert.equal(redirectedRequests, 0);
  assert.equal(reopenRequests, 0);
});

test("reconciliation validator rejects incomplete inventory", () => {
  assert.throws(() => validateReconciliation({ ...cleanReconciliation(), r2: { ...cleanReconciliation().r2, inventoryComplete: false } }), /not clean/i);
});
