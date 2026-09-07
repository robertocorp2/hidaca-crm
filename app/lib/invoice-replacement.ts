import { normalizeText } from "./crm";
import { parseSourceFile, type ExtractedCell } from "./importers";
import { sha256Hex } from "./import-service";
import { normalizeRnc } from "./source-domain";

export const invoiceReplacementFilename =
  "HIDACA_Facturas_2021_Importacion.xlsx";
export const invoiceReplacementConfirmation =
  "REEMPLAZAR FACTURAS 2021";
export const invoiceReplacementCount = 92;

export const invoiceReplacementSheets = [
  "Facturas",
  "Fuentes",
  "Conflictos",
  "Reconciliacion",
] as const;

export const invoiceReplacementHeaders = [
  "Número",
  "Fecha",
  "Empresa",
  "RNC",
  "NCF",
  "Subtotal",
  "ITBIS",
  "Total",
  "Pagado",
  "Balance",
  "Estado",
  "Moneda",
  "Autoridad",
  "Hash de fuente",
] as const;

export type InvoiceReplacementAuthority =
  | "registro_2021"
  | "documento_emitido";

export type InvoiceReplacementRow = {
  sourceRowNumber: number;
  invoiceNumber: string;
  invoiceNumberNormalized: string;
  issueDate: string;
  businessName: string;
  normalizedBusinessName: string;
  rnc: string;
  normalizedRnc: string;
  ncf: string;
  normalizedNcf: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: "paid";
  currency: "DOP";
  authority: InvoiceReplacementAuthority;
  sourceHash: string;
};

export type ParsedInvoiceReplacement = {
  filename: string;
  workbookHash: string;
  sheetNames: string[];
  sourceHashes: string[];
  rows: InvoiceReplacementRow[];
  totals: {
    subtotal: number;
    tax: number;
    total: number;
    paid: number;
    balance: number;
  };
};

type Sheet = Awaited<ReturnType<typeof parseSourceFile>>["sheets"][number];

function key(value: unknown) {
  return normalizeText(String(value ?? ""));
}

function cellValue(cell: ExtractedCell | undefined) {
  return cell?.rawValue ?? cell?.displayValue ?? null;
}

function cellText(cell: ExtractedCell | undefined) {
  return String(cell?.displayValue ?? cell?.rawValue ?? "").trim();
}

function cellsByCoordinate(sheet: Sheet) {
  return new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
}

function money(value: unknown, label: string, row: number) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  const cleaned = String(value ?? "")
    .trim()
    .replace(/(?:RD|US)?\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Facturas fila ${row}: ${label} no es un importe válido.`);
  }
  return roundMoney(parsed);
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sourceCompanyKey(name: string, rnc: string) {
  const normalizedRnc = normalizeRnc(rnc);
  return normalizedRnc ? `rnc:${normalizedRnc}` : `name:${normalizeText(name)}`;
}

export function invoiceReplacementCommitDecision(input: {
  actualWorkbookHash: string;
  expectedWorkbookHash: string;
  actualStateFingerprint: string;
  expectedStateFingerprint: string;
  alreadyCommittedInvoiceCount: number;
}) {
  if (input.actualWorkbookHash !== input.expectedWorkbookHash) return "file_changed" as const;
  if (input.alreadyCommittedInvoiceCount === invoiceReplacementCount) return "idempotent" as const;
  if (input.actualStateFingerprint !== input.expectedStateFingerprint) return "state_changed" as const;
  return "commit" as const;
}

function isoDate(value: unknown, display: string, row: number) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = (display || raw).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (local) {
    return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  }
  throw new Error(`Facturas fila ${row}: Fecha no es una fecha real de Excel.`);
}

function normalizeInvoiceNumber(value: string) {
  const match = value.toUpperCase().match(/^F\s*-?\s*0*(\d{1,4})$/);
  if (!match) return "";
  return `F-${Number(match[1]).toString().padStart(4, "0")}`;
}

function normalizeFiscalIdentifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseAuthority(value: string, invoiceNumber: number) {
  const normalized = key(value).replaceAll(" ", "_");
  const expected = invoiceNumber <= 20 ? "registro_2021" : "documento_emitido";
  if (normalized !== expected) {
    throw new Error(
      `La autoridad de F-${String(invoiceNumber).padStart(4, "0")} debe ser ${expected}.`,
    );
  }
  return expected as InvoiceReplacementAuthority;
}

function documentedArithmeticConflicts(sheet: Sheet) {
  const cells = cellsByCoordinate(sheet);
  const headers = new Map(
    sheet.cells
      .filter((cell) => cell.row === 0)
      .map((cell) => [key(cellText(cell)), cell.column]),
  );
  const invoiceColumn = headers.get(key("Factura"));
  const fieldColumn = headers.get(key("Campo"));
  if (invoiceColumn === undefined || fieldColumn === undefined) {
    throw new Error("Conflictos: faltan los encabezados Factura y Campo.");
  }
  const documented = new Set<string>();
  for (let row = 1; row <= 500; row += 1) {
    const field = key(cellText(cells.get(`${row}:${fieldColumn}`)));
    if (field !== key("cuadre subtotal+ITBIS")) continue;
    const number = normalizeInvoiceNumber(cellText(cells.get(`${row}:${invoiceColumn}`)));
    if (number) documented.add(number);
  }
  return documented;
}

function parseInvoiceSheet(sheet: Sheet, arithmeticConflicts: Set<string>) {
  const cells = cellsByCoordinate(sheet);
  const headerColumns = new Map<string, number>();
  for (const cell of sheet.cells.filter((candidate) => candidate.row === 0)) {
    headerColumns.set(key(cellText(cell)), cell.column);
  }
  for (const header of invoiceReplacementHeaders) {
    if (!headerColumns.has(key(header))) {
      throw new Error(`Facturas: falta el encabezado obligatorio “${header}”.`);
    }
  }

  const at = (row: number, header: (typeof invoiceReplacementHeaders)[number]) =>
    cells.get(`${row}:${headerColumns.get(key(header))}`);
  const rows: InvoiceReplacementRow[] = [];
  for (let sheetRow = 1; sheetRow <= invoiceReplacementCount; sheetRow += 1) {
    const displayRow = sheetRow + 1;
    const invoiceNumberRaw = cellText(at(sheetRow, "Número"));
    const invoiceNumberNormalized = normalizeInvoiceNumber(invoiceNumberRaw);
    const expectedNumber = `F-${String(sheetRow).padStart(4, "0")}`;
    if (invoiceNumberNormalized !== expectedNumber) {
      throw new Error(
        `Facturas fila ${displayRow}: se esperaba ${expectedNumber} y se encontró ${invoiceNumberRaw || "vacío"}.`,
      );
    }
    const businessName = cellText(at(sheetRow, "Empresa"));
    const normalizedBusinessName = normalizeText(businessName);
    if (!normalizedBusinessName) {
      throw new Error(`Facturas fila ${displayRow}: Empresa es obligatoria.`);
    }
    const issueDate = isoDate(
      cellValue(at(sheetRow, "Fecha")),
      cellText(at(sheetRow, "Fecha")),
      displayRow,
    );
    if (!issueDate.startsWith("2021-")) {
      throw new Error(
        `Facturas fila ${displayRow}: la fecha ${issueDate} no pertenece a 2021.`,
      );
    }
    const rnc = cellText(at(sheetRow, "RNC"));
    const ncf = cellText(at(sheetRow, "NCF"));
    const normalizedNcf = normalizeFiscalIdentifier(ncf);
    if (!normalizedNcf) {
      throw new Error(`Facturas fila ${displayRow}: NCF es obligatorio.`);
    }
    const subtotal = money(cellValue(at(sheetRow, "Subtotal")), "Subtotal", displayRow);
    const tax = money(cellValue(at(sheetRow, "ITBIS")), "ITBIS", displayRow);
    const total = money(cellValue(at(sheetRow, "Total")), "Total", displayRow);
    const paid = money(cellValue(at(sheetRow, "Pagado")), "Pagado", displayRow);
    const balance = money(cellValue(at(sheetRow, "Balance")), "Balance", displayRow);
    if (
      Math.abs(roundMoney(subtotal + tax) - total) > 0.02 &&
      !arithmeticConflicts.has(expectedNumber)
    ) {
      throw new Error(`Facturas fila ${displayRow}: Subtotal + ITBIS no cuadra con Total.`);
    }
    if (Math.abs(roundMoney(paid + balance) - total) > 0.02) {
      throw new Error(`Facturas fila ${displayRow}: Pagado + Balance no cuadra con Total.`);
    }
    const statusRaw = key(cellText(at(sheetRow, "Estado")));
    if (!["pagado", "pagada", "paid"].includes(statusRaw) || balance !== 0) {
      throw new Error(
        `Facturas fila ${displayRow}: el snapshot histórico debe estar PAGADO con balance cero.`,
      );
    }
    const currency = cellText(at(sheetRow, "Moneda")).toUpperCase();
    if (currency !== "DOP") {
      throw new Error(`Facturas fila ${displayRow}: la moneda debe ser DOP.`);
    }
    const sourceHash = cellText(at(sheetRow, "Hash de fuente")).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
      throw new Error(`Facturas fila ${displayRow}: Hash de fuente no es SHA-256.`);
    }
    rows.push({
      sourceRowNumber: displayRow,
      invoiceNumber: expectedNumber,
      invoiceNumberNormalized: normalizeFiscalIdentifier(expectedNumber),
      issueDate,
      businessName,
      normalizedBusinessName,
      rnc,
      normalizedRnc: normalizeRnc(rnc),
      ncf,
      normalizedNcf,
      subtotal,
      tax,
      total,
      paid,
      balance,
      status: "paid",
      currency: "DOP",
      authority: parseAuthority(cellText(at(sheetRow, "Autoridad")), sheetRow),
      sourceHash,
    });
  }

  const extraNumbers = sheet.cells.filter(
    (cell) =>
      cell.row > invoiceReplacementCount &&
      cell.column === headerColumns.get(key("Número")) &&
      cellText(cell),
  );
  if (extraNumbers.length) {
    throw new Error("Facturas debe contener exactamente 92 filas de datos.");
  }
  const uniqueNumbers = new Set(rows.map((row) => row.invoiceNumberNormalized));
  const uniqueNcf = new Set(rows.map((row) => row.normalizedNcf));
  if (uniqueNumbers.size !== invoiceReplacementCount || uniqueNcf.size !== invoiceReplacementCount) {
    throw new Error("Las 92 facturas deben tener números y NCF únicos.");
  }
  return rows;
}

function sourceHashes(sheet: Sheet) {
  const cells = cellsByCoordinate(sheet);
  const hashHeader = sheet.cells.find(
    (cell) => cell.row === 0 && ["hash sha 256", "hash de fuente", "sha 256"].includes(key(cellText(cell))),
  );
  if (!hashHeader) throw new Error("Fuentes: falta el encabezado Hash SHA-256.");
  const hashes = new Set<string>();
  for (let row = 1; row <= 500; row += 1) {
    const value = cellText(cells.get(`${row}:${hashHeader.column}`)).toLowerCase();
    if (!value) continue;
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Fuentes fila ${row + 1}: hash SHA-256 inválido.`);
    }
    hashes.add(value);
  }
  return [...hashes].sort();
}

export async function parseInvoiceReplacementWorkbook(
  filename: string,
  bytes: ArrayBuffer,
): Promise<ParsedInvoiceReplacement> {
  if (!filename.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Selecciona el archivo XLSX consolidado de Facturas 2021.");
  }
  const extraction = await parseSourceFile(filename, bytes);
  const actualNames = extraction.sheets.map((sheet) => sheet.name);
  if (
    actualNames.length !== invoiceReplacementSheets.length ||
    invoiceReplacementSheets.some((name) => !actualNames.includes(name))
  ) {
    throw new Error(
      `El libro debe contener únicamente estas hojas: ${invoiceReplacementSheets.join(", ")}.`,
    );
  }
  const invoicesSheet = extraction.sheets.find((sheet) => sheet.name === "Facturas")!;
  const sourcesSheet = extraction.sheets.find((sheet) => sheet.name === "Fuentes")!;
  const conflictsSheet = extraction.sheets.find((sheet) => sheet.name === "Conflictos")!;
  const rows = parseInvoiceSheet(
    invoicesSheet,
    documentedArithmeticConflicts(conflictsSheet),
  );
  const totals = rows.reduce(
    (sum, row) => ({
      subtotal: roundMoney(sum.subtotal + row.subtotal),
      tax: roundMoney(sum.tax + row.tax),
      total: roundMoney(sum.total + row.total),
      paid: roundMoney(sum.paid + row.paid),
      balance: roundMoney(sum.balance + row.balance),
    }),
    { subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0 },
  );
  return {
    filename,
    workbookHash: await sha256Hex(bytes),
    sheetNames: actualNames,
    sourceHashes: sourceHashes(sourcesSheet),
    rows,
    totals,
  };
}
