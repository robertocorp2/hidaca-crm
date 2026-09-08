import { getD1 } from "../../../../db";
import { authorizeInvoiceApi } from "../../../lib/invoice-api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ module: "pagos" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payment = await getD1()
    .prepare(
      `SELECT p.*, b.name AS business_name,
         COALESCE(SUM(CASE WHEN pa.status = 'applied' THEN pa.amount ELSE 0 END), 0) AS allocated_amount
       FROM payments p JOIN businesses b ON b.id = p.business_id
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       WHERE p.id = ? GROUP BY p.id`,
    )
    .bind(id)
    .first();
  if (!payment) {
    return Response.json({ error: "Pago no encontrado." }, { status: 404 });
  }
  const allocations =
    (
      await getD1()
        .prepare(
          `SELECT pa.*, i.invoice_number_raw, b.name AS business_name
           FROM payment_allocations pa
           JOIN invoices i ON i.id = pa.invoice_id
           JOIN businesses b ON b.id = i.business_id
           WHERE pa.payment_id = ? ORDER BY pa.created_at DESC`,
        )
        .bind(id)
        .all()
    ).results ?? [];
  return Response.json({ payment, allocations });
}
