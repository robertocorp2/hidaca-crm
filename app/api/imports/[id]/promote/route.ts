import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { isInvoiceProductionImportEnabled } from "../../../../lib/invoice-import-feature";
import { reconcileInvoiceBatch } from "../../../../lib/invoice-reconciliation";
import { POST as acceptInvoiceBatch } from "../accept-invoices/route";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ write: true, admin: true });
  if (!auth.ok) return auth.response;
  if (!isInvoiceProductionImportEnabled(env)) {
    return Response.json(
      { error: "La importación de producción está deshabilitada." },
      { status: 404 },
    );
  }
  const payload = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const backupId = String(payload.backupId ?? "").trim();
  const changeWindow = String(payload.changeWindow ?? "").trim();
  if (
    payload.confirm !== "IMPORTAR PRODUCCION" ||
    !backupId ||
    !changeWindow
  ) {
    return Response.json(
      {
        error:
          "Confirma IMPORTAR PRODUCCION e indica respaldo y ventana de cambio.",
      },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const reconciliation = await reconcileInvoiceBatch(id);
  if (!reconciliation.balanced) {
    return Response.json(
      { error: "La conciliación no está balanceada.", reconciliation },
      { status: 409 },
    );
  }
  await getD1()
    .prepare(
      `UPDATE import_batches
       SET summary_json = json_set(summary_json,
         '$.productionControl.backupId', ?,
         '$.productionControl.changeWindow', ?,
         '$.productionControl.approvedBy', ?,
         '$.productionControl.approvedAt', ?)
       WHERE id = ?`,
    )
    .bind(
      backupId.slice(0, 500),
      changeWindow.slice(0, 500),
      auth.user.email,
      new Date().toISOString(),
      id,
    )
    .run();
  await writeAudit(
    auth.user.email,
    "approve_invoice_production",
    "import_batch",
    id,
    JSON.stringify({ backupId, changeWindow }),
  );
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return acceptInvoiceBatch(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: "ACEPTAR PILOTO" }),
    }),
    context,
  );
}
