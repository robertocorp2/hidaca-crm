import { getD1 } from "../../db";

/**
 * Returns the dashboard outstanding balance from the normalized invoice and
 * payment model. Legacy invoices are included only until they are promoted.
 */
export async function getDashboardReceivableBalance() {
  const result = await getD1()
    .prepare(
      `WITH normalized AS (
         SELECT CASE
           WHEN i.status IN ('cancelled', 'replaced', 'void', 'draft') THEN 0
           WHEN i.total_amount IS NULL AND i.balance_amount_snapshot IS NULL THEN 0
           ELSE MAX(
             COALESCE(
               i.total_amount
                 - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                             WHERE pa.invoice_id = i.id AND pa.status = 'applied'), 0)
                 - COALESCE((SELECT SUM(ca.amount) FROM credit_note_applications ca
                             WHERE ca.invoice_id = i.id AND ca.status = 'applied'), 0),
               i.balance_amount_snapshot,
               0
             ),
             0
           )
         END AS balance
         FROM invoices i
         WHERE i.archived_at IS NULL
       ), legacy AS (
         SELECT CASE
           WHEN LOWER(COALESCE(br.status, '')) IN ('cancelado', 'cancelled', 'void', 'borrador', 'draft') THEN 0
           ELSE MAX(COALESCE(br.balance, 0), 0)
         END AS balance
         FROM business_records br
         WHERE br.module = 'facturas'
           AND br.archived_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM invoices i WHERE i.legacy_record_id = br.id
           )
       )
       SELECT COALESCE((SELECT SUM(balance) FROM normalized), 0)
            + COALESCE((SELECT SUM(balance) FROM legacy), 0) AS balance`,
    )
    .first<{ balance: number | null }>();

  return Math.max(0, Number(result?.balance ?? 0));
}
