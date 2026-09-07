import {
  read,
  utils,
  version,
  type CellObject,
  type WorkBook,
} from "@e965/xlsx";
import type {
  ExtractedCell,
  ExtractedSheet,
  ImportExtraction,
  JsonPrimitive,
} from "./types";

const MAX_FILE_SIZE = 32 * 1024 * 1024;
const MAX_SHEETS = 40;
const MAX_CELLS_PER_SHEET = 40_000;
const MAX_REGISTER_CELLS_PER_SHEET = 80_000;
const MAX_TOTAL_CELLS = 120_000;
const MAX_CELL_TEXT = 20_000;

function jsonValue(value: unknown): JsonPrimitive {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function cellEntries(
  workbook: WorkBook,
  sheetName: string,
  warnings: string[],
): ExtractedSheet {
  const worksheet = workbook.Sheets[sheetName];
  const addresses = Object.keys(worksheet)
    .filter((key) => !key.startsWith("!"))
    .sort((left, right) => {
      const a = utils.decode_cell(left);
      const b = utils.decode_cell(right);
      return a.r - b.r || a.c - b.c;
    });
  const earlyLabels = new Set(
    addresses
      .slice(0, 250)
      .map((address) =>
        String(
          (worksheet[address] as CellObject)?.w ??
            (worksheet[address] as CellObject)?.v ??
            "",
        ).toLowerCase(),
      ),
  );
  const registerSheet =
    earlyLabels.has("fecha") &&
    earlyLabels.has("cotización no:") &&
    earlyLabels.has("archivo de origen") &&
    earlyLabels.has("registro de origen");
  const sheetLimit = registerSheet
    ? MAX_REGISTER_CELLS_PER_SHEET
    : MAX_CELLS_PER_SHEET;
  if (addresses.length > sheetLimit) {
    warnings.push(
      `${sheetName}: se retuvieron ${sheetLimit} de ${addresses.length} celdas no vacías.`,
    );
  }
  const cells: ExtractedCell[] = addresses
    .slice(0, sheetLimit)
    .map((address) => {
      const cell = worksheet[address] as CellObject;
      const decoded = utils.decode_cell(address);
      const raw = jsonValue(cell.v);
      const display = String(cell.w ?? raw ?? "").slice(0, MAX_CELL_TEXT);
      return {
        sheet: sheetName,
        address,
        row: decoded.r,
        column: decoded.c,
        rawValue: raw,
        displayValue: display,
        formula: String(cell.f ?? "").slice(0, MAX_CELL_TEXT),
        cellType: String(cell.t ?? ""),
      };
    });
  const merges = (worksheet["!merges"] ?? [])
    .slice(0, 2_000)
    .map((range) => utils.encode_range(range));
  return {
    name: sheetName,
    range: String(worksheet["!ref"] ?? ""),
    cells,
    merges,
  };
}

export function parseSpreadsheet(
  bytes: ArrayBuffer,
  format: "xlsx" | "xlsm" | "xlsb",
): ImportExtraction {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_SIZE) {
    throw new Error("El archivo debe tener entre 1 byte y 32 MB.");
  }
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const isZip =
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(signature[2] ?? -1);
  const isCompound =
    signature.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
      (value, index) => signature[index] === value,
    );
  if (
    ((format === "xlsx" || format === "xlsm") && !isZip) ||
    (format === "xlsb" && !isZip && !isCompound)
  ) {
    throw new Error(
      `No se pudo leer el libro ${format.toUpperCase()}: la firma del archivo no coincide con su extensión.`,
    );
  }
  const warnings: string[] = [];
  let workbook: WorkBook;
  try {
    workbook = read(new Uint8Array(bytes), {
      cellDates: true,
      cellFormula: true,
      cellText: true,
      bookVBA: true,
      WTF: false,
    });
  } catch (error) {
    throw new Error(
      `No se pudo leer el libro ${format.toUpperCase()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const selectedNames = workbook.SheetNames.slice(0, MAX_SHEETS);
  if (workbook.SheetNames.length > MAX_SHEETS) {
    warnings.push(
      `El libro contiene ${workbook.SheetNames.length} hojas; se inspeccionaron ${MAX_SHEETS}.`,
    );
  }
  const sheets: ExtractedSheet[] = [];
  let totalCells = 0;
  for (const sheetName of selectedNames) {
    const sheet = cellEntries(workbook, sheetName, warnings);
    if (totalCells + sheet.cells.length > MAX_TOTAL_CELLS) {
      const remaining = Math.max(0, MAX_TOTAL_CELLS - totalCells);
      sheet.cells = sheet.cells.slice(0, remaining);
      warnings.push(
        `Se alcanzó el límite seguro de ${MAX_TOTAL_CELLS} celdas no vacías.`,
      );
    }
    totalCells += sheet.cells.length;
    sheets.push(sheet);
    if (totalCells >= MAX_TOTAL_CELLS) break;
  }

  return {
    format,
    parserName: "sheetjs",
    parserVersion: version,
    sheets,
    pages: [],
    hasMacros: Boolean(workbook.vbaraw),
    partial: warnings.length > 0,
    warnings,
  };
}
