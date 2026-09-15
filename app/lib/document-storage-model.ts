export type DocumentStorageOperationKind = "upload" | "delete";
export type DocumentStorageOperationStatus =
  | "pending"
  | "metadata_pending"
  | "r2_pending"
  | "reconcile_required"
  | "failed"
  | "completed";

export type DocumentStorageMetadata = {
  id: string;
  recordId: string | null;
  name: string;
  objectKey: string;
  contentType: string;
  size: number;
  createdBy: string;
  createdAt: string;
};

export type DocumentStorageOperation = {
  id: string;
  idempotencyKey: string;
  kind: DocumentStorageOperationKind;
  status: DocumentStorageOperationStatus;
  documentId: string;
  objectKey: string;
  metadataJson: string;
  error: string | null;
  attempts: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type DocumentInventoryItem = { id: string; objectKey: string };
export type DocumentObjectInventoryItem = {
  key: string;
  size?: number;
  uploaded?: string;
};

export type ReconciliationOperation = Pick<
  DocumentStorageOperation,
  "id" | "kind" | "status" | "documentId" | "objectKey" | "error" | "attempts"
>;

export type ReconciliationReport = {
  documentsChecked: number;
  objectsChecked: number;
  operationsChecked: number;
  missingObjects: Array<{ documentId: string; objectKey: string }>;
  orphanObjects: Array<{ key: string; size?: number; uploaded?: string }>;
  retryableOperations: ReconciliationOperation[];
};

export type ReconciliationRepair = {
  operationId: string;
  action: "restored_metadata" | "removed_orphan_object" | "marked_completed";
  documentId: string;
  objectKey: string;
};

export type ReconciliationResult = ReconciliationReport & {
  repairs: ReconciliationRepair[];
};

export function requestIdempotencyKey(request: Request, fallback: string) {
  const value =
    request.headers.get("idempotency-key") ??
    request.headers.get("x-idempotency-key") ??
    "";
  return (value.trim() || fallback).slice(0, 180);
}

export function buildDocumentStorageReport(input: {
  documents: DocumentInventoryItem[];
  objects: DocumentObjectInventoryItem[];
  operations: ReconciliationOperation[];
}): ReconciliationReport {
  const documentKeys = new Map(
    input.documents.map((document) => [document.objectKey, document.id]),
  );
  const objectKeys = new Set(input.objects.map((object) => object.key));
  const missingObjects = input.documents
    .filter((document) => !objectKeys.has(document.objectKey))
    .map((document) => ({
      documentId: document.id,
      objectKey: document.objectKey,
    }));
  const orphanObjects = input.objects
    .filter((object) => !documentKeys.has(object.key))
    .map((object) => ({
      key: object.key,
      ...(object.size === undefined ? {} : { size: object.size }),
      ...(object.uploaded === undefined ? {} : { uploaded: object.uploaded }),
    }));
  return {
    documentsChecked: input.documents.length,
    objectsChecked: input.objects.length,
    operationsChecked: input.operations.length,
    missingObjects,
    orphanObjects,
    retryableOperations: input.operations.filter(
      (operation) => operation.status !== "completed",
    ),
  };
}
