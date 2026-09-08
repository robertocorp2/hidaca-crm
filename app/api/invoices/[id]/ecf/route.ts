import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { buildEcfReview, ecfFeatureEnabled, EcfServiceError, EcfValidationError, generateEcf } from "../../../../lib/ecf-service";
import { ecfTypes } from "../../../../lib/ecf-domain";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: RouteContext) {
  if (!ecfFeatureEnabled()) return Response.json({ error: "La facturación electrónica no está habilitada." }, { status: 404 });
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const review = await buildEcfReview(id, {});
  if (!review) return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  const { getD1 } = await import("../../../../../db");
  const documents = (await getD1().prepare("SELECT d.*, (SELECT COUNT(*) FROM ecf_validations v WHERE v.ecf_document_id = d.id AND v.severity = 'error') AS validation_errors FROM ecf_documents d WHERE d.source_invoice_id = ? ORDER BY d.created_at DESC").bind(id).all()).results ?? [];
  return Response.json({ review, documents }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!ecfFeatureEnabled()) return Response.json({ error: "La facturación electrónica no está habilitada." }, { status: 404 });
  const auth = await authorizeInvoiceApi({ action: "ecf_generate" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ecfType = String(payload.ecfType ?? "31");
  if (!ecfTypes.includes(ecfType as never)) return Response.json({ error: "Tipo e-CF no habilitado." }, { status: 400 });
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) return Response.json({ error: "Debes enviar Idempotency-Key para evitar duplicados." }, { status: 400 });
  try {
    const result = await generateEcf({ invoiceId: id, ecfType: ecfType as never, environment: (String(payload.environment ?? "test") as never), actorEmail: auth.user.email, idempotencyKey, supplements: isObject(payload.supplements) ? payload.supplements as Record<string, string | number | boolean> : undefined });
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof EcfValidationError) return Response.json({ error: error.message, code: error.code, issues: error.issues }, { status: error.status });
    const serviceError = error instanceof EcfServiceError ? error : null;
    return Response.json({ error: serviceError?.message ?? "No se pudo generar el e-CF.", code: serviceError?.code }, { status: serviceError?.status ?? 500 });
  }
}

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
