import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare } from "miniflare";

async function createDatabase() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
    compatibilityDate: "2026-05-15",
  });
  const binding = await mf.getD1Database("DB");
  const folder = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(folder).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    const source = readFileSync(new URL(file, folder), "utf8");
    for (const sql of source.split("--> statement-breakpoint")) {
      if (sql.replace(/--[^\n]*/g, "").trim()) await binding.prepare(sql).run();
    }
  }
  return { mf, binding };
}

test("document storage operations preserve both failure boundaries and idempotent success", { timeout: 120000 }, async () => {
  const { mf, binding } = await createDatabase();
  try {
    const now = new Date().toISOString();
    const metadata = JSON.stringify({
      id: "doc-upload",
      recordId: null,
      name: "proof.pdf",
      objectKey: "documents/doc-upload",
      contentType: "application/pdf",
      size: 4,
      createdBy: "operator@example.com",
      createdAt: now,
    });
    await binding.prepare(`INSERT INTO document_storage_operations
      (id,idempotency_key,operation_kind,status,document_id,object_key,metadata_json,created_by,created_at,updated_at)
      VALUES ('op-upload','upload-key','upload','metadata_pending','doc-upload','documents/doc-upload',?,'operator@example.com',?,?)`)
      .bind(metadata, now, now).run();

    // R2 has been written, but D1 metadata is still absent: the operation is
    // visible and repairable instead of being silently lost.
    const pending = await binding.prepare("SELECT status, object_key, metadata_json FROM document_storage_operations WHERE id = 'op-upload'").first<{ status: string; object_key: string; metadata_json: string }>();
    assert.deepEqual(pending, { status: "metadata_pending", object_key: "documents/doc-upload", metadata_json: metadata });

    await binding.prepare(`INSERT INTO documents
      (id,name,object_key,content_type,size,created_by,created_at)
      VALUES ('doc-upload','proof.pdf','documents/doc-upload','application/pdf',4,'operator@example.com',?)`).bind(now).run();
    await binding.prepare("UPDATE document_storage_operations SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = 'op-upload'").bind(now, now).run();
    assert.equal((await binding.prepare("SELECT count(*) AS count FROM documents WHERE id = 'doc-upload'").first<{ count: number }>())?.count, 1);

    // A replay of the same idempotency key cannot create another operation.
    await assert.rejects(() => binding.prepare(`INSERT INTO document_storage_operations
      (id,idempotency_key,operation_kind,status,document_id,object_key,metadata_json,created_by,created_at,updated_at)
      VALUES ('op-upload-duplicate','upload-key','upload','pending','doc-upload','documents/doc-upload',?,'operator@example.com',?,?)`)
      .bind(metadata, now, now).run());
    assert.equal((await binding.prepare("SELECT count(*) AS count FROM document_storage_operations WHERE idempotency_key = 'upload-key'").first<{ count: number }>())?.count, 1);

    await binding.prepare(`INSERT INTO documents
      (id,name,object_key,content_type,size,created_by,created_at)
      VALUES ('doc-delete','delete.pdf','documents/doc-delete','application/pdf',4,'operator@example.com',?)`).bind(now).run();
    await binding.prepare(`INSERT INTO document_storage_operations
      (id,idempotency_key,operation_kind,status,document_id,object_key,metadata_json,created_by,created_at,updated_at)
      VALUES ('op-delete','delete-key','delete','pending','doc-delete','documents/doc-delete','{}','operator@example.com',?,?)`).bind(now, now).run();
    await binding.prepare("DELETE FROM documents WHERE id = 'doc-delete'").run();
    await binding.prepare("UPDATE document_storage_operations SET status = 'r2_pending', updated_at = ? WHERE id = 'op-delete'").bind(now).run();
    const deleteFailure = await binding.prepare("SELECT status, object_key FROM document_storage_operations WHERE id = 'op-delete'").first<{ status: string; object_key: string }>();
    assert.deepEqual(deleteFailure, { status: "r2_pending", object_key: "documents/doc-delete" });
  } finally {
    await mf.dispose();
  }
});
