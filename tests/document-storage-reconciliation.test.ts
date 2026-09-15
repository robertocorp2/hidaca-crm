import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentStorageReport, requestIdempotencyKey } from "../app/lib/document-storage-model";

test("document storage reconciliation reports missing and orphaned R2 bytes", () => {
  const report = buildDocumentStorageReport({
    documents: [
      { id: "doc-present", objectKey: "documents/present" },
      { id: "doc-missing", objectKey: "documents/missing" },
    ],
    objects: [
      { key: "documents/present", size: 10 },
      { key: "documents/orphan", size: 20 },
    ],
    operations: [
      {
        id: "op-1",
        kind: "upload",
        status: "reconcile_required",
        documentId: "doc-missing",
        objectKey: "documents/missing",
        error: "D1 unavailable",
        attempts: 1,
      },
    ],
  });

  assert.deepEqual(report.missingObjects, [
    { documentId: "doc-missing", objectKey: "documents/missing" },
  ]);
  assert.deepEqual(report.orphanObjects, [
    { key: "documents/orphan", size: 20 },
  ]);
  assert.equal(report.retryableOperations[0]?.id, "op-1");
});

test("idempotency key accepts the standard and legacy header names", () => {
  assert.equal(
    requestIdempotencyKey(
      new Request("https://crm.example.test", {
        headers: { "Idempotency-Key": " upload-1 " },
      }),
      "fallback",
    ),
    "upload-1",
  );
  assert.equal(
    requestIdempotencyKey(
      new Request("https://crm.example.test", {
        headers: { "X-Idempotency-Key": "delete-1" },
      }),
      "fallback",
    ),
    "delete-1",
  );
});
