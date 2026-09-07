import type { RegisterParseResult, RegisterRowDraft } from "./importers";
import { registerRowFingerprint } from "./importers";

export type RegisterRowAnalysis = RegisterRowDraft & {
  rowFingerprint: string;
  duplicateOfRowNumber: number | null;
};

export type RegisterDryRunSummary = {
  worksheetsInspected: number;
  sourceRowsDiscovered: number;
  rowsReady: number;
  duplicateCandidates: number;
  manualReviewRecords: number;
  failedRows: number;
  missingDates: number;
  missingQuotationNumbers: number;
  missingCustomers: number;
  suspiciousDates: number;
  monthMismatches: number;
  unavailableSources: number;
  unmappedFields: number;
  formulas: number;
  formulaErrors: number;
};

function duplicateKey(row: RegisterRowDraft) {
  const value = row.normalizedValues;
  if (!value.normalizedQuotationNumber) {
    return "";
  }
  return [
    (value.date ?? row.rawValues.Fecha.display.trim()) || "__blank__",
    value.normalizedQuotationNumber,
    value.normalizedCustomerName || "__blank__",
  ].join("|");
}

function addUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

export async function analyzeRegisterImport(
  parsed: RegisterParseResult,
): Promise<{
  rows: RegisterRowAnalysis[];
  summary: RegisterDryRunSummary;
}> {
  const duplicateRows = new Map<string, number>();
  const customerRncs = new Map<string, Set<string>>();
  for (const row of parsed.rows) {
    const name = row.normalizedValues.normalizedCustomerName;
    const rnc = row.normalizedValues.normalizedRnc;
    if (!name || !rnc) continue;
    const values = customerRncs.get(name) ?? new Set<string>();
    values.add(rnc);
    customerRncs.set(name, values);
  }

  const rows: RegisterRowAnalysis[] = [];
  for (const row of parsed.rows) {
    const warnings = [...row.warnings];
    const errors = [...row.errors];
    let outcome = row.outcome;
    let matchConfidence = row.matchConfidence;
    let duplicateOfRowNumber: number | null = null;
    const key = duplicateKey(row);
    if (key) {
      const first = duplicateRows.get(key);
      if (first !== undefined) {
        duplicateOfRowNumber = first;
        outcome = "manual_review";
        matchConfidence = "manual_review";
        warnings.push("duplicate_candidate");
      } else {
        duplicateRows.set(key, row.sourceRowNumber);
      }
    }
    const customerRncSet = customerRncs.get(
      row.normalizedValues.normalizedCustomerName,
    );
    if (customerRncSet && customerRncSet.size > 1) {
      outcome = "manual_review";
      matchConfidence = "manual_review";
      warnings.push("conflicting_customer_rnc");
    }
    if (
      warnings.includes("suspicious_date") ||
      warnings.includes("month_mismatch") ||
      warnings.includes("invalid_month") ||
      warnings.includes("year_mismatch") ||
      warnings.includes("multiple_contacts") ||
      warnings.includes("multiple_emails")
    ) {
      outcome = "manual_review";
      matchConfidence = "manual_review";
    }
    rows.push({
      ...row,
      rowFingerprint: await registerRowFingerprint(row.fingerprintInput),
      duplicateOfRowNumber,
      outcome,
      matchConfidence,
      warnings: [...new Set(warnings)],
      errors: [...new Set(errors)],
    });
  }

  const summary: RegisterDryRunSummary = {
    worksheetsInspected: parsed.worksheets.length,
    sourceRowsDiscovered: rows.length,
    rowsReady: rows.filter((row) => row.outcome === "ready").length,
    duplicateCandidates: rows.filter((row) =>
      row.warnings.includes("duplicate_candidate"),
    ).length,
    manualReviewRecords: rows.filter((row) => row.outcome === "manual_review")
      .length,
    failedRows: 0,
    missingDates: rows.filter((row) => row.warnings.includes("missing_date"))
      .length,
    missingQuotationNumbers: rows.filter((row) =>
      row.errors.includes("missing_quotation_number"),
    ).length,
    missingCustomers: rows.filter((row) =>
      row.errors.includes("missing_customer"),
    ).length,
    suspiciousDates: rows.filter((row) =>
      row.warnings.includes("suspicious_date"),
    ).length,
    monthMismatches: rows.filter((row) =>
      row.warnings.includes("month_mismatch"),
    ).length,
    unavailableSources: rows.filter((row) =>
      row.warnings.includes("source_unavailable"),
    ).length,
    unmappedFields: parsed.unmappedHeaders.length,
    formulas: parsed.formulas,
    formulaErrors: parsed.formulaErrors,
  };
  return { rows, summary };
}

export function mergeRegisterWarnings(current: string[], additions: string[]) {
  return additions.reduce(addUnique, current);
}
