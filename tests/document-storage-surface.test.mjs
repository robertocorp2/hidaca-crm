import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("document upload and delete routes persist retryable storage operations", async () => {
  const upload = await read("app/api/documents/route.ts");
  const remove = await read("app/api/documents/[id]/route.ts");
  for (const route of [upload, remove]) {
    assert.match(route, /requestIdempotencyKey/);
    assert.match(route, /transitionDocumentStorageOperation/);
    assert.match(route, /reconcile_required/);
    assert.match(route, /retryable: true/);
  }
  assert.match(upload, /x-idempotent-replay/);
  assert.match(remove, /r2_pending/);
  assert.match(upload, /sha256Hex/);
  assert.match(upload, /sha256: fileSha256/);
  assert.match(upload, /existingMetadata\.sha256 !== fileSha256/);
  assert.match(upload, /existingMetadata\.name !== name/);
  assert.match(remove, /existing\.documentId !== id/);
  assert.match(upload, /existing operation.*cannot be validated|operación existente no se puede validar/i);
});

test("document reconciliation is private and repair requires explicit admin intent", async () => {
  const route = await read("app/api/admin/documents/reconciliation/route.ts");
  assert.match(route, /authorizeApi\(true\)/);
  assert.match(route, /repair=true/);
  assert.match(route, /cache-control.*private, no-store/);
  assert.match(route, /reconcileDocumentStorage/);
});

test("storage operations preserve state after document metadata is deleted", async () => {
  const migration = await read("drizzle/0026_document_storage_reconciliation.sql");
  assert.match(migration, /document_storage_operations/);
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /metadata_pending/);
  assert.match(migration, /r2_pending/);
  assert.doesNotMatch(migration, /FOREIGN KEY \(`document_id`\)/);
});
