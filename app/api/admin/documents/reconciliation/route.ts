import { env } from "cloudflare:workers";
import { authorizeApi } from "../../../../lib/authorization";
import { reconcileDocumentStorage } from "../../../../lib/document-storage";

type FilesBucket = {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: Array<{ key: string; size?: number; uploaded?: Date | string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string): Promise<void>;
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

export async function GET() {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await reconcileDocumentStorage(filesBucket()), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "No se pudo consultar la reconciliación de documentos." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  if (new URL(request.url).searchParams.get("repair") !== "true") {
    return Response.json(
      { error: "La reparación requiere repair=true y una cuenta administradora." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await reconcileDocumentStorage(filesBucket(), true), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "No se pudo ejecutar la reparación de documentos." },
      { status: 503 },
    );
  }
}
