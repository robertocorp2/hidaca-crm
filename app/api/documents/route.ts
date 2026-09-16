import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { documents } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";
import {
  createDocumentStorageOperation,
  findDocumentStorageOperation,
  metadataFromOperation,
  requestIdempotencyKey,
  sha256Hex,
  transitionDocumentStorageOperation,
} from "../../lib/document-storage";
import { upsertSearchDocument } from "../../lib/search";

type FilesBucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const maxSize = 10 * 1024 * 1024;

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

export async function GET() {
  const auth = await authorizeApi({ module: "documentos", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .limit(250);
  return Response.json({ documents: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "documentos", action: "create" });
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const file = form.get("file");
  const recordId = String(form.get("recordId") ?? "").trim() || null;
  if (!(file instanceof File)) {
    return Response.json({ error: "Selecciona un archivo." }, { status: 400 });
  }
  if (!allowedTypes.has(file.type) || file.size > maxSize || file.size === 0) {
    return Response.json(
      { error: "Archivo no permitido. Máximo 10 MB: PDF, imagen, DOCX o XLSX." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const fileBytes = await file.arrayBuffer();
  const fileSha256 = await sha256Hex(fileBytes);
  const idempotencyKey = requestIdempotencyKey(
    request,
    `upload:${crypto.randomUUID()}`,
  );
  const name = file.name.slice(0, 180);
  const existing = await findDocumentStorageOperation(idempotencyKey);
  const existingMetadata = existing ? metadataFromOperation(existing) : null;
  if (existing && existing.kind !== "upload") {
    return Response.json(
      { error: "La clave de idempotencia ya pertenece a otra operación." },
      { status: 409 },
    );
  }
  if (existing && !existingMetadata) {
    return Response.json(
      { error: "La operación existente no se puede validar; usa una clave nueva." },
      { status: 409 },
    );
  }
  if (
    existingMetadata &&
    (existingMetadata.name !== name ||
      existingMetadata.contentType !== file.type ||
      existingMetadata.size !== file.size ||
      existingMetadata.recordId !== recordId ||
      existingMetadata.sha256 !== fileSha256)
  ) {
    return Response.json(
      { error: "La clave de idempotencia no coincide con el archivo original." },
      { status: 409 },
    );
  }
  if (existing?.status === "completed") {
    const [document] = await getDb()
      .select()
      .from(documents)
      .where(eq(documents.id, existing.documentId))
      .limit(1);
    if (document) {
      return Response.json(
        { document, operationId: existing.id, replay: true },
        { headers: { "x-idempotent-replay": "true" } },
      );
    }
  }

  const proposedId = existing?.documentId ?? crypto.randomUUID();
  const proposedObjectKey = existing?.objectKey ?? `documents/${proposedId}`;
  const operation =
    existing ??
    (await createDocumentStorageOperation({
      id: proposedId,
      idempotencyKey,
      kind: "upload",
      documentId: proposedId,
      objectKey: proposedObjectKey,
      metadata: {
        id: proposedId,
        recordId,
        name,
        objectKey: proposedObjectKey,
        contentType: file.type,
        size: file.size,
        createdBy: auth.user.email,
        createdAt: now,
        sha256: fileSha256,
      },
      createdBy: auth.user.email,
      now,
    }));
  if (!operation) {
    return Response.json(
      { error: "No se pudo registrar la operación de almacenamiento." },
      { status: 503 },
    );
  }
  const id = operation.documentId;
  const objectKey = operation.objectKey;
  const operationMetadata = metadataFromOperation(operation);
  if (
    !operationMetadata ||
    operationMetadata.name !== name ||
    operationMetadata.contentType !== file.type ||
    operationMetadata.size !== file.size ||
    operationMetadata.recordId !== recordId ||
    operationMetadata.sha256 !== fileSha256
  ) {
    return Response.json(
      { error: "La clave de idempotencia no coincide con el archivo original." },
      { status: 409 },
    );
  }

  try {
    await transitionDocumentStorageOperation(operation.id, "pending", now);
    await filesBucket().put(objectKey, fileBytes, {
      httpMetadata: { contentType: file.type },
    });
    await transitionDocumentStorageOperation(
      operation.id,
      "metadata_pending",
      new Date().toISOString(),
    );
    let [document] = await getDb()
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!document) {
      [document] = await getDb()
        .insert(documents)
        .values({
          id,
          recordId,
          name,
          objectKey,
          contentType: file.type,
          size: file.size,
          createdBy: auth.user.email,
          createdAt: operationMetadata?.createdAt ?? now,
        })
        .returning();
    }
    await Promise.all([
      writeAudit(auth.user.email, "upload", "document", id, document.name),
      upsertSearchDocument({
        entityType: "document",
        entityId: id,
        title: document.name,
        subtitle: document.contentType,
        searchText: document.name,
        ownerEmail: document.createdBy,
        updatedAt: document.createdAt,
      }),
    ]);
    await transitionDocumentStorageOperation(
      operation.id,
      "completed",
      new Date().toISOString(),
    );
    return Response.json(
      { document, operationId: operation.id, replay: Boolean(existing) },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await transitionDocumentStorageOperation(
      operation.id,
      "reconcile_required",
      new Date().toISOString(),
      message,
    ).catch(() => undefined);
    return Response.json(
      {
        error: "La carga quedó pendiente de reconciliación; puedes reintentar con la misma clave.",
        operationId: operation.id,
        retryable: true,
      },
      { status: 202 },
    );
  }
}
