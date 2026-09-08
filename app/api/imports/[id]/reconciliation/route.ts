import { getD1 } from "../../../../../db";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { reconcileInvoiceBatch } from "../../../../lib/invoice-reconciliation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ module: "importaciones" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const resolved = await getD1()
    .prepare(
      `SELECT id FROM import_batches WHERE id = ?
       UNION ALL SELECT batch_id AS id FROM import_files WHERE id = ? LIMIT 1`,
    )
    .bind(id, id)
    .first<{ id: string }>();
  if (!resolved) {
    return Response.json({ error: "Lote no encontrado." }, { status: 404 });
  }
  const reconciliation = await reconcileInvoiceBatch(resolved.id);
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const lines = [
      ["clave", "etiqueta", "estado", "esperado", "actual", "detalle"],
      ...reconciliation.checks.map((check) => [
        check.key,
        check.label,
        check.status,
        check.expected,
        check.actual,
        check.detail,
      ]),
    ];
    return new Response(
      lines.map((line) => line.map(csvCell).join(",")).join("\r\n"),
      {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="conciliacion-${resolved.id}.csv"`,
        },
      },
    );
  }
  return Response.json({ reconciliation });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
