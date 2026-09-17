import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  createDocumentStorageOperation,
  findDocumentStorageOperation,
  metadataFromOperation,
  requestIdempotencyKey,
  transitionDocumentStorageOperation,
} from "../../../lib/document-storage";
import { deleteSearchDocument } from "../../../lib/search";

type StoredObject = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
};
type FilesBucket = {
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};
type RouteContext = { params: Promise<{ id: string }> };

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

function safeFileName(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180);
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "documentos", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!document) {
    return Response.json({ error: "Documento no encontrado." }, { status: 404 });
  }
  const object = await filesBucket().get(document.objectKey);
  if (!object) {
    return Response.json(
      { error: "El archivo no está disponible en almacenamiento." },
      { status: 404 },
    );
  }
  const requestedDisposition = new URL(request.url).searchParams.get("disposition");
  const previewable = document.contentType === "application/pdf" || document.contentType.startsWith("image/");
  const disposition = requestedDisposition === "inline" && previewable ? "inline" : "attachment";
  return new Response(object.body, {
    headers: {
      "content-type": document.contentType,
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFileName(document.name))}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "documentos", action: "delete" });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const idempotencyKey = requestIdempotencyKey(request, `delete:${id}`);
  const existing = await findDocumentStorageOperation(idempotencyKey);
  if (existing && existing.kind !== "delete") {
    return Response.json(
      { error: "La clave de idempotencia ya pertenece a otra operación." },
      { status: 409 },
    );
  }
  if (existing && existing.documentId !== id) {
    return Response.json(
      { error: "La clave de idempotencia no coincide con el documento." },
      { status: 409 },
    );
  }
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (existing?.status === "completed") {
    return Response.json(
      { ok: true, operationId: existing.id, replay: true },
      { headers: { "x-idempotent-replay": "true" } },
    );
  }
  if (!document && !existing) {
    return Response.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const metadata = existing ? metadataFromOperation(existing) : null;
  const objectKey = document?.objectKey ?? existing?.objectKey;
  if (!objectKey) {
    return Response.json(
      { error: "La operación no conserva una clave de almacenamiento recuperable." },
      { status: 409 },
    );
  }
  const operation =
    existing ??
    (await createDocumentStorageOperation({
      id: crypto.randomUUID(),
      idempotencyKey,
      kind: "delete",
      documentId: id,
      objectKey,
      metadata: {
        id,
        recordId: document?.recordId ?? null,
        name: document?.name ?? metadata?.name ?? id,
        objectKey,
        contentType: document?.contentType ?? metadata?.contentType ?? "",
        size: document?.size ?? metadata?.size ?? 0,
        createdBy: document?.createdBy ?? metadata?.createdBy ?? auth.user.email,
        createdAt: document?.createdAt ?? metadata?.createdAt ?? now,
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

  try {
    // Remove metadata first. If R2 fails, the operation retains the object key
    // and the admin reconciliation endpoint can safely retry the R2 delete.
    if (document) {
      await getDb().delete(documents).where(eq(documents.id, id));
    }
    await transitionDocumentStorageOperation(
      operation.id,
      "r2_pending",
      new Date().toISOString(),
    );
    await filesBucket().delete(objectKey);
    await transitionDocumentStorageOperation(
      operation.id,
      "completed",
      new Date().toISOString(),
    );
    await Promise.all([
      writeAudit(
        auth.user.email,
        "delete",
        "document",
        id,
        document?.name ?? metadata?.name ?? id,
      ),
      deleteSearchDocument("document", id),
    ]).catch(() => undefined);
    return Response.json({ ok: true, operationId: operation.id, replay: Boolean(existing) });
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
        error: "La eliminación quedó pendiente de reconciliación; puedes reintentar con la misma clave.",
        operationId: operation.id,
        retryable: true,
      },
      { status: 202 },
    );
  }
}
