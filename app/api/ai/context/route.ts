import { authorizeApi } from "../../../lib/authorization";
import {
  getRecordAiContext,
  normalizeRecordContextEntityType,
} from "../../../lib/record-ai-context";

export async function GET(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "view" });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const entityType = normalizeRecordContextEntityType(
    url.searchParams.get("entityType"),
  );
  const entityId = String(url.searchParams.get("entityId") ?? "")
    .trim()
    .slice(0, 80);
  if (!entityType || !entityId) {
    return Response.json(
      { error: "Tipo e identificador de registro válidos son obligatorios." },
      { status: 400 },
    );
  }
  try {
    const context = await getRecordAiContext(auth.user, entityType, entityId);
    if (!context) {
      return Response.json({ error: "Registro no encontrado." }, { status: 404 });
    }
    return Response.json(
      { context },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "RECORD_CONTEXT_FORBIDDEN") {
      return Response.json(
        { error: "No tienes permiso para consultar este registro." },
        { status: 403 },
      );
    }
    throw error;
  }
}
