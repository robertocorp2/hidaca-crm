import { env } from "cloudflare:workers";
import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { documents } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";
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

  const id = crypto.randomUUID();
  const objectKey = `documents/${id}`;
  await filesBucket().put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  const [document] = await getDb()
    .insert(documents)
    .values({
      id,
      recordId,
      name: file.name.slice(0, 180),
      objectKey,
      contentType: file.type,
      size: file.size,
      createdBy: auth.user.email,
      createdAt: new Date().toISOString(),
    })
    .returning();
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
  return Response.json({ document }, { status: 201 });
}
