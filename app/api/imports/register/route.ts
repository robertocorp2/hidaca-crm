import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import {
  documents,
  importBatches,
  importBatchSources,
  importFiles,
  importIssues,
  importRows,
  sourceReferences,
} from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  importMaxSize,
  inChunks,
  safeImportSummary,
  sha256Hex,
} from "../../../lib/import-service";
import {
  parseCombinedRegister,
  parseSourceFile,
  sourceUriScheme,
} from "../../../lib/importers";
import { analyzeRegisterImport } from "../../../lib/register-import";

type FilesBucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

function rootErrorMessage(error: unknown) {
  let current = error;
  let message = error instanceof Error ? error.message : String(error);
  const visited = new Set<unknown>();
  while (
    current &&
    typeof current === "object" &&
    "cause" in current &&
    !visited.has(current)
  ) {
    visited.add(current);
    current = (current as { cause?: unknown }).cause;
    if (current instanceof Error && current.message) message = current.message;
  }
  return message.slice(0, 4_000);
}

async function dryRunProjection(importFileId: string) {
  const result = await getD1()
    .prepare(
      `WITH eligible AS (
         SELECT row_fingerprint,
           trim(coalesce(json_extract(normalized_values, '$.normalizedCustomerName'), '')) AS customer,
           trim(coalesce(json_extract(normalized_values, '$.normalizedRnc'), '')) AS rnc,
           lower(trim(coalesce(json_extract(normalized_values, '$.contactName'), ''))) AS contact,
           trim(coalesce(json_extract(normalized_values, '$.normalizedEmail'), '')) AS email,
           trim(coalesce(json_extract(normalized_values, '$.normalizedPhone'), '')) AS phone,
           trim(coalesce(json_extract(normalized_values, '$.normalizedMobilePhone'), '')) AS mobile,
           trim(coalesce(json_extract(normalized_values, '$.projectAddress'), '')) AS project_address,
           trim(coalesce(json_extract(normalized_values, '$.quotationFamilyKey'), '')) AS family_key,
           json_extract(normalized_values, '$.year') AS quotation_year
         FROM import_rows
         WHERE import_file_id = ? AND outcome = 'ready'
       ),
       business_keys AS (
         SELECT DISTINCT customer, rnc, email, phone, mobile
         FROM eligible WHERE customer <> ''
       ),
       contact_keys AS (
         SELECT DISTINCT customer, rnc, contact, email, phone, mobile
         FROM eligible WHERE customer <> '' AND contact <> ''
       ),
       project_keys AS (
         SELECT DISTINCT customer, rnc, project_address
         FROM eligible WHERE customer <> '' AND project_address <> ''
       ),
       quotation_keys AS (
         SELECT DISTINCT customer, rnc, family_key, quotation_year
         FROM eligible WHERE customer <> '' AND family_key <> ''
       )
       SELECT
         (SELECT count(*) FROM eligible) AS eligibleRows,
         (SELECT count(*) FROM business_keys) AS inferredBusinesses,
         (SELECT count(*) FROM business_keys k WHERE EXISTS (
           SELECT 1 FROM businesses b
           WHERE b.archived_at IS NULL AND (
             (k.rnc <> '' AND b.normalized_rnc = k.rnc) OR
             (b.normalized_name = k.customer AND (
               (k.email <> '' AND lower(b.email) = k.email) OR
               (k.phone <> '' AND
                replace(replace(replace(replace(replace(b.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = k.phone) OR
               (k.mobile <> '' AND
                replace(replace(replace(replace(replace(b.mobile_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = k.mobile)
             ))
           )
         )) AS existingBusinessMatches,
         (SELECT count(*) FROM contact_keys) AS inferredContacts,
         (SELECT count(*) FROM contact_keys k WHERE EXISTS (
           SELECT 1 FROM contacts c JOIN businesses b ON b.id = c.business_id
           WHERE c.archived_at IS NULL AND b.archived_at IS NULL
             AND b.normalized_name = k.customer
             AND (k.rnc = '' OR b.normalized_rnc = '' OR b.normalized_rnc = k.rnc)
             AND (
               c.normalized_name = k.contact OR
               (k.email <> '' AND c.normalized_email = k.email) OR
               (k.phone <> '' AND c.normalized_phone = k.phone) OR
               (k.mobile <> '' AND c.normalized_mobile_phone = k.mobile)
             )
         )) AS existingContactMatches,
         (SELECT count(*) FROM project_keys) AS inferredProjects,
         (SELECT count(*) FROM project_keys k WHERE EXISTS (
           SELECT 1 FROM projects p
           JOIN businesses b ON b.id = p.business_id
           JOIN addresses a ON a.project_id = p.id AND a.type = 'project'
           WHERE p.archived_at IS NULL AND b.archived_at IS NULL
             AND b.normalized_name = k.customer
             AND (k.rnc = '' OR b.normalized_rnc = '' OR b.normalized_rnc = k.rnc)
             AND a.line1 = k.project_address
         )) AS existingProjectMatches,
         (SELECT count(*) FROM quotation_keys) AS inferredQuotations,
         (SELECT count(*) FROM quotation_keys k WHERE EXISTS (
           SELECT 1 FROM quotations q JOIN businesses b ON b.id = q.business_id
           WHERE q.archived_at IS NULL AND b.archived_at IS NULL
             AND b.normalized_name = k.customer
             AND (k.rnc = '' OR b.normalized_rnc = '' OR b.normalized_rnc = k.rnc)
             AND q.family_key = k.family_key
             AND (q.quotation_year IS NULL OR k.quotation_year IS NULL
                  OR q.quotation_year = k.quotation_year)
         )) AS existingQuotationMatches,
         (SELECT count(*) FROM eligible e WHERE EXISTS (
           SELECT 1 FROM quotation_revisions r
           WHERE r.identity_key = 'register:' || substr(e.row_fingerprint, 1, 32)
         )) AS existingRevisionMatches`,
    )
    .bind(importFileId)
    .first<Record<string, number>>();
  const value = (key: string) => Number(result?.[key] ?? 0);
  return {
    eligibleRows: value("eligibleRows"),
    inferredBusinesses: value("inferredBusinesses"),
    existingBusinessMatches: value("existingBusinessMatches"),
    newBusinesses: Math.max(
      0,
      value("inferredBusinesses") - value("existingBusinessMatches"),
    ),
    inferredContacts: value("inferredContacts"),
    existingContactMatches: value("existingContactMatches"),
    newContacts: Math.max(
      0,
      value("inferredContacts") - value("existingContactMatches"),
    ),
    inferredProjects: value("inferredProjects"),
    existingProjectMatches: value("existingProjectMatches"),
    newProjects: Math.max(
      0,
      value("inferredProjects") - value("existingProjectMatches"),
    ),
    inferredQuotations: value("inferredQuotations"),
    existingQuotationMatches: value("existingQuotationMatches"),
    newQuotations: Math.max(
      0,
      value("inferredQuotations") - value("existingQuotationMatches"),
    ),
    existingRevisionMatches: value("existingRevisionMatches"),
    newRevisions: Math.max(
      0,
      value("eligibleRows") - value("existingRevisionMatches"),
    ),
  };
}

function issueDrafts(
  importFileId: string,
  rows: Array<{
    id: string;
    sourceRowNumber: number;
    warnings: string[];
    errors: string[];
    duplicateOfRowNumber: number | null;
  }>,
  now: string,
) {
  const issues: Array<typeof importIssues.$inferInsert> = [];
  const add = (
    row: (typeof rows)[number],
    type: typeof importIssues.$inferInsert.type,
    severity: typeof importIssues.$inferInsert.severity,
    title: string,
    detail: string,
  ) => {
    issues.push({
      id: crypto.randomUUID(),
      importFileId,
      importRowId: row.id,
      type,
      severity,
      title,
      detail,
      sourceLocation: `Registro combinado!${row.sourceRowNumber}`,
      createdAt: now,
    });
  };
  for (const row of rows) {
    if (row.errors.includes("missing_quotation_number")) {
      add(
        row,
        "missing_required",
        "blocking",
        "Falta el número de cotización.",
        "La fila se conservó, pero no se aceptará automáticamente.",
      );
    }
    if (row.errors.includes("missing_customer")) {
      add(
        row,
        "missing_required",
        "blocking",
        "Falta el cliente.",
        "La fila se conservó, pero no se aceptará automáticamente.",
      );
    }
    if (row.warnings.includes("suspicious_date")) {
      add(
        row,
        "suspicious_date",
        "warning",
        "La fecha requiere verificación.",
        "La fecha está fuera del período razonable o es posterior a la carga.",
      );
    }
    if (row.warnings.includes("month_mismatch")) {
      add(
        row,
        "month_mismatch",
        "warning",
        "El mes no coincide con la fecha.",
        "Se preservaron ambos valores sin reemplazar ninguno.",
      );
    }
    if (row.warnings.includes("duplicate_candidate")) {
      add(
        row,
        "duplicate_row",
        "warning",
        "Posible fila duplicada o revisión.",
        `Coincide en fecha, cotización y cliente con la fila ${row.duplicateOfRowNumber}.`,
      );
    }
    if (
      row.warnings.includes("multiple_contacts") ||
      row.warnings.includes("multiple_emails")
    ) {
      add(
        row,
        "low_confidence_match",
        "warning",
        "La fila contiene múltiples contactos o correos.",
        "Debe decidirse cómo separar y relacionar estos valores.",
      );
    }
  }
  return issues;
}

export async function GET() {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(importBatches)
    .where(eq(importBatches.source, "combined_register"))
    .orderBy(desc(importBatches.createdAt))
    .limit(50);
  return Response.json(
    {
      batches: rows.map((row) => ({
        ...row,
        summary: JSON.parse(row.summaryJson || "{}") as unknown,
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Selecciona el libro consolidado." },
      { status: 400 },
    );
  }
  if (
    !file.name.toLowerCase().endsWith(".xlsx") ||
    file.size === 0 ||
    file.size > importMaxSize
  ) {
    return Response.json(
      { error: "El registro consolidado debe ser un XLSX de máximo 32 MB." },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const db = getDb();
  const [existing] = await db
    .select()
    .from(importFiles)
    .where(eq(importFiles.sha256, hash))
    .orderBy(desc(importFiles.importedAt))
    .limit(1);
  if (existing?.templateType === "register" && existing.status !== "failed") {
    return Response.json(
      {
        import: safeImportSummary(existing),
        warning:
          "Este mismo libro ya está registrado; se reutilizó el lote existente.",
      },
      { status: 200 },
    );
  }

  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const importFileId = crypto.randomUUID();
  const objectKey = `imports/${importFileId}/source`;
  const extractedObjectKey = `imports/${importFileId}/register-analysis.json`;
  const bucket = filesBucket();
  await bucket.put(objectKey, bytes, {
    httpMetadata: {
      contentType:
        file.type ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });

  try {
    await getD1().batch([
      getD1()
        .prepare(
          `INSERT INTO import_batches (
             id, name, status, source, source_filename, source_hash, dry_run,
             file_count, created_by, created_at
           ) VALUES (?, ?, 'processing', 'combined_register', ?, ?, 1, 1, ?, ?)`,
        )
        .bind(
          batchId,
          String(form.get("batchName") || "Registro consolidado HIDACA").slice(
            0,
            180,
          ),
          file.name.slice(0, 180),
          hash,
          auth.user.email,
          now,
        ),
      getD1()
        .prepare(
          `INSERT INTO documents (
             id, record_id, name, object_key, content_type, size, extension,
             sha256, source_path, document_role, parser_name, parsing_status,
             imported_at, created_by, created_at
           ) VALUES (?, NULL, ?, ?, ?, ?, '.xlsx', ?, ?, 'source', '',
                     'pending', ?, ?, ?)`,
        )
        .bind(
          documentId,
          file.name.slice(0, 180),
          objectKey,
          file.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          file.size,
          hash,
          String(form.get("sourcePath") || "").slice(0, 1_000),
          now,
          auth.user.email,
          now,
        ),
      getD1()
        .prepare(
          `INSERT INTO import_files (
             id, batch_id, document_id, filename, extension, source_path,
             sha256, status, extracted_object_key, imported_by, imported_at
           ) VALUES (?, ?, ?, ?, '.xlsx', ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          importFileId,
          batchId,
          documentId,
          file.name.slice(0, 180),
          String(form.get("sourcePath") || "").slice(0, 1_000),
          hash,
          extractedObjectKey,
          auth.user.email,
          now,
        ),
    ]);

    const extraction = await parseSourceFile(file.name, bytes);
    const parsed = parseCombinedRegister(extraction);
    const analyzed = await analyzeRegisterImport(parsed);
    const extractedJson = JSON.stringify({
      worksheets: parsed.worksheets,
      sources: parsed.sources,
      metrics: parsed.metrics,
      unmappedHeaders: parsed.unmappedHeaders,
      summary: analyzed.summary,
    });
    const extractedBytes = new TextEncoder().encode(extractedJson);
    await bucket.put(
      extractedObjectKey,
      extractedBytes.buffer.slice(
        extractedBytes.byteOffset,
        extractedBytes.byteOffset + extractedBytes.byteLength,
      ),
      { httpMetadata: { contentType: "application/json" } },
    );

    const stagedRows = analyzed.rows.map((row) => ({
      id: crypto.randomUUID(),
      importFileId,
      worksheetName: row.worksheetName,
      sourceRowNumber: row.sourceRowNumber,
      rowFingerprint: row.rowFingerprint,
      rawValues: JSON.stringify(row.rawValues),
      normalizedValues: JSON.stringify(row.normalizedValues),
      outcome: row.outcome,
      matchConfidence: row.matchConfidence,
      warnings: row.warnings,
      errors: row.errors,
      sourceFilename: row.normalizedValues.sourceFilename,
      sourceDocumentUri: row.normalizedValues.sourceDocumentUri,
      sourceOrigin: row.normalizedValues.sourceOrigin,
      createdAt: now,
      updatedAt: now,
      duplicateOfRowNumber: row.duplicateOfRowNumber,
    }));
    const dbRows = stagedRows.map((stagedRow) => {
      const { duplicateOfRowNumber, warnings, errors, ...row } = stagedRow;
      void duplicateOfRowNumber;
      return {
        ...row,
        warnings: JSON.stringify(warnings),
        errors: JSON.stringify(errors),
      };
    });
    const references = stagedRows.map((row) => ({
      id: crypto.randomUUID(),
      importRowId: row.id,
      originalFilename: row.sourceFilename,
      originalUri: row.sourceDocumentUri,
      uriScheme: sourceUriScheme(row.sourceDocumentUri),
      availability:
        sourceUriScheme(row.sourceDocumentUri) === "https"
          ? ("available" as const)
          : row.sourceDocumentUri
            ? ("unresolved" as const)
            : ("missing" as const),
      sourceOrigin: row.sourceOrigin,
      createdAt: now,
      updatedAt: now,
    }));
    const issues = issueDrafts(importFileId, stagedRows, now);
    const batchSources = parsed.sources.map((source) => ({
      id: crypto.randomUUID(),
      batchId,
      originLabel: source.originLabel,
      sourceWorkbookName: source.sourceWorkbookName,
      expectedRows: source.expectedRows,
      expectedLinks: source.expectedLinks,
      discoveredRows: analyzed.rows.filter(
        (row) => row.normalizedValues.sourceOrigin === source.originLabel,
      ).length,
    }));

    await inChunks(dbRows, 75, async (chunk) => {
      const statements = chunk.map((row) => {
        const query = db.insert(importRows).values(row).toSQL();
        return getD1()
          .prepare(query.sql)
          .bind(...query.params);
      });
      if (statements.length) await getD1().batch(statements);
    });
    await inChunks(references, 75, async (chunk) => {
      const statements = chunk.map((row) => {
        const query = db.insert(sourceReferences).values(row).toSQL();
        return getD1()
          .prepare(query.sql)
          .bind(...query.params);
      });
      if (statements.length) await getD1().batch(statements);
    });
    await inChunks(issues, 75, async (chunk) => {
      const statements = chunk.map((row) => {
        const query = db.insert(importIssues).values(row).toSQL();
        return getD1()
          .prepare(query.sql)
          .bind(...query.params);
      });
      if (statements.length) await getD1().batch(statements);
    });
    if (batchSources.length) {
      await db.insert(importBatchSources).values(batchSources);
    }
    const projection = await dryRunProjection(importFileId);
    const dryRunSummary = { ...analyzed.summary, ...projection };

    await db
      .update(importFiles)
      .set({
        parserName: extraction.parserName,
        parserVersion: extraction.parserVersion,
        templateType: "register",
        status: "review_required",
        rawExtractedData: JSON.stringify({
          format: extraction.format,
          worksheets: parsed.worksheets,
          worksheetRanges: extraction.sheets.map((sheet) => ({
            name: sheet.name,
            range: sheet.range,
            cells: sheet.cells.length,
            merges: sheet.merges,
          })),
          formulas: parsed.formulas,
          formulaErrors: parsed.formulaErrors,
        }),
        normalizedPreview: JSON.stringify({ summary: dryRunSummary }),
        extractedSize: extractedBytes.byteLength,
      })
      .where(eq(importFiles.id, importFileId));
    await db
      .update(documents)
      .set({ parserName: extraction.parserName, parsingStatus: "parsed" })
      .where(eq(documents.id, documentId));
    await db
      .update(importBatches)
      .set({
        status: "review_required",
        totalRows: analyzed.summary.sourceRowsDiscovered,
        successfulCount: analyzed.summary.rowsReady,
        duplicateCount: analyzed.summary.duplicateCandidates,
        reviewCount: analyzed.summary.manualReviewRecords,
        failedCount: analyzed.summary.failedRows,
        unmappedFieldCount: analyzed.summary.unmappedFields,
        summaryJson: JSON.stringify(dryRunSummary),
        completedAt: new Date().toISOString(),
      })
      .where(eq(importBatches.id, batchId));
    await writeAudit(
      auth.user.email,
      "register_dry_run",
      "import_batch",
      batchId,
      `${file.name}: ${analyzed.summary.sourceRowsDiscovered} filas`,
    );

    const [stored] = await db
      .select()
      .from(importFiles)
      .where(eq(importFiles.id, importFileId))
      .limit(1);
    return Response.json(
      {
        import: safeImportSummary(stored),
        batchId,
        summary: dryRunSummary,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = rootErrorMessage(error);
    await db
      .update(importFiles)
      .set({ status: "failed", errorMessage: message.slice(0, 4_000) })
      .where(eq(importFiles.id, importFileId));
    await db
      .update(importBatches)
      .set({
        status: "failed",
        failedCount: 1,
        summaryJson: JSON.stringify({ error: message }),
        completedAt: new Date().toISOString(),
      })
      .where(eq(importBatches.id, batchId));
    await db
      .update(documents)
      .set({ parsingStatus: "failed" })
      .where(eq(documents.id, documentId));
    return Response.json(
      {
        error: message,
        batchId,
        warning: "El libro original quedó preservado para diagnóstico.",
      },
      { status: 422 },
    );
  }
}
