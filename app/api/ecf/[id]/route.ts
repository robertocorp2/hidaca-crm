import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ecfArtifacts, ecfDocuments, ecfStatusHistory, ecfValidations } from "../../../../db/schema";
import { authorizeInvoiceApi } from "../../../lib/invoice-api";
import { writeAudit } from "../../../lib/audit";
import { EcfServiceError } from "../../../lib/ecf-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = getDb();
  const [document] = await db.select().from(ecfDocuments).where(eq(ecfDocuments.id, id)).limit(1);
  if (!document) return Response.json({ error: "e-CF no encontrado." }, { status: 404 });
  const [artifacts, validations, history] = await Promise.all([
    db.select().from(ecfArtifacts).where(eq(ecfArtifacts.ecfDocumentId, id)),
    db.select().from(ecfValidations).where(eq(ecfValidations.ecfDocumentId, id)),
    db.select().from(ecfStatusHistory).where(eq(ecfStatusHistory.ecfDocumentId, id)),
  ]);
  return Response.json({ document, artifacts, validations, history }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action ?? "validate");
  const requiredAction = action === "sign" ? "ecf_sign" : action === "submit" ? "ecf_submit" : action === "cancel" ? "ecf_cancel" : action === "retry" || action === "check-status" ? "ecf_retry" : "ecf_generate";
  const auth = await authorizeInvoiceApi({ action: requiredAction as never });
  if (!auth.ok) return auth.response;
  const db = getDb();
  const [document] = await db.select().from(ecfDocuments).where(eq(ecfDocuments.id, id)).limit(1);
  if (!document) return Response.json({ error: "e-CF no encontrado." }, { status: 404 });
  if (action === "cancel") {
    if (["submitted", "processing", "accepted", "accepted_conditionally"].includes(document.status)) return Response.json({ error: "Un e-CF enviado no se cancela editando su estado; utiliza el flujo oficial correspondiente." }, { status: 409 });
    const now = new Date().toISOString();
    await db.update(ecfDocuments).set({ status: "cancelled", updatedAt: now }).where(and(eq(ecfDocuments.id, id), eq(ecfDocuments.status, document.status)));
    await db.insert(ecfStatusHistory).values({ id: crypto.randomUUID(), ecfDocumentId: id, fromStatus: document.status, toStatus: "cancelled", actorEmail: auth.user.email, detail: "Cancelación local antes del envío.", createdAt: now });
    await writeAudit(auth.user.email, "cancel", "ecf", id, document.encf);
    return Response.json({ ok: true, status: "cancelled" });
  }
  if (action === "validate") return Response.json({ ok: false, status: document.status, schemaValidation: "pending_configuration", message: "La validación XSD oficial debe configurarse antes de firmar o enviar." }, { status: 409 });
  if (action === "sign") return Response.json({ error: "No hay certificado digital e-CF configurado para este ambiente.", code: "CERTIFICATE_NOT_CONFIGURED" }, { status: 503 });
  if (action === "submit" || action === "retry" || action === "check-status") return Response.json({ error: "Los servicios DGII todavía no están configurados para este ambiente.", code: "DGII_SERVICE_NOT_CONFIGURED" }, { status: 503 });
  throw new EcfServiceError("UNSUPPORTED_ACTION", "Acción e-CF no soportada.", 400);
}
