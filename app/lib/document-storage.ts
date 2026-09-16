import { getD1 } from "../../db";
import {
  buildDocumentStorageReport,
  metadataMatchesOperation,
  type DocumentInventoryItem,
  type DocumentObjectInventoryItem,
  type DocumentStorageMetadata,
  type DocumentStorageOperation,
  type DocumentStorageOperationKind,
  type DocumentStorageOperationStatus,
  type ReconciliationOperation,
  type ReconciliationRepair,
  type ReconciliationResult,
} from "./document-storage-model";

export {
  buildDocumentStorageReport,
  metadataMatchesOperation,
  requestIdempotencyKey,
} from "./document-storage-model";
export type * from "./document-storage-model";

type R2ListPage = {
  objects: Array<{ key: string; size?: number; uploaded?: Date | string }>;
  truncated: boolean;
  cursor?: string;
};

type DocumentStorageBucket = {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<R2ListPage>;
  delete(key: string): Promise<void>;
};

const operationColumns = `
  id,
  idempotency_key AS idempotencyKey,
  operation_kind AS kind,
  status,
  document_id AS documentId,
  object_key AS objectKey,
  metadata_json AS metadataJson,
  error,
  attempts,
  created_by AS createdBy,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt
`;

export function metadataFromOperation(
  operation: Pick<DocumentStorageOperation, "metadataJson">,
) {
  try {
    return JSON.parse(operation.metadataJson) as DocumentStorageMetadata;
  } catch {
    return null;
  }
}

export async function findDocumentStorageOperation(idempotencyKey: string) {
  return getD1()
    .prepare(
      `SELECT ${operationColumns}
       FROM document_storage_operations
       WHERE idempotency_key = ?
       LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<DocumentStorageOperation>();
}

export async function findDocumentStorageOperationById(id: string) {
  return getD1()
    .prepare(
      `SELECT ${operationColumns}
       FROM document_storage_operations
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<DocumentStorageOperation>();
}

export async function createDocumentStorageOperation(input: {
  id: string;
  idempotencyKey: string;
  kind: DocumentStorageOperationKind;
  documentId: string;
  objectKey: string;
  metadata: DocumentStorageMetadata;
  createdBy: string;
  now: string;
}) {
  const d1 = getD1();
  try {
    await d1
      .prepare(
        `INSERT INTO document_storage_operations
         (id, idempotency_key, operation_kind, status, document_id, object_key,
          metadata_json, attempts, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.idempotencyKey,
        input.kind,
        input.documentId,
        input.objectKey,
        JSON.stringify(input.metadata),
        input.createdBy,
        input.now,
        input.now,
      )
      .run();
  } catch {
    // A concurrent request may have won the idempotency race. The caller
    // can safely continue using the durable operation that already exists.
  }
  return findDocumentStorageOperation(input.idempotencyKey);
}

export async function transitionDocumentStorageOperation(
  id: string,
  status: DocumentStorageOperationStatus,
  now: string,
  error: string | null = null,
) {
  await getD1()
    .prepare(
      `UPDATE document_storage_operations
       SET status = ?, error = ?, attempts = attempts + 1, updated_at = ?,
           completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
       WHERE id = ?`,
    )
    .bind(status, error?.slice(0, 4_000) ?? null, now, status, now, id)
    .run();
}

async function listDocumentObjects(bucket: DocumentStorageBucket) {
  const objects: DocumentObjectInventoryItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "documents/", cursor, limit: 1_000 });
    objects.push(
      ...page.objects.map((object) => ({
        key: object.key,
        ...(object.size === undefined ? {} : { size: object.size }),
        ...(object.uploaded === undefined
          ? {}
          : { uploaded: String(object.uploaded) }),
      })),
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function inventory(bucket: DocumentStorageBucket) {
  const d1 = getD1();
  const [documents, operations, objects] = await Promise.all([
    d1
      .prepare("SELECT id, object_key AS objectKey FROM documents")
      .all<DocumentInventoryItem>(),
    d1
      .prepare(
        `SELECT id, operation_kind AS kind, status, document_id AS documentId,
                object_key AS objectKey, error, attempts
         FROM document_storage_operations
         WHERE status <> 'completed'
         ORDER BY updated_at ASC`,
      )
      .all<ReconciliationOperation>(),
    listDocumentObjects(bucket),
  ]);
  return {
    documents: documents.results ?? [],
    operations: operations.results ?? [],
    objects,
  };
}

export async function reconcileDocumentStorage(
  bucket: DocumentStorageBucket,
  repair = false,
): Promise<ReconciliationResult> {
  const repairs: ReconciliationRepair[] = [];
  let snapshot = await inventory(bucket);
  const documentById = new Map(snapshot.documents.map((item) => [item.id, item]));
  const objectKeys = new Set(snapshot.objects.map((item) => item.key));
  const d1 = getD1();

  if (repair) {
    for (const operation of snapshot.operations) {
      const metadata = await findDocumentStorageOperationById(operation.id);
      const parsed = metadata ? metadataFromOperation(metadata) : null;
      if (
        operation.kind === "upload" &&
        parsed &&
        metadataMatchesOperation(operation, parsed) &&
        objectKeys.has(operation.objectKey)
      ) {
        if (!documentById.has(operation.documentId)) {
          await d1
            .prepare(
              `INSERT OR IGNORE INTO documents
               (id, record_id, name, object_key, content_type, size, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              parsed.id,
              parsed.recordId,
              parsed.name,
              parsed.objectKey,
              parsed.contentType,
              parsed.size,
              parsed.createdBy,
              parsed.createdAt,
            )
            .run();
          repairs.push({
            operationId: operation.id,
            action: "restored_metadata",
            documentId: operation.documentId,
            objectKey: operation.objectKey,
          });
        }
        await transitionDocumentStorageOperation(
          operation.id,
          "completed",
          new Date().toISOString(),
        );
      } else if (
        operation.kind === "delete" &&
        !documentById.has(operation.documentId)
      ) {
        if (objectKeys.has(operation.objectKey)) {
          await bucket.delete(operation.objectKey);
          repairs.push({
            operationId: operation.id,
            action: "removed_orphan_object",
            documentId: operation.documentId,
            objectKey: operation.objectKey,
          });
        }
        await transitionDocumentStorageOperation(
          operation.id,
          "completed",
          new Date().toISOString(),
        );
        if (!objectKeys.has(operation.objectKey)) {
          repairs.push({
            operationId: operation.id,
            action: "marked_completed",
            documentId: operation.documentId,
            objectKey: operation.objectKey,
          });
        }
      }
    }
    snapshot = await inventory(bucket);
  }

  return {
    ...buildDocumentStorageReport(snapshot),
    repairs,
  };
}
