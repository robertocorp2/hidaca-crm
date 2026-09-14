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
      source: "normalized_invoice_read_model",
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
             CASE
               WHEN x.status IN ('cancelled', 'replaced', 'void', 'draft') THEN 0
               WHEN x.paid > 0 OR x.credited > 0 THEN MAX(COALESCE(x.total_amount, 0) - x.paid - x.credited, 0)
               WHEN x.balance_amount_snapshot IS NOT NULL THEN MAX(x.balance_amount_snapshot, 0)
               WHEN x.status = 'paid' THEN 0
               ELSE MAX(COALESCE(x.total_amount, 0), 0)
             END AS balanceAmount,
             CASE
               WHEN x.status = 'cancelled' THEN 'cancelled'
               WHEN x.status IN ('replaced', 'void', 'draft') THEN x.status
               WHEN CASE
                 WHEN x.status IN ('cancelled', 'replaced', 'void', 'draft') THEN 0
                 WHEN x.paid > 0 OR x.credited > 0 THEN MAX(COALESCE(x.total_amount, 0) - x.paid - x.credited, 0)
                 WHEN x.balance_amount_snapshot IS NOT NULL THEN MAX(x.balance_amount_snapshot, 0)
                 WHEN x.status = 'paid' THEN 0
                 ELSE MAX(COALESCE(x.total_amount, 0), 0)
               END <= 0.005 THEN 'paid'
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
  const legacyReceivables =
    (
      await getD1()
        .prepare(
          `WITH legacy AS (
             SELECT br.id, br.title, br.customer_name, br.amount, br.balance,
               br.status, br.due_date, br.updated_at,
               COALESCE(
                 NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.invoice_number'), ''),
                 NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.factura'), ''),
                 br.title
               ) AS invoice_number_raw,
               COALESCE(
                 NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.issue_date'), ''),
                 NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.fecha'), '')
               ) AS issue_date
             FROM business_records br
             WHERE br.module = 'facturas'
               AND br.archived_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM invoices i WHERE i.legacy_record_id = br.id
               )
           )
           SELECT id, id AS legacyRecordId, NULL AS businessId,
             customer_name AS businessName, invoice_number_raw AS invoiceNumberRaw,
             issue_date AS issueDate, due_date AS dueDate, 'DOP' AS currency,
             amount AS totalAmount, MAX(COALESCE(amount, 0) - COALESCE(balance, 0), 0) AS paidAmount,
             0 AS creditedAmount,
             CASE
               WHEN lower(trim(status)) IN ('cancelado', 'cancelled', 'reemplazado', 'replaced', 'void', 'borrador', 'draft') THEN 0
               ELSE MAX(COALESCE(balance, 0), 0)
             END AS balanceAmount,
             CASE
               WHEN lower(trim(status)) IN ('cancelado', 'cancelled', 'reemplazado', 'replaced', 'void') THEN 'cancelled'
               WHEN lower(trim(status)) IN ('borrador', 'draft') THEN 'draft'
               WHEN MAX(COALESCE(balance, 0), 0) <= 0.005 THEN 'paid'
               WHEN due_date IS NOT NULL AND due_date < ? THEN 'overdue'
               WHEN COALESCE(balance, 0) < COALESCE(amount, 0) THEN 'partial'
               ELSE 'unpaid'
             END AS receivableStatus,
             CAST(julianday(?) - julianday(COALESCE(due_date, issue_date, ?)) AS INTEGER) AS daysPastDue,
             NULL AS snapshotBalance, NULL AS snapshotAsOf,
             'legacy' AS sourceAuthority
           FROM legacy
           WHERE (? = '' OR invoice_number_raw LIKE ? OR customer_name LIKE ?)
             AND (? = '' OR
               (? = 'current' AND (due_date IS NULL OR due_date >= ?)) OR
               (? = '1-30' AND julianday(?) - julianday(due_date) BETWEEN 1 AND 30) OR
               (? = '31-60' AND julianday(?) - julianday(due_date) BETWEEN 31 AND 60) OR
               (? = '61-90' AND julianday(?) - julianday(due_date) BETWEEN 61 AND 90) OR
               (? = '90+' AND julianday(?) - julianday(due_date) > 90))
           ORDER BY COALESCE(due_date, issue_date) ASC LIMIT 1000`,
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
  return Response.json({ receivables, legacyReceivables, asOf: now });
}
