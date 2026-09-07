import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import {
  importMaxSize,
  isMultipartFile,
  sha256Hex,
} from "../../../../lib/import-service";
import {
  analyzeInvoiceExtraction,
  decideInvoiceMatch,
  invoiceImportEntityId,
  normalizedExtension,
  parseSourceFile,
  refreshInvoiceIdentityFingerprint,
  type InvoiceImportPreview,
  type InvoiceSourceManifestEntry,
} from "../../../../lib/importers";

type FilesBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

type PreparedFile = {
  file: File;
  bytes: ArrayBuffer;
  hash: string;
  documentId: string;
  importFileId: string;
  analysis: ReturnType<typeof analyzeInvoiceExtraction>;
  extractionJson: string;
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento privado no está disponible.");
  return bucket;
}

function isInvoiceSpreadsheetExtension(extension: string) {
  return extension === ".xlsx" || extension === ".xlsm" || extension === ".xlsb";
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ write: true });
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  // Some edge multipart adapters retain entries but do not preserve the
  // repeated field lookup. Collect file-like values regardless of field name.
  const suppliedFiles = [...form.values()].filter(isMultipartFile);
  const ignoredFiles = suppliedFiles
    .filter((file) => normalizedExtension(file.name) === ".pdf")
    .map((file) => file.name);
  const files = suppliedFiles.filter((file) =>
    isInvoiceSpreadsheetExtension(normalizedExtension(file.name)),
  );
  if (!files.length || files.length > 10) {
    console.warn("[invoice-dry-run] no permitted spreadsheet files", {
      contentType: request.headers.get("content-type"),
      entryCount: [...form.entries()].length,
      fieldNames: [...form.keys()],
      extensions: suppliedFiles.map((file) => normalizedExtension(file.name)),
    });
    return Response.json(
      { error: "Selecciona entre 1 y 10 archivos por simulación." },
      { status: 400 },
    );
  }
  for (const file of suppliedFiles) {
    const extension = normalizedExtension(file.name);
    if (extension === ".pdf") continue;
    if (
      !isInvoiceSpreadsheetExtension(extension) ||
      file.size <= 0 ||
      file.size > importMaxSize
    ) {
      return Response.json(
        { error: `${file.name}: formato o tamaño no permitido.` },
        { status: 400 },
      );
    }
  }

  const prepared: PreparedFile[] = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const documentId = crypto.randomUUID();
    const importFileId = crypto.randomUUID();
    const extraction = await parseSourceFile(file.name, bytes);
    prepared.push({
      file,
      bytes,
      hash,
      documentId,
      importFileId,
      analysis: analyzeInvoiceExtraction(file.name, documentId, extraction),
      extractionJson: JSON.stringify(extraction),
    });
  }
  prepared.sort(
    (left, right) =>
      left.hash.localeCompare(right.hash) ||
      left.file.name.localeCompare(right.file.name),
  );
  const configVersion = "invoice-import-v1";
  const combinedHash = await sha256Hex(
    new TextEncoder().encode(
      `${configVersion}|${prepared
        .map((item) => item.hash)
        .sort()
        .join("|")}`,
    ).buffer,
  );
  const existing = await getD1()
    .prepare(
      `SELECT id, summary_json FROM import_batches
       WHERE source_hash = ? AND dry_run = 1 AND source = 'invoice_import'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(combinedHash)
    .first<{ id: string; summary_json: string }>();
  if (existing) {
    return Response.json({
      reused: true,
      preview: JSON.parse(existing.summary_json) as InvoiceImportPreview,
    });
  }

  const businessRows =
    (
      await getD1()
        .prepare(
          `SELECT id, normalized_rnc AS rnc_normalized FROM businesses
           WHERE archived_at IS NULL AND rnc_normalized <> ''`,
        )
        .all<{ id: string; rnc_normalized: string }>()
    ).results ?? [];
  const businessByRnc = new Map(
    businessRows.map((row) => [row.rnc_normalized, row.id]),
  );
  const invoiceCandidates =
    (
      await getD1()
        .prepare(
          `SELECT id, business_id AS businessId,
             invoice_number_normalized AS invoiceNumberNormalized,
             issue_year AS issueYear, ncf_normalized AS ncfNormalized,
             document_version AS versionNumber, status
           FROM invoices WHERE archived_at IS NULL`,
        )
        .all<{
          id: string;
          businessId: string;
          invoiceNumberNormalized: string;
          issueYear: number | null;
          ncfNormalized: string;
          versionNumber: number;
          status: string;
        }>()
    ).results ?? [];
  for (const item of prepared) {
    item.analysis.rows.forEach((row, index) => {
      const rnc = normalizeIdentifier(row.normalizedValues.rnc);
      const businessId = businessByRnc.get(rnc);
      if (businessId) row.normalizedValues.business_id = businessId;
      refreshInvoiceIdentityFingerprint(row);
      item.analysis.decisions[index] = decideInvoiceMatch(
        row,
        invoiceCandidates,
      );
      refreshInvoiceIdentityFingerprint(row);
      if (item.analysis.decisions[index].decision === "link") {
        row.normalizedValues.matched_entity_id =
          item.analysis.decisions[index].targetEntityId;
        row.normalizedValues.matched_entity_type =
          item.analysis.decisions[index].targetEntityType;
      }
      if (
        ["new_version", "cancelled_replaced"].includes(
          item.analysis.decisions[index].decision,
        )
      ) {
        row.normalizedValues.related_invoice_id =
          item.analysis.decisions[index].targetEntityId;
        row.normalizedValues.relationship_decision =
          item.analysis.decisions[index].decision;
      }
    });
  }
  const identityGroups = new Map<
    string,
    Array<{
      item: PreparedFile;
      index: number;
      row: PreparedFile["analysis"]["rows"][number];
    }>
  >();
  for (const item of prepared) {
    item.analysis.rows.forEach((row, index) => {
      const group = identityGroups.get(row.identityFingerprint) ?? [];
      group.push({ item, index, row });
      identityGroups.set(row.identityFingerprint, group);
    });
  }
  for (const group of identityGroups.values()) {
    if (group.length < 2) continue;
    const authorityRank = (value: unknown) =>
      value === "issued_document" ? 3 : value === "payment_evidence" ? 2 : 1;
    group.sort(
      (left, right) =>
        authorityRank(right.row.normalizedValues.source_authority) -
        authorityRank(left.row.normalizedValues.source_authority),
    );
    const winner = group[0];
    const winnerDecision = winner.item.analysis.decisions[winner.index];
    if (!["create", "link"].includes(winnerDecision.decision)) continue;
    const entityType =
      winnerDecision.targetEntityType === "credit_note"
        ? "credit_note"
        : winnerDecision.targetEntityType === "payment"
          ? "payment"
          : "invoice";
    const targetId =
      winnerDecision.targetEntityId ??
      invoiceImportEntityId(entityType, winner.row.identityFingerprint);
    group.slice(1).forEach(({ item, index, row }) => {
      const winnerTotal = Number(winner.row.normalizedValues.total_amount);
      const candidateTotal = Number(row.normalizedValues.total_amount);
      if (
        Number.isFinite(winnerTotal) &&
        Number.isFinite(candidateTotal) &&
        Math.abs(winnerTotal - candidateTotal) > 0.02
      ) {
        item.analysis.decisions[index] = {
          decision: "manual_review",
          targetEntityType: entityType,
          targetEntityId: targetId,
          confidence: "manual",
          rule: "issued_document_matrix_total_conflict",
          evidence: [winner.row.identityFingerprint, row.identityFingerprint],
        };
        item.analysis.issues.push({
          type: "document_matrix_conflict",
          severity: "warning",
          sourceLocation: item.file.name,
          title:
            "El total difiere del documento emitido; prevalece el documento y la matriz requiere revisión.",
        });
        return;
      }
      item.analysis.decisions[index] = {
        decision: "link",
        targetEntityType: entityType,
        targetEntityId: targetId,
        confidence: "exact_unique",
        rule: "paired_representation_exact_identity",
        evidence: [winner.row.identityFingerprint, row.identityFingerprint],
      };
      row.normalizedValues.matched_entity_id = targetId;
      row.normalizedValues.matched_entity_type = entityType;
    });
  }
  const stagedInvoiceTargets = prepared.flatMap((item) =>
    item.analysis.rows.flatMap((row, index) => {
      if (row.documentKind !== "invoice") return [];
      const decision = item.analysis.decisions[index];
      if (!["create", "link"].includes(decision.decision)) return [];
      return [
        {
          id:
            decision.targetEntityId ??
            invoiceImportEntityId("invoice", row.identityFingerprint),
          businessId: String(row.normalizedValues.business_id ?? ""),
          invoiceNumberNormalized: normalizeIdentifier(
            row.normalizedValues.invoice_number,
          ),
        },
      ];
    }),
  );
  for (const item of prepared) {
    item.analysis.rows.forEach((row) => {
      if (row.documentKind !== "credit_note") return;
      const businessId = String(row.normalizedValues.business_id ?? "");
      const invoiceNumber = normalizeIdentifier(
        row.normalizedValues.affected_invoice_number,
      );
      if (!invoiceNumber) return;
      const targets = [
        ...invoiceCandidates.map((candidate) => ({
          id: candidate.id,
          businessId: candidate.businessId,
          invoiceNumberNormalized: candidate.invoiceNumberNormalized,
        })),
        ...stagedInvoiceTargets,
      ].filter(
        (candidate) =>
          candidate.businessId === businessId &&
          candidate.invoiceNumberNormalized === invoiceNumber,
      );
      const uniqueTargets = [
        ...new Map(targets.map((target) => [target.id, target])).values(),
      ];
      if (uniqueTargets.length === 1) {
        row.normalizedValues.credit_application_invoice_id =
          uniqueTargets[0].id;
        row.normalizedValues.credit_application_amount =
          row.normalizedValues.total_amount;
      } else {
        item.analysis.issues.push({
          type: "orphan_credit_note",
          severity: "warning",
          sourceLocation: item.file.name,
          title:
            uniqueTargets.length > 1
              ? "La factura afectada por la nota no es única."
              : "La factura afectada por la nota no fue localizada.",
        });
      }
    });
  }
  for (const item of prepared) {
    item.analysis.rows.forEach((row, index) => {
      if (
        !["receipt", "payment_evidence"].includes(row.documentKind) ||
        item.analysis.decisions[index].decision !== "create"
      )
        return;
      const businessId = String(row.normalizedValues.business_id ?? "");
      const invoiceNumber = normalizeIdentifier(
        row.normalizedValues.invoice_number,
      );
      if (!invoiceNumber) return;
      const targets = [
        ...invoiceCandidates.map((candidate) => ({
          id: candidate.id,
          businessId: candidate.businessId,
          invoiceNumberNormalized: candidate.invoiceNumberNormalized,
        })),
        ...stagedInvoiceTargets,
      ].filter(
        (candidate) =>
          candidate.businessId === businessId &&
          candidate.invoiceNumberNormalized === invoiceNumber,
      );
      const uniqueTargets = [...new Map(targets.map((target) => [target.id, target])).values()];
      if (uniqueTargets.length === 1) {
        const amount = Number(
          row.normalizedValues.payment_amount ??
            row.normalizedValues.total_amount,
        );
        row.normalizedValues.allocation_invoice_id = uniqueTargets[0].id;
        row.normalizedValues.allocation_amount = amount;
        item.analysis.allocations.push({
          paymentStagingId: row.identityFingerprint,
          invoiceStagingId: uniqueTargets[0].id,
          amount,
          currency: String(row.normalizedValues.currency ?? "DOP"),
          allocationDate:
            String(row.normalizedValues.payment_date ?? "") || null,
          evidenceDocumentId: item.documentId,
          decision: Number.isFinite(amount) && amount > 0 ? "ready" : "blocked",
        });
      } else {
        item.analysis.issues.push({
          type: "payment_evidence_missing",
          severity: "warning",
          sourceLocation: item.file.name,
          title:
            uniqueTargets.length > 1
              ? "La factura indicada en el pago no es única."
              : "La factura indicada en el pago no fue localizada.",
        });
      }
    });
  }

  const duplicateHashes = new Set<string>();
  const seen = new Set<string>();
  for (const item of prepared) {
    if (seen.has(item.hash)) duplicateHashes.add(item.hash);
    seen.add(item.hash);
    const prior = await getD1()
      .prepare(
        "SELECT id FROM import_files WHERE sha256 = ? AND status <> 'failed' LIMIT 1",
      )
      .bind(item.hash)
      .first();
    if (prior) duplicateHashes.add(item.hash);
  }
  for (const item of prepared) {
    if (duplicateHashes.has(item.hash)) {
      item.analysis.issues.push({
        type: "duplicate_file",
        severity: "blocking",
        sourceLocation: item.file.name,
        title: "El archivo coincide exactamente por SHA-256 con otro original.",
      });
    }
  }
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const legacyBaseline = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM business_records")
    .first<{ count: number }>();
  const manifest: InvoiceSourceManifestEntry[] = prepared.map((item) => ({
    relativePath: item.file.name,
    filename: item.file.name,
    extension: normalizedExtension(item.file.name),
    sizeBytes: item.file.size,
    sourceModifiedAt: item.file.lastModified
      ? new Date(item.file.lastModified).toISOString()
      : null,
    sha256: item.hash,
    downloadStatus: "downloaded",
    deltaStatus: "added",
    parseStatus: item.analysis.issues.some((issue) => issue.severity === "blocking")
      ? "partial"
      : "parsed",
    parserName: "hidaca-invoice",
    parserVersion: "1.0.0",
    warnings: item.analysis.issues.map((issue) => issue.title),
  }));
  const decisions = prepared.flatMap((item) => item.analysis.decisions);
  const allRows = prepared.flatMap((item) => item.analysis.rows);
  const allIssues = prepared.flatMap((item) => item.analysis.issues);
  const preview: InvoiceImportPreview = {
    batchId,
    files: manifest,
    ignoredFiles,
    invoices: allRows,
    decisions,
    allocations: prepared.flatMap((item) => item.analysis.allocations),
    issues: allIssues,
    reconciliation: {
      expectedFiles: prepared.length,
      parsedFiles: manifest.filter((item) => item.parseStatus === "parsed").length,
      partialFiles: manifest.filter((item) => item.parseStatus === "partial").length,
      unreadableFiles: 0,
      invoiceCount: allRows.length,
      duplicateCount:
        decisions.filter((item) => item.decision === "duplicate").length +
        duplicateHashes.size,
      reviewCount: decisions.filter((item) => item.decision === "manual_review").length,
      createdCount: decisions.filter((item) => item.decision === "create").length,
      linkedCount: decisions.filter((item) => item.decision === "link").length,
      totals: {
        invoice_amount: sum(allRows, "total_amount"),
        balance_snapshot: sum(allRows, "balance_amount_snapshot"),
        legacy_business_records: Number(legacyBaseline?.count ?? 0),
      },
      openIssuesByType: issueCounts(allIssues),
      balanced: allIssues.every(
        (issue) => !["blocking", "error"].includes(issue.severity),
      ),
    },
  };
  if (allRows.length > 2_000) {
    return Response.json(
      { error: "La simulación excede 2,000 filas; divide el lote." },
      { status: 413 },
    );
  }

  const bucket = filesBucket();
  const storedKeys: string[] = [];
  try {
    for (const item of prepared) {
      const sourceKey = `invoice-imports/${batchId}/${item.importFileId}/source`;
      const extractionKey = `invoice-imports/${batchId}/${item.importFileId}/extraction.json`;
      await bucket.put(sourceKey, item.bytes, {
        httpMetadata: {
          contentType: item.file.type || "application/octet-stream",
        },
      });
      const encoded = new TextEncoder().encode(item.extractionJson);
      await bucket.put(
        extractionKey,
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        ),
        { httpMetadata: { contentType: "application/json" } },
      );
      storedKeys.push(sourceKey, extractionKey);
    }

    const statements = [
      getD1()
        .prepare(
          `INSERT INTO import_batches (
             id, name, status, source, source_hash, dry_run, file_count,
             total_rows, successful_count, matched_count, duplicate_count,
             review_count, failed_count, summary_json, created_by, created_at
           ) VALUES (?, ?, 'review_required', 'invoice_import', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          batchId,
          String(form.get("batchName") || `Simulación de facturas ${now.slice(0, 10)}`).slice(0, 180),
          combinedHash,
          prepared.length,
          allRows.length,
          decisions.filter((item) => item.decision === "create").length,
          decisions.filter((item) => item.decision === "link").length,
          preview.reconciliation.duplicateCount,
          preview.reconciliation.reviewCount,
          preview.reconciliation.partialFiles,
          JSON.stringify(preview),
          auth.user.email,
          now,
        ),
    ];
    for (const item of prepared) {
      const manifestItem = manifest.find((entry) => entry.sha256 === item.hash)!;
      const sourceKey = `invoice-imports/${batchId}/${item.importFileId}/source`;
      const extractionKey = `invoice-imports/${batchId}/${item.importFileId}/extraction.json`;
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO documents (
               id, record_id, name, object_key, content_type, size, extension,
               sha256, source_path, document_role, parser_name, parsing_status,
               imported_at, created_by, created_at
             ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'source',
                       'hidaca-invoice', ?, ?, ?, ?)`,
          )
          .bind(
            item.documentId,
            item.file.name.slice(0, 180),
            sourceKey,
            item.file.type || "application/octet-stream",
            item.file.size,
            normalizedExtension(item.file.name),
            item.hash,
            item.file.name,
            manifestItem.parseStatus === "parsed" ? "parsed" : "partial",
            now,
            auth.user.email,
            now,
          ),
        getD1()
          .prepare(
            `INSERT INTO import_files (
               id, batch_id, document_id, filename, extension, source_path,
               sha256, parser_name, parser_version, document_kind,
               source_modified_at, download_status, delta_status, status,
               extracted_object_key, normalized_preview, imported_by, imported_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'hidaca-invoice', '1.0.0', ?,
                       ?, 'downloaded', 'added', ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.importFileId,
            batchId,
            item.documentId,
            item.file.name.slice(0, 180),
            normalizedExtension(item.file.name),
            item.file.name,
            item.hash,
            item.analysis.documentKind,
            manifestItem.sourceModifiedAt,
            duplicateHashes.has(item.hash)
              ? "duplicate"
              : manifestItem.parseStatus === "parsed"
                ? "parsed"
                : "review_required",
            extractionKey,
            JSON.stringify({
              documentKind: item.analysis.documentKind,
              rowCount: item.analysis.rows.length,
            }),
            auth.user.email,
            now,
          ),
      );
      item.analysis.rows.forEach((row, index) => {
        const rowId = crypto.randomUUID();
        const decision = item.analysis.decisions[index];
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO import_rows (
                 id, import_file_id, worksheet_name, source_row_number,
                 row_fingerprint, identity_fingerprint, document_kind,
                 raw_values, normalized_values, outcome, match_confidence,
                 warnings, errors, source_filename, source_document_uri,
                 source_origin, business_id, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              rowId,
              item.importFileId,
              String(row.sourceReferences[0]?.sheet ?? ""),
              Number(row.sourceReferences[0]?.row ?? index + 1),
              `${item.hash}:${index + 1}`,
              row.identityFingerprint,
              row.documentKind,
              JSON.stringify(row.rawValues),
              JSON.stringify(row.normalizedValues),
              duplicateHashes.has(item.hash)
                ? "duplicate_candidate"
                : decision.decision === "create"
                ? "ready"
                : decision.decision === "link"
                  ? "matched"
                  : decision.decision === "duplicate"
                    ? "duplicate_candidate"
                    : "manual_review",
              decision.confidence === "exact_unique"
                ? "high"
                : decision.confidence === "candidate"
                  ? "medium"
                  : "manual_review",
              item.file.name,
              `r2://${sourceKey}`,
              "invoice_import",
              String(row.normalizedValues.business_id ?? "") || null,
              now,
              now,
            ),
          getD1()
            .prepare(
              `INSERT INTO source_references (
                 id, import_row_id, document_id, original_filename,
                 original_uri, uri_scheme, availability, source_origin,
                 file_hash, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, 'other', 'available',
                         'invoice_import', ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              rowId,
              item.documentId,
              item.file.name,
              `r2://${sourceKey}`,
              item.hash,
              now,
              now,
            ),
        );
        for (const reference of row.sourceReferences) {
          statements.push(
            getD1()
              .prepare(
                `INSERT INTO source_field_values (
                   id, import_file_id, import_row_id, source_sheet,
                   source_page, source_row_number, source_cell, source_label,
                   raw_value, display_value, source_formula, normalized_value,
                   canonical_entity, canonical_field, transformation,
                   confidence, value_state, mapping_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                           'high', ?, 'mapped')`,
              )
              .bind(
                crypto.randomUUID(),
                item.importFileId,
                rowId,
                reference.sheet ?? "",
                reference.page ?? null,
                reference.row ?? null,
                reference.cell ?? "",
                reference.field ?? "",
                reference.rawValue,
                reference.displayValue,
                reference.formula ?? "",
                String(
                  reference.field
                    ? row.normalizedValues[reference.field] ?? ""
                    : reference.displayValue,
                ),
                row.documentKind === "credit_note"
                  ? "credit_note"
                  : row.documentKind === "receipt" ||
                      row.documentKind === "payment_evidence"
                    ? "payment"
                    : "invoice",
                reference.field ?? "",
                "label_alias_normalization",
                reference.displayValue.trim() ? "value" : "blank",
              ),
          );
        }
      });
      for (const issue of item.analysis.issues) {
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO import_issues (
                 id, import_file_id, type, severity, status, title,
                 detail, source_location, created_at
               ) VALUES (?, ?, ?, ?, 'open', ?, '', ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              item.importFileId,
              issue.type,
              issue.severity,
              issue.title,
              issue.sourceLocation,
              now,
            ),
        );
      }
    }
    await getD1().batch(statements);
  } catch (error) {
    await Promise.all(storedKeys.map((key) => bucket.delete(key)));
    return Response.json(
      {
        error: `La simulación no pudo guardarse: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
  await writeAudit(
    auth.user.email,
    "invoice_dry_run",
    "import_batch",
    batchId,
    `${prepared.length} archivos; ${allRows.length} filas`,
  );
  return Response.json({ reused: false, preview }, { status: 201 });
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function sum(
  rows: Array<{ normalizedValues: Record<string, unknown> }>,
  field: string,
) {
  const values = rows
    .map((row) => Number(row.normalizedValues[field]))
    .filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
function issueCounts(issues: Array<{ type: string }>) {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.type] = (counts[issue.type] ?? 0) + 1;
    return counts;
  }, {});
}
