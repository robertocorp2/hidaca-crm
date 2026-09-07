import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { reconcileInvoiceBatch } from "../../../../lib/invoice-reconciliation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ module: "importaciones" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const batch = await getD1()
    .prepare(
      `SELECT id, status, summary_json AS summaryJson
       FROM import_batches WHERE id = ?`,
    )
    .bind(id)
    .first<{ id: string; status: string; summaryJson: string }>();
  if (!batch) {
    return Response.json({ error: "Lote no encontrado." }, { status: 404 });
  }
  const reconciliation = await reconcileInvoiceBatch(id);
  const integrity = await getD1()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM invoices i
          LEFT JOIN businesses b ON b.id = i.business_id
          WHERE i.import_batch_id = ? AND b.id IS NULL) AS invoiceBusinessOrphans,
         (SELECT COUNT(*) FROM payments p
          LEFT JOIN businesses b ON b.id = p.business_id
          WHERE p.import_batch_id = ? AND b.id IS NULL) AS paymentBusinessOrphans,
         (SELECT COUNT(*) FROM credit_notes cn
          LEFT JOIN businesses b ON b.id = cn.business_id
          WHERE cn.import_batch_id = ? AND b.id IS NULL) AS creditBusinessOrphans,
         (SELECT COUNT(*) FROM invoices i
          WHERE i.import_batch_id = ? AND i.ncf_normalized <> '' AND EXISTS (
            SELECT 1 FROM invoices x WHERE x.id <> i.id
              AND x.ncf_normalized = i.ncf_normalized
              AND x.archived_at IS NULL)) AS duplicateNcfs,
         (SELECT COUNT(*) FROM business_records) AS legacyCount,
         (SELECT COUNT(*) FROM documents d
          JOIN import_files f ON f.document_id = d.id
          WHERE f.batch_id = ? AND (d.sha256 = '' OR d.object_key = '')) AS missingEvidence,
         (SELECT COUNT(*) FROM invoices i
          WHERE i.import_batch_id = ? AND i.archived_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM search_documents sd
            WHERE sd.entity_type = 'invoice' AND sd.entity_id = i.id
          )) +
         (SELECT COUNT(*) FROM payments p
          WHERE p.import_batch_id = ? AND p.status <> 'void' AND NOT EXISTS (
            SELECT 1 FROM search_documents sd
            WHERE sd.entity_type = 'payment' AND sd.entity_id = p.id
          )) +
         (SELECT COUNT(*) FROM credit_notes cn
          WHERE cn.import_batch_id = ? AND cn.archived_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM search_documents sd
            WHERE sd.entity_type = 'credit_note' AND sd.entity_id = cn.id
          )) AS missingSearch,
         (SELECT COUNT(*) FROM invoices i WHERE i.import_batch_id = ? AND NOT EXISTS (
            SELECT 1 FROM entity_history eh
            WHERE eh.entity_type = 'invoice' AND eh.entity_id = i.id
          )) +
         (SELECT COUNT(*) FROM payments p WHERE p.import_batch_id = ? AND NOT EXISTS (
            SELECT 1 FROM entity_history eh
            WHERE eh.entity_type = 'payment' AND eh.entity_id = p.id
          )) +
         (SELECT COUNT(*) FROM credit_notes cn WHERE cn.import_batch_id = ? AND NOT EXISTS (
            SELECT 1 FROM entity_history eh
            WHERE eh.entity_type = 'credit_note' AND eh.entity_id = cn.id
          )) AS missingHistory`,
    )
    .bind(id, id, id, id, id, id, id, id, id, id, id)
    .first<{
      invoiceBusinessOrphans: number;
      paymentBusinessOrphans: number;
      creditBusinessOrphans: number;
      duplicateNcfs: number;
      legacyCount: number;
      missingEvidence: number;
      missingSearch: number;
      missingHistory: number;
    }>();
  const sourceObjects =
    (
      await getD1()
        .prepare(
          `SELECT d.object_key AS objectKey
           FROM documents d JOIN import_files f ON f.document_id = d.id
           WHERE f.batch_id = ?`,
        )
        .bind(id)
        .all<{ objectKey: string }>()
    ).results ?? [];
  const bucket = (env as unknown as {
    FILES?: { head(key: string): Promise<unknown | null> };
  }).FILES;
  let inaccessibleObjects = bucket ? 0 : sourceObjects.length;
  if (bucket) {
    for (const source of sourceObjects) {
      if (!(await bucket.head(source.objectKey))) inaccessibleObjects += 1;
    }
  }
  const summary = parseObject(batch.summaryJson);
  const initialReconciliation = parseObject(summary.reconciliation);
  const initialTotals = parseObject(initialReconciliation.totals);
  const expectedLegacy = Number(initialTotals.legacy_business_records);
  const checks = [
    {
      key: "batch_status",
      label: "Estado del lote",
      pass: ["completed", "reversed"].includes(batch.status),
      expected: "completed|reversed",
      actual: batch.status,
    },
    {
      key: "reconciliation",
      label: "Conciliación financiera y de conteos",
      pass: reconciliation.balanced,
      expected: true,
      actual: reconciliation.balanced,
    },
    {
      key: "foreign_keys",
      label: "Relaciones empresa-documento",
      pass:
        Number(integrity?.invoiceBusinessOrphans ?? 0) +
          Number(integrity?.paymentBusinessOrphans ?? 0) +
          Number(integrity?.creditBusinessOrphans ?? 0) ===
        0,
      expected: 0,
      actual:
        Number(integrity?.invoiceBusinessOrphans ?? 0) +
        Number(integrity?.paymentBusinessOrphans ?? 0) +
        Number(integrity?.creditBusinessOrphans ?? 0),
    },
    {
      key: "ncf_unique",
      label: "NCF únicos",
      pass: Number(integrity?.duplicateNcfs ?? 0) === 0,
      expected: 0,
      actual: Number(integrity?.duplicateNcfs ?? 0),
    },
    {
      key: "source_evidence",
      label: "Originales y hashes preservados",
      pass: Number(integrity?.missingEvidence ?? 0) === 0,
      expected: 0,
      actual: Number(integrity?.missingEvidence ?? 0),
    },
    {
      key: "source_access",
      label: "Originales accesibles en almacenamiento privado",
      pass: inaccessibleObjects === 0,
      expected: 0,
      actual: inaccessibleObjects,
    },
    {
      key: "search_index",
      label: "Registros visibles en búsqueda",
      pass: Number(integrity?.missingSearch ?? 0) === 0,
      expected: 0,
      actual: Number(integrity?.missingSearch ?? 0),
    },
    {
      key: "audit_history",
      label: "Historial de auditoría por entidad",
      pass: Number(integrity?.missingHistory ?? 0) === 0,
      expected: 0,
      actual: Number(integrity?.missingHistory ?? 0),
    },
    {
      key: "legacy_preserved",
      label: "Registros heredados preservados",
      pass:
        !Number.isFinite(expectedLegacy) ||
        Number(integrity?.legacyCount ?? 0) >= expectedLegacy,
      expected: Number.isFinite(expectedLegacy) ? expectedLegacy : null,
      actual: Number(integrity?.legacyCount ?? 0),
    },
  ];
  return Response.json({
    batchId: id,
    generatedAt: new Date().toISOString(),
    passed: checks.every((check) => check.pass),
    checks,
    reconciliation,
    integrity,
    inaccessibleObjects,
    unresolvedIssues: reconciliation.openIssuesByType,
  });
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
