import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { createServer, type Plugin } from "vite";

declare global {
  var __HIDACA_TEST_ENV: Record<string, unknown> | undefined;
  var __HIDACA_TEST_ACTOR: { email: string; role: string } | null | undefined;
}

type Bucket = {
  put(key: string, value: ArrayBuffer | ReadableStream, options?: unknown): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size?: number; uploaded?: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
};

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authorizationModule = `
export async function authorizeApi(options) {
  const actor = globalThis.__HIDACA_TEST_ACTOR;
  if (!actor) return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (options?.module === "documentos" && options.action === "delete" && actor.role !== "admin") {
    return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, user: { email: actor.email } };
}
export function authorizeApiAdmin() { return true; }
`;

function testPlugin(): Plugin {
  return {
    name: "document-route-test-bindings",
    enforce: "pre",
    resolveId(source) {
      if (source === "cloudflare:workers") return "\0hidaca-test-workers";
      if (source.endsWith("/lib/authorization")) return "\0hidaca-test-authorization";
      if (source.endsWith("/lib/audit")) return "\0hidaca-test-audit";
      if (source.endsWith("/lib/search")) return "\0hidaca-test-search";
      return null;
    },
    load(id) {
      if (id === "\0hidaca-test-workers") return "export const env = globalThis.__HIDACA_TEST_ENV;";
      if (id === "\0hidaca-test-authorization") return authorizationModule;
      if (id === "\0hidaca-test-audit") return "export async function writeAudit() {}";
      if (id === "\0hidaca-test-search") return "export async function upsertSearchDocument() {}; export async function deleteSearchDocument() {};";
      return null;
    },
  };
}

async function setup() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    compatibilityDate: "2026-05-15",
  });
  const DB = await miniflare.getD1Database("DB");
  const bucket = await miniflare.getR2Bucket("FILES") as unknown as Bucket;
  for (const file of readdirSync(path.join(project, "drizzle")).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    const source = readFileSync(path.join(project, "drizzle", file), "utf8");
    for (const sql of source.split("--> statement-breakpoint")) {
      if (sql.replace(/--[^\n]*/g, "").trim()) await DB.prepare(sql).run();
    }
  }

  let failPut = false;
  let failDelete = false;
  const FILES: Bucket = {
    put: async (key, value, options) => {
      if (failPut) throw new Error("injected R2 put failure");
      return bucket.put(key, value, options as never);
    },
    get: (key) => bucket.get(key),
    delete: async (key) => {
      if (failDelete) throw new Error("injected R2 delete failure");
      return bucket.delete(key);
    },
    list: (options) => bucket.list(options),
  };
  globalThis.__HIDACA_TEST_ENV = { DB, FILES };
  globalThis.__HIDACA_TEST_ACTOR = { email: "operator@example.test", role: "operator" };

  const vite = await createServer({
    configFile: false,
    root: project,
    plugins: [testPlugin()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  const uploadRoute = await vite.ssrLoadModule("/app/api/documents/route.ts");
  const itemRoute = await vite.ssrLoadModule("/app/api/documents/[id]/route.ts");
  const reconcileRoute = await vite.ssrLoadModule("/app/api/admin/documents/reconciliation/route.ts");
  return {
    DB,
    bucket: FILES,
    upload: uploadRoute as { POST(request: Request): Promise<Response>; GET(): Promise<Response> },
    item: itemRoute as { GET(request: Request, context: unknown): Promise<Response>; DELETE(request: Request, context: unknown): Promise<Response> },
    reconcile: reconcileRoute as { GET(): Promise<Response>; POST(request: Request): Promise<Response> },
    setFailures(options: { put?: boolean; delete?: boolean }) {
      failPut = options.put ?? false;
      failDelete = options.delete ?? false;
    },
    setActor(actor: { email: string; role: string } | null) {
      globalThis.__HIDACA_TEST_ACTOR = actor;
    },
    async close() {
      await vite.close();
      await miniflare.dispose();
      delete globalThis.__HIDACA_TEST_ENV;
      delete globalThis.__HIDACA_TEST_ACTOR;
    },
  };
}

function uploadRequest(key: string, recordId = "record-7") {
  const form = new FormData();
  form.set("file", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
  form.set("recordId", recordId);
  return new Request("https://crm.example.test/api/documents", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: form,
  });
}

const itemContext = (id: string) => ({ params: Promise.resolve({ id }) });

test("document routes authorize access, persist metadata, retrieve bytes, and replay uploads idempotently", { timeout: 120000 }, async () => {
  const app = await setup();
  try {
    app.setActor(null);
    assert.equal((await app.upload.POST(uploadRequest("unauthorized"))).status, 401);
    app.setActor({ email: "operator@example.test", role: "operator" });

    const first = await app.upload.POST(uploadRequest("upload-1"));
    assert.equal(first.status, 201);
    const result = await first.json() as { document: { id: string; recordId: string; objectKey: string; name: string }; operationId: string };
    assert.equal(result.document.recordId, "record-7");
    assert.equal(result.document.name, "proof.pdf");
    assert.equal((await app.bucket.get(result.document.objectKey)) !== null, true);
    const storedOperation = await app.DB.prepare("SELECT status, document_id AS documentId FROM document_storage_operations WHERE id = ?").bind(result.operationId).first<{ status: string; documentId: string }>();
    assert.deepEqual(storedOperation, { status: "completed", documentId: result.document.id });

    const replay = await app.upload.POST(uploadRequest("upload-1"));
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("x-idempotent-replay"), "true");
    assert.equal((await app.DB.prepare("SELECT count(*) AS count FROM documents WHERE id = ?").bind(result.document.id).first<{ count: number }>())?.count, 1);

    const download = await app.item.GET(new Request(`https://crm.example.test/api/documents/${result.document.id}?disposition=inline`), itemContext(result.document.id));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.match(download.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(await download.text(), "proof");
    app.setActor(null);
    assert.equal((await app.item.GET(new Request(`https://crm.example.test/api/documents/${result.document.id}`), itemContext(result.document.id))).status, 401);
  } finally {
    await app.close();
  }
});

test("upload storage and metadata failures leave repairable state; delete failures retry cleanup", { timeout: 120000 }, async () => {
  const app = await setup();
  try {
    app.setActor({ email: "operator@example.test", role: "operator" });
    app.setFailures({ put: true });
    const r2Failure = await app.upload.POST(uploadRequest("upload-r2-failure"));
    assert.equal(r2Failure.status, 202);
    const failedUpload = await r2Failure.json() as { operationId: string };
    assert.equal((await app.DB.prepare("SELECT status FROM document_storage_operations WHERE id = ?").bind(failedUpload.operationId).first<{ status: string }>())?.status, "reconcile_required");
    app.setFailures({ put: false });

    await app.DB.prepare(`CREATE TRIGGER reject_document_metadata BEFORE INSERT ON documents
      BEGIN SELECT RAISE(FAIL, 'injected D1 metadata failure'); END`).run();
    const d1Failure = await app.upload.POST(uploadRequest("upload-d1-failure"));
    assert.equal(d1Failure.status, 202);
    const pendingUpload = await d1Failure.json() as { operationId: string };
    const operation = await app.DB.prepare("SELECT document_id AS documentId, object_key AS objectKey, status FROM document_storage_operations WHERE id = ?").bind(pendingUpload.operationId).first<{ documentId: string; objectKey: string; status: string }>();
    assert.equal(operation?.status, "reconcile_required");
    assert.ok(operation);
    assert.ok(await app.bucket.get(operation.objectKey));
    await app.DB.prepare("DROP TRIGGER reject_document_metadata").run();
    app.setActor({ email: "admin@example.test", role: "admin" });
    const repair = await app.reconcile.POST(new Request("https://crm.example.test/api/admin/documents/reconciliation?repair=true", { method: "POST" }));
    assert.equal(repair.status, 200);
    assert.equal((await app.DB.prepare("SELECT count(*) AS count FROM documents WHERE id = ?").bind(operation.documentId).first<{ count: number }>())?.count, 1);
    assert.equal((await app.DB.prepare("SELECT status FROM document_storage_operations WHERE id = ?").bind(pendingUpload.operationId).first<{ status: string }>())?.status, "completed");

    app.setActor({ email: "admin@example.test", role: "admin" });
    app.setFailures({ delete: true });
    const deletion = await app.item.DELETE(new Request(`https://crm.example.test/api/documents/${operation.documentId}`, { method: "DELETE", headers: { "Idempotency-Key": "delete-1" } }), itemContext(operation.documentId));
    assert.equal(deletion.status, 202);
    const deletionBody = await deletion.json() as { operationId: string };
    assert.equal((await app.DB.prepare("SELECT count(*) AS count FROM documents WHERE id = ?").bind(operation.documentId).first<{ count: number }>())?.count, 0);
    const pendingDelete = await app.DB.prepare("SELECT status, object_key AS objectKey FROM document_storage_operations WHERE id = ?").bind(deletionBody.operationId).first<{ status: string; objectKey: string }>();
    assert.equal(pendingDelete?.status, "reconcile_required");
    assert.ok(await app.bucket.get(pendingDelete!.objectKey));

    app.setFailures({ delete: false });
    const retry = await app.item.DELETE(new Request(`https://crm.example.test/api/documents/${operation.documentId}`, { method: "DELETE", headers: { "Idempotency-Key": "delete-1" } }), itemContext(operation.documentId));
    assert.equal(retry.status, 200);
    assert.equal(await app.bucket.get(pendingDelete!.objectKey), null);
    assert.equal((await app.DB.prepare("SELECT status FROM document_storage_operations WHERE id = ?").bind(deletionBody.operationId).first<{ status: string }>())?.status, "completed");
  } finally {
    await app.close();
  }
});
