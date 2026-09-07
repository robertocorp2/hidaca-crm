import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../../db";
import { ecfArtifacts } from "../../../../../../db/schema";
import { authorizeInvoiceApi } from "../../../../../lib/invoice-api";

type RouteContext = { params: Promise<{ id: string; artifactId: string }> };

/** Streams a previously stored e-CF artifact without exposing the R2 key. */
export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi({ action: "ecf_xml" });
  if (!auth.ok) return auth.response;
  if (!env.FILES) return Response.json({ error: "El almacenamiento de archivos e-CF no está configurado." }, { status: 503 });
  const { id, artifactId } = await context.params;
  const [artifact] = await getDb().select().from(ecfArtifacts).where(and(eq(ecfArtifacts.id, artifactId), eq(ecfArtifacts.ecfDocumentId, id))).limit(1);
  if (!artifact) return Response.json({ error: "Artefacto e-CF no encontrado." }, { status: 404 });
  const object = await env.FILES.get(artifact.storageKey);
  if (!object) return Response.json({ error: "El artefacto e-CF no está disponible." }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": artifact.mimeType, "content-length": String(artifact.byteLength), "content-disposition": `attachment; filename="${safeFilename(artifact.kind, artifact.mimeType)}"`, "cache-control": "private, no-store" } });
}

function safeFilename(kind: string, mimeType: string) {
  const extension = mimeType.includes("xml") ? "xml" : mimeType.includes("pdf") ? "pdf" : "bin";
  return `ecf-${kind.replace(/[^a-z0-9_-]/gi, "_")}.${extension}`;
}
