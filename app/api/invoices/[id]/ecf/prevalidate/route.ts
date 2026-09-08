import { authorizeInvoiceApi } from "../../../../../lib/invoice-api";
import { buildEcfReview, ecfFeatureEnabled, EcfServiceError } from "../../../../../lib/ecf-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!ecfFeatureEnabled()) return Response.json({ error: "La facturación electrónica no está habilitada." }, { status: 404 });
  const auth = await authorizeInvoiceApi({ action: "ecf_generate" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const review = await buildEcfReview(id, payload);
    if (!review) return Response.json({ error: "Factura no encontrada." }, { status: 404 });
    return Response.json({
      invoiceId: id,
      ecfType: review.ecfType,
      environment: review.environment,
      snapshot: review.snapshot,
      issues: review.issues,
      existing: review.existing,
      ready: !review.issues.some((issue) => issue.severity === "error"),
      schemaValidation: "pending_configuration",
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const serviceError = error instanceof EcfServiceError ? error : null;
    return Response.json({ error: serviceError?.message ?? "No se pudo validar la factura." }, { status: serviceError?.status ?? 500 });
  }
}
