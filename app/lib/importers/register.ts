import { normalizeEmail, normalizePhone, normalizeText } from "../crm";
import {
  inferCustomerType,
  normalizeRnc,
  parseSourceDate,
  quotationIdentity,
  valueStateOf,
  type MappingConfidence,
  type ValueState,
} from "../source-domain";
import type { ExtractedCell, ImportExtraction } from "./types";

export const REGISTER_SHEET_NAME = "Registro combinado";
export const REGISTER_SUMMARY_SHEET_NAME = "Resumen";

export const registerHeaders = [
  "Fecha",
  "Mes",
  "Año",
  "Cotización NO:",
  "Cliente",
  "RNC",
  "Contacto",
  "Telefono",
  "Celular",
  "Correo",
  "Direccion",
  "Direccion de Proyecto",
  "Archivo de Origen",
  "Enlace al Documento",
  "Registro de Origen",
] as const;

export type RegisterHeader = (typeof registerHeaders)[number];

export type RegisterRawValue = {
  raw: string;
  display: string;
  formula: string;
  state: ValueState;
  sourceCell: string;
};

export type RegisterNormalizedValues = {
  date: string | null;
  month: number | null;
  year: number | null;
  quotationNumber: string;
  normalizedQuotationNumber: string;
  quotationFamilyKey: string;
  customerName: string;
  normalizedCustomerName: string;
  customerType: "organization" | "individual";
  rnc: string;
  normalizedRnc: string;
  contactName: string;
  phone: string;
  normalizedPhone: string;
  mobilePhone: string;
  normalizedMobilePhone: string;
  email: string;
  normalizedEmail: string;
  address: string;
  projectAddress: string;
  sourceFilename: string;
  sourceDocumentUri: string;
  sourceOrigin: string;
};

export type RegisterRowDraft = {
  worksheetName: string;
  sourceRowNumber: number;
  fingerprintInput: string;
  rawValues: Record<RegisterHeader, RegisterRawValue>;
  normalizedValues: RegisterNormalizedValues;
  outcome: "ready" | "manual_review";
  matchConfidence: MappingConfidence;
  warnings: string[];
  errors: string[];
};

export type RegisterSourceSummary = {
  originLabel: string;
  sourceWorkbookName: string;
  expectedRows: number;
  expectedLinks: number;
};

export type RegisterMetric = {
  name: string;
  expectedValue: number;
};

export type RegisterParseResult = {
  worksheets: string[];
  rows: RegisterRowDraft[];
  sources: RegisterSourceSummary[];
  metrics: RegisterMetric[];
  unmappedHeaders: string[];
  formulas: number;
  formulaErrors: number;
};

const monthNumbers = new Map([
  ["enero", 1],
  ["febrero", 2],
  ["marzo", 3],
  ["abril", 4],
  ["mayo", 5],
  ["junio", 6],
  ["julio", 7],
  ["agosto", 8],
  ["septiembre", 9],
  ["setiembre", 9],
  ["octubre", 10],
  ["noviembre", 11],
  ["diciembre", 12],
]);

const canonicalHeaderByNormalized = new Map(
  registerHeaders.map((header) => [normalizeText(header), header]),
);

function textOf(cell: ExtractedCell | undefined) {
  if (!cell) return "";
  const display = String(cell.displayValue ?? "");
  if (display) return display;
  return cell.rawValue === null ? "" : String(cell.rawValue);
}

function numberOf(cell: ExtractedCell | undefined) {
  const value = Number(textOf(cell).replace(/[^\d-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function hyperlinkTarget(cell: ExtractedCell | undefined) {
  if (!cell) return "";
  const formula = cell.formula.trim();
  const match = formula.match(/^HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[,;]/i);
  if (match) return match[1].replace(/""/g, '"');
  const raw = textOf(cell).trim();
  return /^(?:https?:\/\/|file:\/\/|drive:)/i.test(raw) ? raw : "";
}

function uriScheme(uri: string) {
  const match = uri.trim().match(/^([a-z][a-z0-9+.-]*):/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function rawValue(cell: ExtractedCell | undefined): RegisterRawValue {
  const raw =
    cell?.rawValue === null || cell?.rawValue === undefined
      ? ""
      : String(cell.rawValue);
  return {
    raw,
    display: textOf(cell),
    formula: cell?.formula ?? "",
    state: valueStateOf(cell?.rawValue ?? ""),
    sourceCell: cell?.address ?? "",
  };
}

function cellMap(cells: ExtractedCell[]) {
  return new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
}

function findHeaderRow(cells: ExtractedCell[]) {
  const rows = new Map<number, Set<string>>();
  for (const cell of cells) {
    if (cell.row > 20) continue;
    const normalized = normalizeText(textOf(cell));
    if (!canonicalHeaderByNormalized.has(normalized)) continue;
    const values = rows.get(cell.row) ?? new Set<string>();
    values.add(normalized);
    rows.set(cell.row, values);
  }
  return [...rows.entries()]
    .sort((left, right) => right[1].size - left[1].size)
    .find(([, values]) => values.size >= 10)?.[0];
}

function parseYear(value: string) {
  const year = Number(value.replace(/[^\d]/g, ""));
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null;
}

function normalizedQuotationNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function stableFingerprintInput(
  worksheetName: string,
  sourceRowNumber: number,
  rawValues: Record<RegisterHeader, RegisterRawValue>,
) {
  return JSON.stringify([
    worksheetName,
    sourceRowNumber,
    ...registerHeaders.map((header) => rawValues[header].raw),
    ...registerHeaders.map((header) => rawValues[header].formula),
  ]);
}

function parseRegisterRows(extraction: ImportExtraction): {
  rows: RegisterRowDraft[];
  unmappedHeaders: string[];
  formulas: number;
  formulaErrors: number;
} {
  const sheet = extraction.sheets.find(
    (candidate) =>
      normalizeText(candidate.name) === normalizeText(REGISTER_SHEET_NAME),
  );
  if (!sheet) {
    throw new Error(`Falta la hoja obligatoria "${REGISTER_SHEET_NAME}".`);
  }
  const headerRow = findHeaderRow(sheet.cells);
  if (headerRow === undefined) {
    throw new Error(
      "No se encontraron los encabezados del registro combinado.",
    );
  }
  const cells = cellMap(sheet.cells);
  const headerColumns = new Map<RegisterHeader, number>();
  const unmappedHeaders: string[] = [];
  const columnsOnHeader = sheet.cells
    .filter((cell) => cell.row === headerRow)
    .sort((left, right) => left.column - right.column);
  for (const cell of columnsOnHeader) {
    const label = textOf(cell).trim();
    const canonical = canonicalHeaderByNormalized.get(normalizeText(label));
    if (canonical) headerColumns.set(canonical, cell.column);
    else if (label) unmappedHeaders.push(label);
  }
  const missing = registerHeaders.filter(
    (header) => !headerColumns.has(header),
  );
  if (missing.length) {
    throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);
  }

  const lastRow = Math.max(headerRow, ...sheet.cells.map((cell) => cell.row));
  const rows: RegisterRowDraft[] = [];
  let formulas = 0;
  let formulaErrors = 0;
  for (let rowIndex = headerRow + 1; rowIndex <= lastRow; rowIndex += 1) {
    const rawValues = Object.fromEntries(
      registerHeaders.map((header) => {
        const cell = cells.get(`${rowIndex}:${headerColumns.get(header)!}`);
        if (cell?.formula) formulas += 1;
        if (
          cell?.formula &&
          /#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A)/i.test(cell.formula)
        ) {
          formulaErrors += 1;
        }
        return [header, rawValue(cell)];
      }),
    ) as Record<RegisterHeader, RegisterRawValue>;
    if (
      registerHeaders.every(
        (header) =>
          !rawValues[header].raw &&
          !rawValues[header].display &&
          !rawValues[header].formula,
      )
    ) {
      continue;
    }

    const dateRaw = rawValues.Fecha.display;
    const date = parseSourceDate(dateRaw);
    const monthRaw = normalizeText(rawValues.Mes.display);
    const month = monthNumbers.get(monthRaw) ?? null;
    const year = parseYear(rawValues.Año.display);
    const quotationNumber = rawValues["Cotización NO:"].display.trim();
    const quotation = quotationIdentity(quotationNumber);
    const customerName = rawValues.Cliente.display.trim();
    const rncRaw = rawValues.RNC.display.trim();
    const sourceDocumentUri =
      hyperlinkTarget(
        cells.get(`${rowIndex}:${headerColumns.get("Enlace al Documento")!}`),
      ) || rawValues["Enlace al Documento"].display.trim();
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!dateRaw) warnings.push("missing_date");
    if (date.suspicious || (date.iso && Date.parse(date.iso) > Date.now())) {
      warnings.push("suspicious_date");
    }
    if (!quotationNumber) errors.push("missing_quotation_number");
    if (!customerName) errors.push("missing_customer");
    if (monthRaw && month === null) warnings.push("invalid_month");
    if (date.iso && month && Number(date.iso.slice(5, 7)) !== month) {
      warnings.push("month_mismatch");
    }
    if (date.iso && year && Number(date.iso.slice(0, 4)) !== year) {
      warnings.push("year_mismatch");
    }
    if (
      date.iso &&
      quotation.year &&
      Number(date.iso.slice(0, 4)) !== quotation.year
    ) {
      warnings.push("suspicious_date");
      warnings.push("year_mismatch");
    }
    if (
      rawValues.Contacto.display.includes(";") ||
      rawValues.Contacto.display.includes("/")
    ) {
      warnings.push("multiple_contacts");
    }
    if (
      rawValues.Correo.display.includes(";") ||
      rawValues.Correo.display.includes("/")
    ) {
      warnings.push("multiple_emails");
    }
    const scheme = uriScheme(sourceDocumentUri);
    if (scheme === "file" || (!scheme && sourceDocumentUri)) {
      warnings.push("source_unavailable");
    }
    if (!sourceDocumentUri) warnings.push("missing_source_uri");

    const normalizedValues: RegisterNormalizedValues = {
      date: date.iso,
      month,
      year: year ?? quotation.year,
      quotationNumber,
      normalizedQuotationNumber: normalizedQuotationNumber(quotationNumber),
      quotationFamilyKey: quotation.familyKey,
      customerName,
      normalizedCustomerName: normalizeText(customerName),
      customerType: inferCustomerType(customerName, rncRaw),
      rnc: rncRaw,
      normalizedRnc: normalizeRnc(rncRaw),
      contactName: rawValues.Contacto.display.trim(),
      phone: rawValues.Telefono.display,
      normalizedPhone: normalizePhone(rawValues.Telefono.display),
      mobilePhone: rawValues.Celular.display,
      normalizedMobilePhone: normalizePhone(rawValues.Celular.display),
      email: rawValues.Correo.display,
      normalizedEmail: normalizeEmail(rawValues.Correo.display),
      address: rawValues.Direccion.display,
      projectAddress: rawValues["Direccion de Proyecto"].display,
      sourceFilename: rawValues["Archivo de Origen"].display,
      sourceDocumentUri,
      sourceOrigin: rawValues["Registro de Origen"].display,
    };
    rows.push({
      worksheetName: sheet.name,
      sourceRowNumber: rowIndex + 1,
      fingerprintInput: stableFingerprintInput(
        sheet.name,
        rowIndex + 1,
        rawValues,
      ),
      rawValues,
      normalizedValues,
      outcome: errors.length ? "manual_review" : "ready",
      matchConfidence: errors.length ? "manual_review" : "high",
      warnings,
      errors,
    });
  }
  return { rows, unmappedHeaders, formulas, formulaErrors };
}

function parseSummary(extraction: ImportExtraction) {
  const sheet = extraction.sheets.find(
    (candidate) =>
      normalizeText(candidate.name) ===
      normalizeText(REGISTER_SUMMARY_SHEET_NAME),
  );
  if (!sheet) {
    throw new Error(
      `Falta la hoja obligatoria "${REGISTER_SUMMARY_SHEET_NAME}".`,
    );
  }
  const cells = cellMap(sheet.cells);
  const sources: RegisterSourceSummary[] = [];
  const metrics: RegisterMetric[] = [];
  for (let row = 0; row <= 100; row += 1) {
    const first = textOf(cells.get(`${row}:0`)).trim();
    const second = textOf(cells.get(`${row}:1`)).trim();
    const third = numberOf(cells.get(`${row}:2`));
    const fourth = numberOf(cells.get(`${row}:3`));
    if (row >= 3 && first && second && (third || fourth || first === "2024")) {
      sources.push({
        originLabel: first,
        sourceWorkbookName: second,
        expectedRows: third,
        expectedLinks: fourth,
      });
    }
    if (row >= 12 && first && second && /^\d+$/.test(second)) {
      metrics.push({ name: first, expectedValue: Number(second) });
    }
  }
  return { sources, metrics };
}

export function parseCombinedRegister(
  extraction: ImportExtraction,
): RegisterParseResult {
  const register = parseRegisterRows(extraction);
  const summary = parseSummary(extraction);
  return {
    worksheets: extraction.sheets.map((sheet) => sheet.name),
    rows: register.rows,
    sources: summary.sources,
    metrics: summary.metrics,
    unmappedHeaders: register.unmappedHeaders,
    formulas: register.formulas,
    formulaErrors: register.formulaErrors,
  };
}

export async function registerRowFingerprint(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function sourceUriScheme(
  uri: string,
): "https" | "http" | "file" | "drive" | "none" | "other" {
  const scheme = uriScheme(uri);
  if (!scheme) return uri ? "other" : "none";
  if (scheme === "https" || scheme === "http" || scheme === "file") {
    return scheme;
  }
  if (scheme === "drive") return "drive";
  return "other";
}
