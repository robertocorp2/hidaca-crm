import { getD1 } from "../../../db";
import { authorizeInvoiceApi } from "../../lib/invoice-api";
import { getDashboardReceivableBalance } from "../../lib/dashboard-financials";

export async function GET(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "cuentas-cobrar" });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const aging = (url.searchParams.get("aging") ?? "").trim();
  const now = new Date().toISOString().slice(0, 10);
  if (url.searchParams.get("summary") === "1") {
    return Response.json({
      totalBalance: await getDashboardReceivableBalance(),
      asOf: now,
    });
  }
  const receivables =
    (
      await getD1()
        .prepare(
          `WITH balances AS (
             SELECT i.id, i.invoice_number_raw, i.business_id, i.issue_date,
               i.due_date, i.currency, i.total_amount, i.status,
               i.balance_amount_snapshot,
               COALESCE((SELECT SUM(amount) FROM payment_allocations
                         WHERE invoice_id = i.id AND status = 'applied'), 0) AS paid,
               COALESCE((SELECT SUM(amount) FROM credit_note_applications
                         WHERE invoice_id = i.id AND status = 'applied'), 0) AS credited
             FROM invoices i WHERE i.archived_at IS NULL
           )
           SELECT x.id, x.invoice_number_raw AS invoiceNumberRaw,
             b.name AS businessName, x.issue_date AS issueDate,
             x.due_date AS dueDate, x.currency, x.total_amount AS totalAmount,
             x.paid AS paidAmount, x.credited AS creditedAmount,
             COALESCE(x.total_amount - x.paid - x.credited, x.balance_amount_snapshot) AS balanceAmount,
             CASE
               WHEN x.status = 'cancelled' THEN 'cancelled'
               WHEN COALESCE(x.total_amount - x.paid - x.credited, x.balance_amount_snapshot, 0) <= 0.005 THEN 'paid'
               WHEN x.due_date IS NOT NULL AND x.due_date < ? THEN 'overdue'
               WHEN x.paid + x.credited > 0 THEN 'partial'
               ELSE 'unpaid'
             END AS receivableStatus,
             CAST(julianday(?) - julianday(COALESCE(x.due_date, x.issue_date, ?)) AS INTEGER) AS daysPastDue,
             rs.balance_amount AS snapshotBalance,
             rs.as_of AS snapshotAsOf
           FROM balances x
           JOIN businesses b ON b.id = x.business_id
           LEFT JOIN receivable_snapshots rs ON rs.id = (
             SELECT id FROM receivable_snapshots
             WHERE invoice_id = x.id AND reversed_at IS NULL
             ORDER BY as_of DESC, created_at DESC LIMIT 1
           )
           WHERE (? = '' OR x.invoice_number_raw LIKE ? OR b.name LIKE ?)
             AND (? = '' OR
               (? = 'current' AND (x.due_date IS NULL OR x.due_date >= ?)) OR
               (? = '1-30' AND julianday(?) - julianday(x.due_date) BETWEEN 1 AND 30) OR
               (? = '31-60' AND julianday(?) - julianday(x.due_date) BETWEEN 31 AND 60) OR
               (? = '61-90' AND julianday(?) - julianday(x.due_date) BETWEEN 61 AND 90) OR
               (? = '90+' AND julianday(?) - julianday(x.due_date) > 90))
           ORDER BY COALESCE(x.due_date, x.issue_date) ASC LIMIT 1000`,
        )
        .bind(
          now,
          now,
          now,
          q,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
          aging,
          aging,
          now,
          aging,
          now,
          aging,
          now,
          aging,
          now,
          aging,
          now,
        )
        .all()
    ).results ?? [];
  return Response.json({ receivables, asOf: now });
}
