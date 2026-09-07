import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const databasePath = resolve(requiredArgument("database"));
const importFileId = requiredArgument("import-file");
const outputDirectory = resolve(requiredArgument("output"));
const database = new DatabaseSync(databasePath, { readOnly: true });

const scalar = (sql: string, ...bindings: SQLInputValue[]) =>
  Number(
    (
      database.prepare(sql).get(...bindings) as
        { value?: number | bigint } | undefined
    )?.value ?? 0,
  );

const batch = database
  .prepare(
    `SELECT b.id, b.name, b.status, b.source_filename AS sourceFilename,
      b.source_hash AS sourceHash, b.summary_json AS summaryJson,
      f.filename, f.sha256, f.status AS fileStatus, f.imported_at AS importedAt,
      f.accepted_at AS acceptedAt
     FROM import_files f
     JOIN import_batches b ON b.id = f.batch_id
     WHERE f.id = ?`,
  )
  .get(importFileId) as Record<string, unknown> | undefined;
if (!batch) throw new Error(`Import file not found: ${importFileId}`);

const outcomes = database
  .prepare(
    `SELECT outcome, count(*) AS count FROM import_rows
     WHERE import_file_id = ? GROUP BY outcome ORDER BY outcome`,
  )
  .all(importFileId) as Array<{ outcome: string; count: number }>;
const outcomeCounts = Object.fromEntries(
  outcomes.map((row) => [row.outcome, Number(row.count)]),
);
const sources = database
  .prepare(
    `SELECT s.origin_label AS origin, s.source_workbook_name AS sourceWorkbook,
      s.expected_rows AS expectedRows, s.expected_links AS expectedLinks,
      s.discovered_rows AS discoveredRows, s.imported_rows AS importedRows,
      s.matched_rows AS matchedRows, s.duplicate_rows AS duplicateRows,
      s.review_rows AS reviewRows, s.failed_rows AS failedRows
     FROM import_batch_sources s
     JOIN import_files f ON f.batch_id = s.batch_id
     WHERE f.id = ? ORDER BY s.origin_label`,
  )
  .all(importFileId);
const exceptions = database
  .prepare(
    `SELECT r.source_row_number AS sourceRowNumber,
      r.worksheet_name AS worksheetName, r.outcome,
      json_extract(r.normalized_values, '$.date') AS date,
      json_extract(r.normalized_values, '$.quotationNumber') AS quotationNumber,
      json_extract(r.normalized_values, '$.customerName') AS customer,
      json_extract(r.normalized_values, '$.rnc') AS rnc,
      r.source_filename AS sourceFilename, r.source_origin AS sourceOrigin,
      r.source_document_uri AS sourceDocumentUri, r.warnings, r.errors,
      group_concat(DISTINCT i.type) AS issueTypes,
      group_concat(DISTINCT i.title) AS issueTitles
     FROM import_rows r
     LEFT JOIN import_issues i ON i.import_row_id = r.id
     WHERE r.import_file_id = ?
       AND (
         r.outcome IN ('manual_review', 'duplicate_candidate', 'failed') OR
         r.warnings <> '[]' OR r.errors <> '[]'
       )
     GROUP BY r.id
     ORDER BY r.source_row_number`,
  )
  .all(importFileId) as Array<Record<string, unknown>>;

const rawFieldProblems = scalar(
  `SELECT count(*) AS value FROM import_rows
   WHERE import_file_id = ? AND (
     json_valid(raw_values) = 0 OR
     (SELECT count(*) FROM json_each(import_rows.raw_values)) <> 15
   )`,
  importFileId,
);
const unresolvedRows = scalar(
  `SELECT count(*) AS value FROM import_rows
   WHERE import_file_id = ?
     AND outcome NOT IN (
       'imported', 'matched', 'duplicate_candidate', 'manual_review',
       'failed', 'skipped'
     )`,
  importFileId,
);
const totalDiscrepancies = scalar(
  `SELECT count(*) AS value
   FROM quotation_financials f
   JOIN import_rows r ON r.revision_id = f.revision_id
   WHERE r.import_file_id = ? AND abs(coalesce(f.discrepancy_amount, 0)) > 0.005`,
  importFileId,
);
const report = {
  generatedAt: new Date().toISOString(),
  databasePath,
  importFileId,
  batch: {
    ...batch,
    summary: JSON.parse(String(batch.summaryJson || "{}")),
    summaryJson: undefined,
  },
  reconciliation: {
    workbookWorksheetsInspected: 2,
    sourceRowsDiscovered: scalar(
      "SELECT count(*) AS value FROM import_rows WHERE import_file_id = ?",
      importFileId,
    ),
    rowsImported: outcomeCounts.imported ?? 0,
    rowsMatched: outcomeCounts.matched ?? 0,
    newCustomersCreated: scalar(
      `SELECT count(*) AS value FROM businesses
       WHERE json_extract(source_metadata, '$.source') = 'combined_register'`,
    ),
    newContactsCreated: scalar(
      `SELECT count(*) AS value FROM contacts
       WHERE json_extract(source_metadata, '$.importRowId') IS NOT NULL`,
    ),
    newProjectsCreated: scalar(
      `SELECT count(*) AS value FROM projects
       WHERE json_extract(source_metadata, '$.importRowId') IS NOT NULL`,
    ),
    newQuotationsCreated: scalar(
      `SELECT count(*) AS value FROM quotations
       WHERE json_extract(source_metadata, '$.source') = 'combined_register'`,
    ),
    revisionRecordsCreated: scalar(
      `SELECT count(*) AS value FROM quotation_revisions r
       JOIN import_rows i ON i.revision_id = r.id
       WHERE i.import_file_id = ?`,
      importFileId,
    ),
    duplicateCandidates: scalar(
      `SELECT count(*) AS value FROM import_rows
       WHERE import_file_id = ? AND warnings LIKE '%"duplicate_candidate"%'`,
      importFileId,
    ),
    manualReviewRecords: outcomeCounts.manual_review ?? 0,
    failedRows: outcomeCounts.failed ?? 0,
    unmappedFields: Number(
      (
        JSON.parse(String(batch.summaryJson || "{}")) as {
          unmappedFields?: number;
        }
      ).unmappedFields ?? 0,
    ),
    totalDiscrepancies,
    unresolvedRows,
    rawFieldPreservationProblems: rawFieldProblems,
  },
  outcomeCounts,
  sources,
  exceptions: {
    total: exceptions.length,
    duplicateCandidates: scalar(
      `SELECT count(*) AS value FROM import_rows
       WHERE import_file_id = ? AND warnings LIKE '%"duplicate_candidate"%'`,
      importFileId,
    ),
    conflicts: scalar(
      `SELECT count(*) AS value FROM import_issues
       WHERE import_file_id = ? AND type = 'conflicting_value'`,
      importFileId,
    ),
    failedRows: outcomeCounts.failed ?? 0,
    missingRequired: scalar(
      `SELECT count(DISTINCT import_row_id) AS value FROM import_issues
       WHERE import_file_id = ? AND type = 'missing_required'`,
      importFileId,
    ),
    suspiciousDates: scalar(
      `SELECT count(DISTINCT import_row_id) AS value FROM import_issues
       WHERE import_file_id = ? AND type = 'suspicious_date'`,
      importFileId,
    ),
    suspiciousTotals: totalDiscrepancies,
    unmappedFields: Number(
      (
        JSON.parse(String(batch.summaryJson || "{}")) as {
          unmappedFields?: number;
        }
      ).unmappedFields ?? 0,
    ),
    lowConfidenceMatches: scalar(
      `SELECT count(DISTINCT import_row_id) AS value FROM import_issues
       WHERE import_file_id = ? AND type = 'low_confidence_match'`,
      importFileId,
    ),
  },
};

const csvHeaders = [
  "sourceRowNumber",
  "worksheetName",
  "outcome",
  "date",
  "quotationNumber",
  "customer",
  "rnc",
  "sourceFilename",
  "sourceOrigin",
  "sourceDocumentUri",
  "warnings",
  "errors",
  "issueTypes",
  "issueTitles",
];
const csv = [
  csvHeaders.map(csvCell).join(","),
  ...exceptions.map((row) =>
    csvHeaders.map((header) => csvCell(row[header])).join(","),
  ),
].join("\r\n");

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    join(outputDirectory, "reconciliation.local.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    join(outputDirectory, "exceptions.local.csv"),
    `${csv}\r\n`,
    "utf8",
  ),
]);
database.close();
console.log(JSON.stringify(report.reconciliation));
