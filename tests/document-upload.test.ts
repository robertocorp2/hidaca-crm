import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { documentUploadKeyFor, postDocumentUpload } from "../app/lib/document-upload";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("document upload key remains stable for retries and is sent with the real request", async () => {
  const file = new File(["evidence"], "proof.pdf", { type: "application/pdf", lastModified: 42 });
  let keys = 0;
  const first = documentUploadKeyFor(null, file, "record-1", () => `key-${++keys}`);
  const retry = documentUploadKeyFor(first, file, "record-1", () => `key-${++keys}`);
  assert.equal(retry.key, first.key);
  assert.equal(keys, 1);

  let captured: RequestInit | undefined;
  await postDocumentUpload(new FormData(), retry.key, async (_input, init) => {
    captured = init;
    return new Response(null, { status: 202 });
  });
  assert.equal((captured?.headers as Record<string, string>)?.["Idempotency-Key"], first.key);
});

test("document upload key changes when file or record identity changes", () => {
  const firstFile = new File(["a"], "a.pdf", { type: "application/pdf", lastModified: 42 });
  const otherFile = new File(["b"], "a.pdf", { type: "application/pdf", lastModified: 42 });
  let keys = 0;
  const first = documentUploadKeyFor(null, firstFile, "record-1", () => `key-${++keys}`);
  const changed = documentUploadKeyFor(first, otherFile, "record-1", () => `key-${++keys}`);
  assert.notEqual(changed.key, first.key);
  assert.equal(keys, 2);
  const otherRecord = documentUploadKeyFor(changed, firstFile, "record-2", () => `key-${++keys}`);
  assert.notEqual(otherRecord.key, changed.key);
  assert.equal(keys, 3);
});

test("upload UI releases busy state after transport or response parsing failures", () => {
  const source = readFileSync(path.join(project, "app/app/operations-client.tsx"), "utf8");
  const start = source.indexOf("async function uploadDocument(");
  const end = source.indexOf("async function deleteDocument(", start);
  const upload = source.slice(start, end);
  assert.match(upload, /try \{/);
  assert.match(upload, /catch \{[\s\S]*Puedes reintentar con la misma clave/);
  assert.match(upload, /finally \{[\s\S]*setBusy\(false\)/);
  assert.match(upload, /documentUploadKeyRef\.current = null/);
});
