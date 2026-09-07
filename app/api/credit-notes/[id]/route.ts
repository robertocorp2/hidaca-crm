import { getD1 } from "../../../../db";
import { authorizeInvoiceApi } from "../../../lib/invoice-api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const creditNote = await getD1()
    .prepare(
      `SELECT cn.*, b.name AS business_name,
         COALESCE(SUM(CASE WHEN ca.status = 'applied' THEN ca.amount ELSE 0 END), 0) AS applied_amount
       FROM credit_notes cn JOIN businesses b ON b.id = cn.business_id
       LEFT JOIN credit_note_applications ca ON ca.credit_note_id = cn.id
       WHERE cn.id = ? AND cn.archived_at IS NULL GROUP BY cn.id`,
    )
    .bind(id)
    .first();
  if (!creditNote) {
    return Response.json(
      { error: "Nota de crédito no encontrada." },
      { status: 404 },
    );
  }
  const applications =
    (
      await getD1()
        .prepare(
          `SELECT ca.*, i.invoice_number_raw
           FROM credit_note_applications ca JOIN invoices i ON i.id = ca.invoice_id
           WHERE ca.credit_note_id = ? ORDER BY ca.created_at DESC`,
        )
        .bind(id)
        .all()
    ).results ?? [];
  return Response.json({ creditNote, applications });
}
