import { getD1 } from "../../db";
import type { ImportReconciliationResult } from "./importers";

export type InvoiceBatchReconciliation = ImportReconciliationResult & {
  batchId: string;
  generatedAt: string;
  checks: Array<{
    key: string;
    label: string;
    status: "pass" | "warning" | "fail";
    expected: number | string | null;
    actual: number | string | null;
    detail: string;
  }>;
  orphanCounts: {
    invoicesWithoutDocument: number;
    paymentsWithoutDocument: number;
    creditNotesWithoutDocument: number;
    allocationsWithoutEvidence: number;
  };
};

export async function reconcileInvoiceBatch(
  batchId: string,
): Promise<InvoiceBatchReconciliation> {
  const batch = await getD1()
    .prepare(
      `SELECT file_count AS expectedFiles, total_rows AS totalRows,
         duplicate_count AS duplicateCount, review_count AS reviewCount
         , dry_run AS dryRun, status
       FROM import_batches WHERE id = ?`,
    )
    .bind(batchId)
    .first<{
      expectedFiles: number;
      totalRows: number;
      duplicateCount: number;
      reviewCount: number;
      dryRun: number;
      status: string;
    }>();
  if (!batch) throw new Error("IMPORT_BATCH_NOT_FOUND");
  const fileCounts =
    (
      await getD1()
        .prepare(
          `SELECT status, COUNT(*) AS count FROM import_files
           WHERE batch_id = ? GROUP BY status`,
        )
        .bind(batchId)
        .all<{ status: string; count: number }>()
    ).results ?? [];
  const rowCounts =
    (
      await getD1()
        .prepare(
          `SELECT ir.outcome, COUNT(*) AS count
           FROM import_rows ir JOIN import_files f ON f.id = ir.import_file_id
           WHERE f.batch_id = ? GROUP BY ir.outcome`,
        )
        .bind(batchId)
        .all<{ outcome: string; count: number }>()
    ).results ?? [];
  const issueRows =
    (
      await getD1()
        .prepare(
          `SELECT ii.type, COUNT(*) AS count
           FROM import_issues ii JOIN import_files f ON f.id = ii.import_file_id
           WHERE f.batch_id = ? AND ii.status = 'open' GROUP BY ii.type`,
        )
        .bind(batchId)
        .all<{ type: string; count: number }>()
    ).results ?? [];
  const canonical = await getD1()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM invoices WHERE import_batch_id = ?) AS invoices,
         (SELECT COUNT(*) FROM payments WHERE import_batch_id = ?) AS payments,
         (SELECT COUNT(*) FROM credit_notes WHERE import_batch_id = ?) AS creditNotes,
         (SELECT COUNT(*) FROM payment_allocations WHERE import_batch_id = ?) AS allocations,
         (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE import_batch_id = ?) AS invoiceTotal,
         (SELECT COALESCE(SUM(subtotal_amount), 0) FROM invoices WHERE import_batch_id = ?) AS invoiceSubtotal,
         (SELECT COALESCE(SUM(tax_amount), 0) FROM invoices WHERE import_batch_id = ?) AS invoiceTax,
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE import_batch_id = ?) AS paymentTotal,
         (SELECT COALESCE(SUM(total_amount), 0) FROM credit_notes WHERE import_batch_id = ?) AS creditTotal,
         (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE import_batch_id = ? AND status = 'applied') AS allocatedTotal,
         (SELECT COALESCE(SUM(amount), 0) FROM credit_note_applications WHERE import_batch_id = ? AND status = 'applied') AS creditAppliedTotal,
         (SELECT COALESCE(SUM(balance_amount), 0) FROM receivable_snapshots
          WHERE import_batch_id = ? AND reversed_at IS NULL) AS snapshotBalance`,
    )
    .bind(
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
    )
    .first<{
      invoices: number;
      payments: number;
      creditNotes: number;
      allocations: number;
      invoiceTotal: number;
      invoiceSubtotal: number;
      invoiceTax: number;
      paymentTotal: number;
      creditTotal: number;
      allocatedTotal: number;
      creditAppliedTotal: number;
      snapshotBalance: number;
    }>();
  const staged = await getD1()
    .prepare(
      `SELECT
         COUNT(CASE WHEN ir.document_kind = 'invoice' THEN 1 END) AS invoices,
         COUNT(CASE WHEN ir.document_kind IN ('receipt','payment_evidence') THEN 1 END) AS payments,
         COUNT(CASE WHEN ir.document_kind = 'credit_note' THEN 1 END) AS creditNotes,
         COALESCE(SUM(CASE WHEN ir.document_kind = 'invoice'
           THEN CAST(json_extract(ir.normalized_values, '$.total_amount') AS REAL) ELSE 0 END), 0) AS invoiceTotal,
         COALESCE(SUM(CASE WHEN ir.document_kind = 'invoice'
           THEN CAST(json_extract(ir.normalized_values, '$.subtotal_amount') AS REAL) ELSE 0 END), 0) AS invoiceSubtotal,
         COALESCE(SUM(CASE WHEN ir.document_kind = 'invoice'
           THEN CAST(json_extract(ir.normalized_values, '$.tax_amount') AS REAL) ELSE 0 END), 0) AS invoiceTax,
         COALESCE(SUM(CASE WHEN ir.document_kind IN ('receipt','payment_evidence')
           THEN CAST(COALESCE(json_extract(ir.normalized_values, '$.payment_amount'),
             json_extract(ir.normalized_values, '$.total_amount')) AS REAL) ELSE 0 END), 0) AS paymentTotal,
         COALESCE(SUM(CASE WHEN ir.document_kind = 'credit_note'
           THEN CAST(json_extract(ir.normalized_values, '$.total_amount') AS REAL) ELSE 0 END), 0) AS creditTotal,
         COALESCE(SUM(CAST(json_extract(ir.normalized_values, '$.allocation_amount') AS REAL)), 0) AS allocatedTotal,
         COALESCE(SUM(CAST(json_extract(ir.normalized_values, '$.credit_application_amount') AS REAL)), 0) AS creditAppliedTotal,
         COALESCE(SUM(CASE WHEN ir.document_kind = 'invoice_register'
           THEN CAST(json_extract(ir.normalized_values, '$.balance_amount_snapshot') AS REAL) ELSE 0 END), 0) AS snapshotBalance
       FROM import_rows ir JOIN import_files f ON f.id = ir.import_file_id
       WHERE f.batch_id = ? AND (
         ir.outcome IN ('ready','imported') OR
         (ir.document_kind = 'invoice_register' AND ir.accepted_at IS NOT NULL)
       )`,
    )
    .bind(batchId)
    .first<{
      invoices: number;
      payments: number;
      creditNotes: number;
      invoiceTotal: number;
      invoiceSubtotal: number;
      invoiceTax: number;
      paymentTotal: number;
      creditTotal: number;
      allocatedTotal: number;
      creditAppliedTotal: number;
      snapshotBalance: number;
    }>();
  const orphans = await getD1()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM invoices
          WHERE import_batch_id = ? AND source_document_id IS NULL) AS invoicesWithoutDocument,
         (SELECT COUNT(*) FROM payments
          WHERE import_batch_id = ? AND source_document_id IS NULL) AS paymentsWithoutDocument,
         (SELECT COUNT(*) FROM credit_notes
          WHERE import_batch_id = ? AND source_document_id IS NULL) AS creditNotesWithoutDocument,
         (SELECT COUNT(*) FROM payment_allocations pa
          JOIN payments p ON p.id = pa.payment_id
          WHERE pa.import_batch_id = ? AND
            (pa.source_document_id IS NULL AND p.source_document_id IS NULL)) AS allocationsWithoutEvidence`,
    )
    .bind(batchId, batchId, batchId, batchId)
    .first<InvoiceBatchReconciliation["orphanCounts"]>();
  const files = Object.fromEntries(fileCounts.map((row) => [row.status, Number(row.count)]));
  const outcomes = Object.fromEntries(rowCounts.map((row) => [row.outcome, Number(row.count)]));
  const checks: InvoiceBatchReconciliation["checks"] = [
    countCheck(
      "files",
      "Archivos inventariados",
      Number(batch.expectedFiles),
      fileCounts.reduce((sum, row) => sum + Number(row.count), 0),
    ),
    countCheck(
      "rows",
      "Filas de staging",
      Number(batch.totalRows),
      rowCounts.reduce((sum, row) => sum + Number(row.count), 0),
    ),
    moneyCheck(
      "invoice_total",
      "Total de facturas",
      Number(staged?.invoiceTotal ?? 0),
      batch.dryRun
        ? Number(staged?.invoiceTotal ?? 0)
        : Number(canonical?.invoiceTotal ?? 0),
    ),
    moneyCheck(
      "invoice_subtotal",
      "Subtotal de facturas",
      Number(staged?.invoiceSubtotal ?? 0),
      batch.dryRun
        ? Number(staged?.invoiceSubtotal ?? 0)
        : Number(canonical?.invoiceSubtotal ?? 0),
    ),
    moneyCheck(
      "invoice_tax",
      "Impuestos de facturas",
      Number(staged?.invoiceTax ?? 0),
      batch.dryRun
        ? Number(staged?.invoiceTax ?? 0)
        : Number(canonical?.invoiceTax ?? 0),
    ),
    moneyCheck(
      "payment_total",
      "Total de pagos documentados",
      Number(staged?.paymentTotal ?? 0),
      batch.dryRun
        ? Number(staged?.paymentTotal ?? 0)
        : Number(canonical?.paymentTotal ?? 0),
    ),
    moneyCheck(
      "credit_total",
      "Total de notas de crédito",
      Number(staged?.creditTotal ?? 0),
      batch.dryRun
        ? Number(staged?.creditTotal ?? 0)
        : Number(canonical?.creditTotal ?? 0),
    ),
    moneyCheck(
      "allocated_total",
      "Pagos asignados",
      Number(staged?.allocatedTotal ?? 0),
      batch.dryRun
        ? Number(staged?.allocatedTotal ?? 0)
        : Number(canonical?.allocatedTotal ?? 0),
    ),
    moneyCheck(
      "credit_applied_total",
      "Créditos aplicados",
      Number(staged?.creditAppliedTotal ?? 0),
      batch.dryRun
        ? Number(staged?.creditAppliedTotal ?? 0)
        : Number(canonical?.creditAppliedTotal ?? 0),
    ),
    moneyCheck(
      "snapshot_balance",
      "Saldos de la matriz",
      Number(staged?.snapshotBalance ?? 0),
      batch.dryRun
        ? Number(staged?.snapshotBalance ?? 0)
        : Number(canonical?.snapshotBalance ?? 0),
    ),
  ];
  const orphanCounts = orphans ?? {
    invoicesWithoutDocument: 0,
    paymentsWithoutDocument: 0,
    creditNotesWithoutDocument: 0,
    allocationsWithoutEvidence: 0,
  };
  checks.push({
    key: "lineage",
    label: "Linaje documental",
    status: Object.values(orphanCounts).some((value) => Number(value) > 0)
      ? "fail"
      : "pass",
    expected: 0,
    actual: Object.values(orphanCounts).reduce(
      (sum, value) => sum + Number(value),
      0,
    ),
    detail: "Cada registro aceptado debe conservar su documento fuente.",
  });
  const openIssuesByType = Object.fromEntries(
    issueRows.map((row) => [row.type, Number(row.count)]),
  );
  return {
    batchId,
    generatedAt: new Date().toISOString(),
    expectedFiles: Number(batch.expectedFiles),
    parsedFiles: Number(files.parsed ?? 0) + Number(files.accepted ?? 0),
    partialFiles: Number(files.partial ?? 0) + Number(files.review_required ?? 0),
    unreadableFiles: Number(files.failed ?? 0),
    invoiceCount: Number(staged?.invoices ?? 0),
    duplicateCount: Number(batch.duplicateCount),
    reviewCount: Number(
      outcomes.manual_review ?? batch.reviewCount ?? 0,
    ),
    createdCount:
      Number(canonical?.invoices ?? 0) +
      Number(canonical?.payments ?? 0) +
      Number(canonical?.creditNotes ?? 0),
    linkedCount: Number(outcomes.matched ?? 0),
    totals: {
      staged_invoice_total: Number(staged?.invoiceTotal ?? 0),
      canonical_invoice_total: Number(canonical?.invoiceTotal ?? 0),
      staged_invoice_subtotal: Number(staged?.invoiceSubtotal ?? 0),
      canonical_invoice_subtotal: Number(canonical?.invoiceSubtotal ?? 0),
      staged_invoice_tax: Number(staged?.invoiceTax ?? 0),
      canonical_invoice_tax: Number(canonical?.invoiceTax ?? 0),
      staged_payment_total: Number(staged?.paymentTotal ?? 0),
      canonical_payment_total: Number(canonical?.paymentTotal ?? 0),
      staged_credit_total: Number(staged?.creditTotal ?? 0),
      canonical_credit_total: Number(canonical?.creditTotal ?? 0),
      staged_allocated_total: Number(staged?.allocatedTotal ?? 0),
      canonical_allocated_total: Number(canonical?.allocatedTotal ?? 0),
      staged_credit_applied_total: Number(staged?.creditAppliedTotal ?? 0),
      canonical_credit_applied_total: Number(
        canonical?.creditAppliedTotal ?? 0,
      ),
      canonical_snapshot_balance: Number(canonical?.snapshotBalance ?? 0),
      staged_snapshot_balance: Number(staged?.snapshotBalance ?? 0),
    },
    openIssuesByType,
    balanced:
      checks.every((check) => check.status === "pass") &&
      !issueRows.some((row) =>
        [
          "balance_reconciliation",
          "duplicate_ncf",
          "provenance_missing",
        ].includes(row.type),
      ),
    checks,
    orphanCounts,
  };
}

function countCheck(
  key: string,
  label: string,
  expected: number,
  actual: number,
) {
  return {
    key,
    label,
    status: expected === actual ? ("pass" as const) : ("fail" as const),
    expected,
    actual,
    detail:
      expected === actual
        ? "El conteo coincide."
        : "El conteo requiere investigación.",
  };
}
function moneyCheck(
  key: string,
  label: string,
  expected: number,
  actual: number,
) {
  const difference = Math.abs(expected - actual);
  return {
    key,
    label,
    status:
      difference <= 0.01
        ? ("pass" as const)
        : difference <= 1
          ? ("warning" as const)
          : ("fail" as const),
    expected,
    actual,
    detail: `Diferencia: ${difference.toFixed(2)}.`,
  };
}
