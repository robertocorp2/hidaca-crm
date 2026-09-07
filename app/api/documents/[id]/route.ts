import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
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

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
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
  return new Response(object.body, {
    headers: {
      "content-type": document.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(document.name))}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const [document] = await getDb()
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!document) {
    return Response.json({ error: "Documento no encontrado." }, { status: 404 });
  }
  await filesBucket().delete(document.objectKey);
  await getDb().delete(documents).where(eq(documents.id, id));
  await Promise.all([
    writeAudit(auth.user.email, "delete", "document", id, document.name),
    deleteSearchDocument("document", id),
  ]);
  return Response.json({ ok: true });
}
