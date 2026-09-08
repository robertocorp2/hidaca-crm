import {
  importIssues,
  sourceFieldValues,
  type importFiles,
} from "../../db/schema";
import type { NormalizedImportPreview } from "./importers";
import type { CanonicalSourceValue, ImportIssueDraft } from "./source-domain";

export const importMaxSize = 32 * 1024 * 1024;
export const maxSourceValues = 5_000;

export type ImportFileRow = typeof importFiles.$inferSelect;

// Multipart parsers may construct File objects in a different runtime realm.
// Avoid instanceof so valid browser uploads survive the edge-worker boundary.
export function isMultipartFile(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}

export function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(bytes: ArrayBuffer) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function previewForStorage(preview: NormalizedImportPreview) {
  return Object.fromEntries(
    Object.entries(preview).filter(([key]) => key !== "sourceValues"),
  ) as Omit<NormalizedImportPreview, "sourceValues">;
}

export function importStatusFor(
  preview: NormalizedImportPreview,
  partial: boolean,
): "parsed" | "partial" | "review_required" {
  if (
    preview.issues.some(
      (issue) => issue.severity === "blocking" || issue.severity === "error",
    )
  ) {
    return "review_required";
  }
  if (
    partial ||
    preview.issues.some(
      (issue) =>
        issue.type === "unmapped_field" ||
        issue.type === "conflicting_value" ||
        issue.type === "revision_candidate",
    )
  ) {
    return "review_required";
  }
  return "parsed";
}

export function sourceValueRows(
  importFileId: string,
  values: CanonicalSourceValue[],
) {
  return values.slice(0, maxSourceValues).map((value) => ({
    id: crypto.randomUUID(),
    importFileId,
    sourceSheet: value.sourceSheet ?? "",
    sourcePage: value.sourcePage ?? null,
    sourceCell: value.sourceCell ?? "",
    sourceLabel: value.sourceLabel ?? "",
    rawValue: value.rawValue,
    displayValue: value.displayValue ?? value.rawValue,
    sourceFormula: value.sourceFormula ?? "",
    normalizedValue: value.normalizedValue ?? "",
    canonicalEntity: value.canonicalEntity ?? "",
    canonicalField: value.canonicalField ?? "",
    transformation: value.transformation ?? "",
    confidence: value.confidence,
    valueState: value.valueState,
    mappingStatus: value.mappingStatus,
  })) satisfies Array<typeof sourceFieldValues.$inferInsert>;
}

export function issueRows(
  importFileId: string,
  issues: ImportIssueDraft[],
  now = new Date().toISOString(),
) {
  return issues.map((issue) => ({
    id: crypto.randomUUID(),
    importFileId,
    type: issue.type,
    severity: issue.severity,
    status: "open" as const,
    title: issue.title.slice(0, 240),
    detail: (issue.detail ?? "").slice(0, 4_000),
    sourceLocation: (issue.sourceLocation ?? "").slice(0, 500),
    createdAt: now,
  })) satisfies Array<typeof importIssues.$inferInsert>;
}

export function parserFailureIssue(
  message: string,
  sourceLocation = "",
): ImportIssueDraft {
  return {
    type: "parser_error",
    severity: "blocking",
    title: "El archivo no pudo analizarse completamente.",
    detail: message.slice(0, 4_000),
    sourceLocation,
  };
}

export function safeImportSummary(row: ImportFileRow) {
  return {
    id: row.id,
    batchId: row.batchId,
    documentId: row.documentId,
    filename: row.filename,
    extension: row.extension,
    sourcePath: row.sourcePath,
    sha256: row.sha256,
    parserName: row.parserName,
    parserVersion: row.parserVersion,
    documentKind: row.documentKind,
    sourceModifiedAt: row.sourceModifiedAt,
    downloadStatus: row.downloadStatus,
    deltaStatus: row.deltaStatus,
    templateType: row.templateType,
    status: row.status,
    importedBy: row.importedBy,
    importedAt: row.importedAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt,
    errorMessage: row.errorMessage,
    canonicalLinks: parseJson(row.canonicalLinks, {}),
  };
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function inChunks<T>(
  values: T[],
  size: number,
  action: (chunk: T[]) => Promise<unknown>,
) {
  for (let index = 0; index < values.length; index += size) {
    await action(values.slice(index, index + size));
  }
}
