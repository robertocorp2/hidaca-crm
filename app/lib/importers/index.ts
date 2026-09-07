import { parsePdf } from "./pdf";
import { parseSpreadsheet } from "./spreadsheet";
import type { ImportExtraction } from "./types";

export const supportedImportExtensions = [
  ".pdf",
  ".xlsx",
  ".xlsm",
  ".xlsb",
] as const;

export type SupportedImportExtension =
  (typeof supportedImportExtensions)[number];

export function normalizedExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

export function isSupportedImportExtension(
  extension: string,
): extension is SupportedImportExtension {
  return supportedImportExtensions.includes(
    extension as SupportedImportExtension,
  );
}

export async function parseSourceFile(
  filename: string,
  bytes: ArrayBuffer,
): Promise<ImportExtraction> {
  const extension = normalizedExtension(filename);
  if (!isSupportedImportExtension(extension)) {
    throw new Error("Formato no permitido. Usa PDF, XLSX, XLSM o XLSB.");
  }
  if (extension === ".pdf") return parsePdf(bytes);
  return parseSpreadsheet(
    bytes,
    extension.slice(1) as "xlsx" | "xlsm" | "xlsb",
  );
}

export type {
  ExtractedCell,
  ExtractedPage,
  ExtractedSheet,
  ImportExtraction,
  ImportReconciliationResult,
  InvoiceDocumentKind,
  InvoiceImportPreview,
  InvoiceMatchDecision,
  InvoiceSourceManifestEntry,
  InvoiceStagingRow,
  NormalizedImportPreview,
  NormalizedLineItem,
  NormalizedMaterialComponent,
  PaymentAllocationDraft,
} from "./types";

export {
  allocationDraftFromEvidence,
  analyzeInvoiceExtraction,
  classifyInvoiceDocument,
  decideInvoiceMatch,
  invoiceImportEntityId,
  refreshInvoiceIdentityFingerprint,
} from "./invoice";
export type { InvoiceExtractionAnalysis } from "./invoice";

export {
  parseCombinedRegister,
  registerHeaders,
  registerRowFingerprint,
  sourceUriScheme,
} from "./register";
export type {
  RegisterNormalizedValues,
  RegisterParseResult,
  RegisterRawValue,
  RegisterRowDraft,
  RegisterSourceSummary,
} from "./register";
