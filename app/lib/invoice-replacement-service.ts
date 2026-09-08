import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import {
  invoiceReplacementCount,
  invoiceReplacementCommitDecision,
  sourceCompanyKey,
  type InvoiceReplacementRow,
  type ParsedInvoiceReplacement,
} from "./invoice-replacement";

type FilesBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

type BusinessRow = {
  id: string;
  name: string;
  normalizedName: string;
  rnc: string;
  normalizedRnc: string;
  updatedAt: string;
};

type ResolvedBusiness = {
  key: string;
  name: string;
  normalizedName: string;
  rnc: string;
  normalizedRnc: string;
  existingBusinessId: string | null;
  invoiceNumbers: string[];
};

export type InvoiceReplacementPreview = {
  workbook: {
    filename: string;
    sha256: string;
    invoices: number;
    fiscalIdentities: number;
    sheets: string[];
    totals: ParsedInvoiceReplacement["totals"];
  };
  companies: {
    matchedInvoices: number;
    newInvoices: number;
    existing: Array<{
      invoiceNumber: string;
      businessId: string;
      businessName: string;
      matchedBy: "rnc" | "name";
    }>;
    new: Array<{
      name: string;
      rnc: string;
      invoiceNumbers: string[];
    }>;
    ambiguous: Array<{
      invoiceNumber: string;
      businessName: string;
      key: string;
      candidateIds: string[];
    }>;
  };
  purge: {
    legacyInvoices: Array<{ id: string; title: string }>;
    batches: Array<{ id: string; name: string; source: string }>;
    files: Array<{ id: string; filename: string; sha256: string }>;
    documents: number;
    storageObjects: number;
  };
  current: {
    invoices: number;
    invoiceLines: number;
    payments: number;
    allocations: number;
    creditNotes: number;
    creditApplications: number;
    receivableSnapshots: number;
    collectionActivities: number;
    legacyDependencies: number;
  };
  preserved: {
    quotationRecords: number;
    quotationBatches: number;
    quotations: number;
  };
  blockers: string[];
  canCommit: boolean;
  stateFingerprint: string;
  alreadyCommitted: null | { batchId: string; invoiceCount: number };
};

type Preflight = {
  preview: InvoiceReplacementPreview;
  resolvedBusinesses: ResolvedBusiness[];
  rowBusinessKeys: Map<string, string>;
  targetBatchIds: string[];
  targetDocumentIds: string[];
  targetStorageKeys: string[];
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento privado no está disponible.");
  return bucket;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function businessKey(row: InvoiceReplacementRow) {
  return sourceCompanyKey(row.businessName, row.rnc);
}

async function loadBusinesses(rows: InvoiceReplacementRow[]) {
  const stored =
    (
      await getD1()
        .prepare(
          `SELECT id, name, normalized_name AS normalizedName, rnc,
             normalized_rnc AS normalizedRnc, updated_at AS updatedAt
           FROM businesses WHERE archived_at IS NULL`,
        )
        .all<BusinessRow>()
    ).results ?? [];
  const byRnc = new Map<string, BusinessRow[]>();
  const byName = new Map<string, BusinessRow[]>();
  for (const business of stored) {
    if (business.normalizedRnc) {
      const matches = byRnc.get(business.normalizedRnc) ?? [];
      matches.push(business);
      byRnc.set(business.normalizedRnc, matches);
    }
    const matches = byName.get(business.normalizedName) ?? [];
    matches.push(business);
    byName.set(business.normalizedName, matches);
  }

  const existing: InvoiceReplacementPreview["companies"]["existing"] = [];
  const ambiguous: InvoiceReplacementPreview["companies"]["ambiguous"] = [];
  const newByKey = new Map<string, ResolvedBusiness>();
  const existingByKey = new Map<string, ResolvedBusiness>();
  const rowBusinessKeys = new Map<string, string>();
  for (const row of rows) {
    const key = businessKey(row);
    rowBusinessKeys.set(row.invoiceNumberNormalized, key);
    const matches = row.normalizedRnc
      ? byRnc.get(row.normalizedRnc) ?? []
      : byName.get(row.normalizedBusinessName) ?? [];
    if (matches.length > 1) {
      ambiguous.push({
        invoiceNumber: row.invoiceNumber,
        businessName: row.businessName,
        key,
        candidateIds: matches.map((match) => match.id).sort(),
      });
      continue;
    }
    if (matches.length === 1) {
      const business = matches[0];
      existing.push({
        invoiceNumber: row.invoiceNumber,
        businessId: business.id,
        businessName: business.name,
        matchedBy: row.normalizedRnc ? "rnc" : "name",
      });
      const resolved = existingByKey.get(key) ?? {
        key,
        name: business.name,
        normalizedName: business.normalizedName,
        rnc: business.rnc,
        normalizedRnc: business.normalizedRnc,
        existingBusinessId: business.id,
        invoiceNumbers: [],
      };
      resolved.invoiceNumbers.push(row.invoiceNumber);
      existingByKey.set(key, resolved);
      continue;
    }
    const resolved = newByKey.get(key) ?? {
      key,
      name: row.businessName,
      normalizedName: row.normalizedBusinessName,
      rnc: row.rnc,
      normalizedRnc: row.normalizedRnc,
      existingBusinessId: null,
      invoiceNumbers: [],
    };
    resolved.invoiceNumbers.push(row.invoiceNumber);
    newByKey.set(key, resolved);
  }
  return {
    existing,
    ambiguous,
    newBusinesses: [...newByKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resolvedBusinesses: [...existingByKey.values(), ...newByKey.values()],
    rowBusinessKeys,
    storedState: stored
      .map((business) => [business.id, business.normalizedName, business.normalizedRnc, business.updatedAt])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
}

async function canonicalCounts() {
  const row = await getD1()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM invoices) AS invoices,
        (SELECT COUNT(*) FROM invoice_lines) AS invoiceLines,
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM payment_allocations) AS allocations,
        (SELECT COUNT(*) FROM credit_notes) AS creditNotes,
        (SELECT COUNT(*) FROM credit_note_applications) AS creditApplications,
        (SELECT COUNT(*) FROM receivable_snapshots) AS receivableSnapshots,
        (SELECT COUNT(*) FROM collection_activities) AS collectionActivities`,
    )
    .first<Record<string, number>>();
  return {
    invoices: Number(row?.invoices ?? 0),
    invoiceLines: Number(row?.invoiceLines ?? 0),
    payments: Number(row?.payments ?? 0),
    allocations: Number(row?.allocations ?? 0),
    creditNotes: Number(row?.creditNotes ?? 0),
    creditApplications: Number(row?.creditApplications ?? 0),
    receivableSnapshots: Number(row?.receivableSnapshots ?? 0),
    collectionActivities: Number(row?.collectionActivities ?? 0),
  };
}

async function preservedQuotationCounts() {
  const row = await getD1()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM business_records WHERE module = 'cotizaciones') AS quotationRecords,
        (SELECT COUNT(*) FROM import_batches WHERE source = 'combined_register') AS quotationBatches,
        (SELECT COUNT(*) FROM quotations) AS quotations`,
    )
    .first<Record<string, number>>();
  return {
    quotationRecords: Number(row?.quotationRecords ?? 0),
    quotationBatches: Number(row?.quotationBatches ?? 0),
    quotations: Number(row?.quotations ?? 0),
  };
}

async function loadLegacyInvoices() {
  const records =
    (
      await getD1()
        .prepare(
          `SELECT id, title FROM business_records
           WHERE module = 'facturas' ORDER BY created_at, id`,
        )
        .all<{ id: string; title: string }>()
    ).results ?? [];
  const dependencies = await getD1()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM businesses WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM contacts WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM projects WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM quotations WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM invoices WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM payments WHERE legacy_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) +
        (SELECT COUNT(*) FROM opportunity_quotes WHERE quote_record_id IN
          (SELECT id FROM business_records WHERE module = 'facturas')) AS count`,
    )
    .first<{ count: number }>();
  return { records, dependencies: Number(dependencies?.count ?? 0) };
}

async function loadTargetImports(sourceHashes: string[]) {
  const hashClause = sourceHashes.length
    ? ` OR (b.source <> 'invoice_replace' AND f.sha256 IN (${placeholders(sourceHashes)}))`
    : "";
  const batches =
    (
      await getD1()
        .prepare(
          `SELECT DISTINCT b.id, b.name, b.source
           FROM import_batches b LEFT JOIN import_files f ON f.batch_id = b.id
           WHERE b.source = 'invoice_import'${hashClause}
           ORDER BY b.created_at, b.id`,
        )
        .bind(...sourceHashes)
        .all<{ id: string; name: string; source: string }>()
    ).results ?? [];
  if (!batches.length) {
    return { batches, files: [], documentIds: [], storageKeys: [] };
  }
  const ids = batches.map((batch) => batch.id);
  const files =
    (
      await getD1()
        .prepare(
          `SELECT f.id, f.filename, f.sha256, f.document_id AS documentId,
             f.extracted_object_key AS extractedObjectKey,
             d.object_key AS documentObjectKey
           FROM import_files f JOIN documents d ON d.id = f.document_id
           WHERE f.batch_id IN (${placeholders(ids)}) ORDER BY f.imported_at, f.id`,
        )
        .bind(...ids)
        .all<{
          id: string;
          filename: string;
          sha256: string;
          documentId: string;
          extractedObjectKey: string;
          documentObjectKey: string;
        }>()
    ).results ?? [];
  return {
    batches,
    files,
    documentIds: [...new Set(files.map((file) => file.documentId))].sort(),
    storageKeys: [
      ...new Set(
        files.flatMap((file) => [file.documentObjectKey, file.extractedObjectKey]).filter(Boolean),
      ),
    ].sort(),
  };
}

async function completedReplacement(workbookHash: string) {
  const batch = await getD1()
    .prepare(
      `SELECT id FROM import_batches
       WHERE source = 'invoice_replace' AND source_hash = ? AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
    )
    .bind(workbookHash)
    .first<{ id: string }>();
  if (!batch) return null;
  const count = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM invoices WHERE import_batch_id = ? AND archived_at IS NULL")
    .bind(batch.id)
    .first<{ count: number }>();
  return { batchId: batch.id, invoiceCount: Number(count?.count ?? 0) };
}

async function preflight(parsed: ParsedInvoiceReplacement): Promise<Preflight> {
  const [businesses, canonical, legacy, targets, preserved, alreadyCommitted] =
    await Promise.all([
      loadBusinesses(parsed.rows),
      canonicalCounts(),
      loadLegacyInvoices(),
      loadTargetImports(parsed.sourceHashes),
      preservedQuotationCounts(),
      completedReplacement(parsed.workbookHash),
    ]);
  const blockers: string[] = [];
  if (businesses.ambiguous.length) {
    blockers.push("Hay empresas ambiguas; cada RNC o nombre sin RNC debe coincidir de forma única.");
  }
  if (!alreadyCommitted && canonical.invoices) {
    blockers.push("Aparecieron facturas normalizadas desde la comparación anterior.");
  }
  if (!alreadyCommitted && (canonical.invoiceLines || canonical.payments || canonical.allocations)) {
    blockers.push("Aparecieron partidas, pagos o asignaciones vinculadas.");
  }
  if (!alreadyCommitted && (canonical.creditNotes || canonical.creditApplications)) {
    blockers.push("Aparecieron notas de crédito o aplicaciones vinculadas.");
  }
  if (!alreadyCommitted && (canonical.receivableSnapshots || canonical.collectionActivities)) {
    blockers.push("Aparecieron snapshots o actividades de cobranza vinculadas.");
  }
  if (legacy.dependencies) {
    blockers.push("El registro heredado de Facturas adquirió dependencias fuera del alcance de la purga.");
  }
  const fingerprintInput = {
    workbookHash: parsed.workbookHash,
    canonical,
    legacy: legacy.records,
    legacyDependencies: legacy.dependencies,
    targetBatches: targets.batches,
    targetFiles: targets.files.map((file) => [file.id, file.sha256, file.documentId]),
    targetStorageKeys: targets.storageKeys,
    businessState: businesses.storedState,
    resolution: [
      ...businesses.existing.map((match) => [match.invoiceNumber, match.businessId, match.matchedBy]),
      ...businesses.newBusinesses.map((business) => [business.key, ...business.invoiceNumbers]),
    ],
    preserved,
  };
  const stateFingerprint = await fingerprint(fingerprintInput);
  const preview: InvoiceReplacementPreview = {
    workbook: {
      filename: parsed.filename,
      sha256: parsed.workbookHash,
      invoices: parsed.rows.length,
      fiscalIdentities: new Set(parsed.rows.map((row) => row.normalizedNcf)).size,
      sheets: parsed.sheetNames,
      totals: parsed.totals,
    },
    companies: {
      matchedInvoices: businesses.existing.length,
      newInvoices: parsed.rows.length - businesses.existing.length,
      existing: businesses.existing,
      new: businesses.newBusinesses.map((business) => ({
        name: business.name,
        rnc: business.rnc,
        invoiceNumbers: business.invoiceNumbers,
      })),
      ambiguous: businesses.ambiguous,
    },
    purge: {
      legacyInvoices: legacy.records,
      batches: targets.batches,
      files: targets.files.map(({ id, filename, sha256 }) => ({ id, filename, sha256 })),
      documents: targets.documentIds.length,
      storageObjects: targets.storageKeys.length,
    },
    current: { ...canonical, legacyDependencies: legacy.dependencies },
    preserved,
    blockers,
    canCommit: blockers.length === 0 && !alreadyCommitted,
    stateFingerprint,
    alreadyCommitted,
  };
  return {
    preview,
    resolvedBusinesses: businesses.resolvedBusinesses,
    rowBusinessKeys: businesses.rowBusinessKeys,
    targetBatchIds: targets.batches.map((batch) => batch.id),
    targetDocumentIds: targets.documentIds,
    targetStorageKeys: targets.storageKeys,
  };
}

export async function previewInvoiceReplacement(parsed: ParsedInvoiceReplacement) {
  return (await preflight(parsed)).preview;
}

function invoiceSourceValues(row: InvoiceReplacementRow, workbookHash: string) {
  return JSON.stringify({
    kind: "invoice_replacement_2021",
    workbookHash,
    sourceRowNumber: row.sourceRowNumber,
    sourceHash: row.sourceHash,
    authority: row.authority,
    historicalSnapshot: true,
    noPaymentCreated: true,
  });
}

function statement(sql: string, values: unknown[] = []) {
  return getD1().prepare(sql).bind(...values);
}

function scopedDeleteStatements(batchIds: string[], documentIds: string[]) {
  const statements: ReturnType<typeof statement>[] = [];
  if (batchIds.length) {
    const target = `SELECT id FROM import_files WHERE batch_id IN (${placeholders(batchIds)})`;
    statements.push(
      statement(`DELETE FROM import_issues WHERE import_file_id IN (${target})`, batchIds),
      statement(`DELETE FROM import_candidates WHERE import_file_id IN (${target})`, batchIds),
      statement(`DELETE FROM source_references WHERE import_row_id IN (SELECT id FROM import_rows WHERE import_file_id IN (${target}))`, batchIds),
      statement(`DELETE FROM source_field_values WHERE import_file_id IN (${target})`, batchIds),
      statement(`DELETE FROM import_rows WHERE import_file_id IN (${target})`, batchIds),
      statement(`DELETE FROM import_batch_sources WHERE batch_id IN (${placeholders(batchIds)})`, batchIds),
      statement(`DELETE FROM import_files WHERE batch_id IN (${placeholders(batchIds)})`, batchIds),
      statement(`DELETE FROM import_batches WHERE id IN (${placeholders(batchIds)})`, batchIds),
    );
  }
  if (documentIds.length) {
    statements.unshift(
      statement(`DELETE FROM document_links WHERE document_id IN (${placeholders(documentIds)})`, documentIds),
      statement(`DELETE FROM source_references WHERE document_id IN (${placeholders(documentIds)})`, documentIds),
      statement(`DELETE FROM entity_history WHERE source_document_id IN (${placeholders(documentIds)})`, documentIds),
    );
    statements.push(
      statement(`DELETE FROM documents WHERE id IN (${placeholders(documentIds)})`, documentIds),
    );
  }
  return statements;
}

async function deleteStorageObjects(keys: string[]) {
  const bucket = filesBucket();
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await bucket.delete(key);
    } catch {
      try {
        await bucket.delete(key);
      } catch {
        failed.push(key);
      }
    }
  }
  return failed;
}

export async function commitInvoiceReplacement(input: {
  parsed: ParsedInvoiceReplacement;
  bytes: ArrayBuffer;
  expectedWorkbookHash: string;
  expectedStateFingerprint: string;
  actorEmail: string;
}) {
  const fresh = await preflight(input.parsed);
  const decision = invoiceReplacementCommitDecision({
    actualWorkbookHash: input.parsed.workbookHash,
    expectedWorkbookHash: input.expectedWorkbookHash,
    actualStateFingerprint: fresh.preview.stateFingerprint,
    expectedStateFingerprint: input.expectedStateFingerprint,
    alreadyCommittedInvoiceCount: fresh.preview.alreadyCommitted?.invoiceCount ?? 0,
  });
  if (decision === "file_changed") {
    throw new InvoiceReplacementConflict("El archivo cambió después de la previsualización.");
  }
  if (decision === "idempotent") {
    return {
      ok: true,
      idempotent: true,
      batchId: fresh.preview.alreadyCommitted!.batchId,
      finalCount: invoiceReplacementCount,
    };
  }
  if (decision === "state_changed") {
    throw new InvoiceReplacementConflict(
      "La base cambió después de la previsualización. Vuelve a validar antes de confirmar.",
      fresh.preview,
    );
  }
  if (!fresh.preview.canCommit) {
    throw new InvoiceReplacementConflict(
      fresh.preview.blockers[0] ?? "El reemplazo no superó el preflight.",
      fresh.preview,
    );
  }

  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const importFileId = crypto.randomUUID();
  const objectKey = `imports/invoice-replacement-2021/${input.parsed.workbookHash}/source.xlsx`;
  const bucket = filesBucket();
  await bucket.put(objectKey, input.bytes, {
    httpMetadata: {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });

  const businessIds = new Map<string, string>();
  for (const business of fresh.resolvedBusinesses) {
    businessIds.set(business.key, business.existingBusinessId ?? crypto.randomUUID());
  }
  const invoiceIds = new Map<string, string>();
  for (const row of input.parsed.rows) invoiceIds.set(row.invoiceNumberNormalized, crypto.randomUUID());

  const statements = [
    statement(
      `DELETE FROM search_documents WHERE entity_type = 'record' AND entity_id IN
       (SELECT id FROM business_records WHERE module = 'facturas')`,
    ),
    statement("DELETE FROM business_records WHERE module = 'facturas'"),
    ...scopedDeleteStatements(fresh.targetBatchIds, fresh.targetDocumentIds),
    statement(
      `INSERT INTO import_batches (
        id, name, status, source, source_filename, source_hash, dry_run,
        file_count, total_rows, successful_count, matched_count,
        duplicate_count, review_count, failed_count, unmapped_field_count,
        summary_json, created_by, created_at, completed_at
      ) VALUES (?, 'Reemplazo Facturas 2021', 'completed', 'invoice_replace', ?, ?, 0,
        1, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`,
      [
        batchId,
        input.parsed.filename,
        input.parsed.workbookHash,
        invoiceReplacementCount,
        invoiceReplacementCount,
        fresh.preview.companies.matchedInvoices,
        JSON.stringify({
          workbookHash: input.parsed.workbookHash,
          invoices: invoiceReplacementCount,
          companiesCreated: fresh.preview.companies.new.length,
          historicalPaidSnapshot: true,
          invoiceLinesCreated: 0,
        }),
        input.actorEmail,
        now,
        now,
      ],
    ),
    statement(
      `INSERT INTO documents (
        id, record_id, name, object_key, content_type, size, extension,
        sha256, source_path, document_role, parser_name, parsing_status,
        imported_at, created_by, created_at
      ) VALUES (?, NULL, ?, ?, ?, ?, '.xlsx', ?, 'Facturas 2021 consolidadas',
        'invoice_register', 'invoice-replacement-v1', 'parsed', ?, ?, ?)`,
      [
        documentId,
        input.parsed.filename,
        objectKey,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        input.bytes.byteLength,
        input.parsed.workbookHash,
        now,
        input.actorEmail,
        now,
      ],
    ),
    statement(
      `INSERT INTO import_files (
        id, batch_id, document_id, filename, extension, source_path, sha256,
        parser_name, parser_version, document_kind, template_type, status,
        normalized_preview, canonical_links, imported_by, imported_at,
        reviewed_by, reviewed_at, accepted_by, accepted_at
      ) VALUES (?, ?, ?, ?, '.xlsx', 'Facturas 2021 consolidadas', ?,
        'invoice-replacement', '1', 'invoice_register', 'register', 'accepted',
        ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        importFileId,
        batchId,
        documentId,
        input.parsed.filename,
        input.parsed.workbookHash,
        JSON.stringify({ invoices: invoiceReplacementCount, totals: input.parsed.totals }),
        JSON.stringify({ invoiceCount: invoiceReplacementCount }),
        input.actorEmail,
        now,
        input.actorEmail,
        now,
        input.actorEmail,
        now,
      ],
    ),
  ];

  for (const business of fresh.resolvedBusinesses.filter((item) => !item.existingBusinessId)) {
    const id = businessIds.get(business.key)!;
    statements.push(
      statement(
        `INSERT INTO businesses (
          id, legacy_record_id, name, normalized_name, customer_type, rnc,
          normalized_rnc, email, phone, mobile_phone, address, notes,
          source_metadata, owner_email, created_by, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, 'organization', ?, ?, '', '', '', '', '', ?, ?, ?, ?, ?)`,
        [
          id,
          business.name,
          business.normalizedName,
          business.rnc,
          business.normalizedRnc,
          JSON.stringify({
            kind: "invoice_replacement_2021",
            workbookHash: input.parsed.workbookHash,
            invoiceNumbers: business.invoiceNumbers,
          }),
          input.actorEmail,
          input.actorEmail,
          now,
          now,
        ],
      ),
      statement(
        `INSERT INTO search_documents (
          entity_type, entity_id, title, subtitle, search_text, owner_email, updated_at
        ) VALUES ('business', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          business.name,
          business.rnc,
          `${business.name} ${business.rnc}`.trim(),
          input.actorEmail,
          now,
        ],
      ),
    );
  }

  for (const row of input.parsed.rows) {
    const invoiceId = invoiceIds.get(row.invoiceNumberNormalized)!;
    const businessId = businessIds.get(fresh.rowBusinessKeys.get(row.invoiceNumberNormalized)!)!;
    statements.push(
      statement(
        `INSERT INTO invoices (
          id, legacy_record_id, business_id, contact_id, project_id, quotation_id,
          source_document_id, import_batch_id, invoice_number_raw,
          invoice_number_normalized, issue_date, issue_date_raw, issue_year,
          due_date, due_date_raw, ncf_raw, ncf_normalized, ncf_type,
          document_version, status, cancellation_reason, currency,
          payment_terms_raw, purchase_order_number, sales_representative,
          subtotal_amount, discount_amount, taxable_amount, exempt_amount,
          tax_amount, total_amount, paid_amount_snapshot, balance_amount_snapshot,
          snapshot_as_of, source_authority, source_values, created_by,
          created_at, updated_at
        ) VALUES (?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, 2021,
          NULL, '', ?, ?, '', 1, 'paid', '', 'DOP', '', '', '', ?, 0, ?, 0,
          ?, ?, ?, 0, '2021-12-31', ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          businessId,
          documentId,
          batchId,
          row.invoiceNumber,
          row.invoiceNumberNormalized,
          row.issueDate,
          row.issueDate,
          row.ncf,
          row.normalizedNcf,
          row.subtotal,
          row.subtotal,
          row.tax,
          row.total,
          row.paid,
          row.authority === "documento_emitido" ? "issued_document" : "manual_resolution",
          invoiceSourceValues(row, input.parsed.workbookHash),
          input.actorEmail,
          now,
          now,
        ],
      ),
      statement(
        `INSERT INTO document_links (
          document_id, entity_type, entity_id, purpose, created_by, created_at
        ) VALUES (?, 'invoice', ?, 'source', ?, ?)`,
        [documentId, invoiceId, input.actorEmail, now],
      ),
      statement(
        `INSERT INTO search_documents (
          entity_type, entity_id, title, subtitle, search_text, owner_email, updated_at
        ) VALUES ('invoice', ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          row.invoiceNumber,
          row.businessName,
          `${row.invoiceNumber} ${row.businessName} ${row.rnc} ${row.ncf}`,
          input.actorEmail,
          now,
        ],
      ),
    );
  }
  statements.push(
    statement(
      `INSERT INTO audit_log (
        actor_email, action, entity_type, entity_id, detail, created_at
      ) VALUES (?, 'replace_invoices_2021', 'import_batch', ?, ?, ?)`,
      [
        input.actorEmail,
        batchId,
        JSON.stringify({
          workbookHash: input.parsed.workbookHash,
          invoices: invoiceReplacementCount,
          businessesCreated: fresh.preview.companies.new.length,
          removedLegacyInvoices: fresh.preview.purge.legacyInvoices.length,
          removedBatches: fresh.preview.purge.batches.length,
          removedFiles: fresh.preview.purge.files.length,
          irreversible: true,
        }),
        now,
      ],
    ),
  );

  try {
    await getD1().batch(statements);
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    throw new Error(
      `La transacción fue revertida sin escrituras parciales: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const failedStorageDeletes = await deleteStorageObjects(
    fresh.targetStorageKeys.filter((key) => key !== objectKey),
  );
  const [finalCounts, preservedAfter, remainingOldImports] = await Promise.all([
    getD1()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM invoices WHERE archived_at IS NULL) AS invoices,
          (SELECT COUNT(DISTINCT ncf_normalized) FROM invoices WHERE archived_at IS NULL) AS identities,
          (SELECT COUNT(*) FROM invoice_lines) AS lines,
          (SELECT COUNT(*) FROM business_records WHERE module = 'facturas') AS legacy`,
      )
      .first<Record<string, number>>(),
    preservedQuotationCounts(),
    loadTargetImports(input.parsed.sourceHashes),
  ]);
  const final = {
    invoices: Number(finalCounts?.invoices ?? 0),
    fiscalIdentities: Number(finalCounts?.identities ?? 0),
    invoiceLines: Number(finalCounts?.lines ?? 0),
    legacyInvoices: Number(finalCounts?.legacy ?? 0),
  };
  const quotationUnchanged = stableJson(fresh.preview.preserved) === stableJson(preservedAfter);
  if (
    final.invoices !== invoiceReplacementCount ||
    final.fiscalIdentities !== invoiceReplacementCount ||
    final.invoiceLines !== 0 ||
    final.legacyInvoices !== 0 ||
    remainingOldImports.batches.length !== 0 ||
    failedStorageDeletes.length !== 0 ||
    !quotationUnchanged
  ) {
    throw new Error(
      "La reconciliación posterior detectó una diferencia. No repitas la operación; revisa el lote administrativo creado.",
    );
  }
  return {
    ok: true,
    idempotent: false,
    batchId,
    finalCount: final.invoices,
    fiscalIdentities: final.fiscalIdentities,
    invoiceLines: final.invoiceLines,
    companiesMatched: fresh.preview.companies.matchedInvoices,
    companiesCreated: fresh.preview.companies.new.length,
    removed: {
      legacyInvoices: fresh.preview.purge.legacyInvoices.length,
      batches: fresh.preview.purge.batches.length,
      files: fresh.preview.purge.files.length,
      documents: fresh.preview.purge.documents,
      storageObjects: fresh.preview.purge.storageObjects,
    },
    quotationsPreserved: quotationUnchanged,
  };
}

export class InvoiceReplacementConflict extends Error {
  status = 409;
  preview?: InvoiceReplacementPreview;

  constructor(message: string, preview?: InvoiceReplacementPreview) {
    super(message);
    this.name = "InvoiceReplacementConflict";
    this.preview = preview;
  }
}
