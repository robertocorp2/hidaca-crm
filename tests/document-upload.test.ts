import assert from "node:assert/strict";
import test from "node:test";
import { documentUploadKeyFor, postDocumentUpload } from "../app/lib/document-upload";

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
  const otherFile = new File(["b"], "b.pdf", { type: "application/pdf", lastModified: 43 });
  let keys = 0;
  const first = documentUploadKeyFor(null, firstFile, "record-1", () => `key-${++keys}`);
  const changed = documentUploadKeyFor(first, otherFile, "record-1", () => `key-${++keys}`);
  assert.notEqual(changed.key, first.key);
  assert.equal(keys, 2);
});
