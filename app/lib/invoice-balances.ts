import { getD1 } from "../../db";

export async function refreshInvoiceBalanceStatus(
  invoiceId: string,
  now = new Date().toISOString(),
) {
  await getD1()
    .prepare(
      `UPDATE invoices SET status = CASE
         WHEN status IN ('cancelled', 'replaced') THEN status
         WHEN total_amount IS NULL THEN status
         WHEN total_amount
           - COALESCE((SELECT SUM(amount) FROM payment_allocations
                       WHERE invoice_id = invoices.id AND status = 'applied'), 0)
           - COALESCE((SELECT SUM(amount) FROM credit_note_applications
                       WHERE invoice_id = invoices.id AND status = 'applied'), 0)
           <= 0.005 THEN 'paid'
         WHEN COALESCE((SELECT SUM(amount) FROM payment_allocations
                        WHERE invoice_id = invoices.id AND status = 'applied'), 0)
            + COALESCE((SELECT SUM(amount) FROM credit_note_applications
                        WHERE invoice_id = invoices.id AND status = 'applied'), 0)
            > 0 THEN 'partial'
         WHEN due_date IS NOT NULL AND due_date < ? THEN 'overdue'
         ELSE status END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(now.slice(0, 10), now, invoiceId)
    .run();
}

export async function refreshCreditNoteStatus(
  creditNoteId: string,
  now = new Date().toISOString(),
) {
  await getD1()
    .prepare(
      `UPDATE credit_notes SET status = CASE
         WHEN status = 'void' THEN status
         WHEN total_amount IS NOT NULL AND
           COALESCE((SELECT SUM(amount) FROM credit_note_applications
                     WHERE credit_note_id = credit_notes.id
                       AND status = 'applied'), 0) >= total_amount - 0.005
           THEN 'applied'
         ELSE 'issued' END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, creditNoteId)
    .run();
}
