import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { read, utils } from "@e965/xlsx";
import { analyzeInvoiceExtraction, parseSourceFile } from "../../app/lib/importers";

type SourceInvoice = {
  number: number;
  invoiceNumber: string;
  issueDate: string;
  businessName: string;
  rnc: string;
  ncf: string;
  subtotal: number;
  tax: number;
  total: number;
  path: string;
  hash: string;
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Importe inválido: ${String(value)}`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) throw new Error(`Fecha inválida: ${text}`);
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function invoiceNumber(value: unknown) {
  const match = String(value ?? "").toUpperCase().match(/F\s*-?\s*0*(\d{1,4})/);
  if (!match) return null;
  const number = Number(match[1]);
  return { number, formatted: `F-${String(number).padStart(4, "0")}` };
}

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function authoritativeTotals(bytes: Uint8Array, path: string) {
  const workbook = read(bytes, { cellDates: true, cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames.find((name) => normalizeLabel(name) === "factura") ?? workbook.SheetNames[0]];
  const labels = Object.entries(sheet)
    .filter(([address]) => !address.startsWith("!"))
    .map(([address, cell]) => ({ address, label: normalizeLabel(cell.w ?? cell.v), position: utils.decode_cell(address) }));
  const taxLabel = labels.find((item) => item.label.startsWith("itbis"));
  if (!taxLabel) throw new Error(`No se encontró ITBIS en la hoja FACTURA: ${path}.`);
  const subtotalLabel = labels
    .filter((item) => item.position.r < taxLabel.position.r && item.label === "sub total")
    .sort((left, right) => right.position.r - left.position.r)[0];
  const totalLabel = labels
    .filter((item) => item.position.r > taxLabel.position.r && item.label.startsWith("total"))
    .sort((left, right) => left.position.r - right.position.r)[0];
  if (!subtotalLabel || !totalLabel) throw new Error("No se encontraron los totales finales en la hoja FACTURA.");
  const right = (item: typeof taxLabel) => {
    const cell = sheet[utils.encode_cell({ r: item!.position.r, c: item!.position.c + 1 })];
    return Number(cell?.v);
  };
  const subtotal = right(subtotalLabel);
  const tax = right(taxLabel);
  const total = right(totalLabel);
  if (![subtotal, tax, total].every(Number.isFinite)) throw new Error("Los totales finales no son numéricos.");
  return { subtotal: round(subtotal), tax: round(tax), total: round(total) };
}

async function walk(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile() && /\.xlsx$/i.test(entry.name)) output.push(path);
  }
  return output;
}

function table(path: string) {
  return readFile(path).then((bytes) => {
    const workbook = read(bytes, { cellDates: true, cellFormula: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  });
}

async function issuedInvoice(path: string, sourceRoot: string): Promise<SourceInvoice | null> {
  const parsedNumber = invoiceNumber(path.split(/[\\/]/).at(-1));
  if (!parsedNumber || parsedNumber.number < 21 || parsedNumber.number > 92) return null;
  const bytes = await readFile(path);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const extraction = await parseSourceFile(path, arrayBuffer);
  const analysis = analyzeInvoiceExtraction(path, sha256(bytes), extraction);
  const row = analysis.rows.find((candidate) => candidate.documentKind === "invoice");
  if (!row) throw new Error(`No se extrajo una factura de ${path}`);
  const values = row.normalizedValues;
  const extractedNumber = invoiceNumber(values.invoice_number);
  if (!extractedNumber || extractedNumber.number !== parsedNumber.number) {
    throw new Error(`Número inconsistente en ${path}: ${String(values.invoice_number)}`);
  }
  const totals = authoritativeTotals(bytes, path);
  return {
    number: parsedNumber.number,
    invoiceNumber: parsedNumber.formatted,
    issueDate: iso(values.issue_date),
    businessName: String(values.business_name ?? "").trim(),
    rnc: String(values.rnc ?? "").trim(),
    ncf: String(values.ncf ?? "").trim(),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    path: relative(sourceRoot, path).replaceAll("\\", "/"),
    hash: sha256(bytes),
  };
}

function mapRegister(rows: unknown[][]) {
  return new Map(
    rows.slice(1).flatMap((row) => {
      const number = invoiceNumber(row[3]);
      if (!number || number.number < 1 || number.number > 107) return [];
      return [[number.number, {
        number: number.number,
        invoiceNumber: number.formatted,
        issueDate: number.number <= 92 ? iso(row[1]) : "",
        businessName: String(row[2] ?? "").trim(),
        ncf: String(row[4] ?? "").trim(),
        subtotal: round(row[5]),
        tax: round(row[6]),
        total: round(row[7]),
        status: String(row[8] ?? "").trim().toUpperCase(),
      }] as const];
    }),
  );
}

function mapMatrix(rows: unknown[][]) {
  return new Map(
    rows.slice(1).flatMap((row) => {
      const number = invoiceNumber(row[5]);
      const year = Number(row[3]);
      if (!number || year !== 2021 || number.number < 1 || number.number > 72) return [];
      return [[number.number, {
        number: number.number,
        invoiceNumber: number.formatted,
        issueDate: iso(row[1]),
        businessName: String(row[4] ?? "").trim(),
        ncf: String(row[6] ?? "").trim(),
        subtotal: round(row[8]),
        tax: round(row[9]),
        total: round(row[10]),
        paid: round(row[12]),
        balance: round(row[13]),
        status: String(row[14] ?? "").trim().toUpperCase(),
      }] as const];
    }),
  );
}

const [sourceRootArg, registerPathArg, matrixPathArg, outputPathArg] = process.argv.slice(2);
if (!sourceRootArg || !registerPathArg || !matrixPathArg || !outputPathArg) {
  throw new Error("Uso: extract-2021-sources <carpeta-2021> <registro.xlsx> <matriz.xlsx> <salida.json>");
}
const sourceRoot = resolve(sourceRootArg);
const registerPath = resolve(registerPathArg);
const matrixPath = resolve(matrixPathArg);
const outputPath = resolve(outputPathArg);
const registerBytes = await readFile(registerPath);
const register = mapRegister(await table(registerPath));
const matrix = mapMatrix(await table(matrixPath));
const allFiles = await walk(sourceRoot);
const issuedAll = (await Promise.all(allFiles.map((path) => issuedInvoice(path, sourceRoot)))).filter(
  (invoice): invoice is SourceInvoice => invoice !== null,
);
const issuedByNumber = new Map<number, SourceInvoice[]>();
for (const invoice of issuedAll) {
  const entries = issuedByNumber.get(invoice.number) ?? [];
  entries.push(invoice);
  issuedByNumber.set(invoice.number, entries);
}
const canonicalIssued = new Map<number, SourceInvoice>();
for (let number = 21; number <= 92; number += 1) {
  const entries = issuedByNumber.get(number) ?? [];
  if (number === 90) {
    const december = entries.find((entry) => /DICIEMBRE/i.test(entry.path));
    if (!december || entries.length !== 2) throw new Error("F-0090 debe tener copias en septiembre y diciembre.");
    canonicalIssued.set(number, december);
  } else {
    if (entries.length !== 1) throw new Error(`F-${String(number).padStart(4, "0")}: ${entries.length} fuentes emitidas.`);
    canonicalIssued.set(number, entries[0]);
  }
}

const invoices = [];
for (let number = 1; number <= 92; number += 1) {
  const registry = register.get(number);
  if (!registry) throw new Error(`Falta F-${String(number).padStart(4, "0")} en el registro.`);
  const document = canonicalIssued.get(number);
  const authority = number <= 20 ? registry : document;
  if (!authority) throw new Error(`Falta fuente autoritativa para F-${String(number).padStart(4, "0")}.`);
  invoices.push({
    number: registry.invoiceNumber,
    date: authority.issueDate,
    business: authority.businessName,
    rnc: document?.rnc ?? "",
    ncf: authority.ncf,
    subtotal: authority.subtotal,
    tax: authority.tax,
    total: authority.total,
    paid: authority.total,
    balance: 0,
    status: "PAGADO",
    currency: "DOP",
    authority: number <= 20 ? "registro_2021" : "documento_emitido",
    sourceHash: number <= 20 ? sha256(registerBytes) : document!.hash,
  });
}

const fields = ["issueDate", "businessName", "ncf", "subtotal", "tax", "total"] as const;
const conflicts = [];
for (let number = 1; number <= 92; number += 1) {
  const registry = register.get(number)!;
  const matrixRow = matrix.get(number);
  const document = canonicalIssued.get(number);
  const selected = number <= 20 ? registry : document!;
  for (const field of fields) {
    const compared = [registry[field], matrixRow?.[field], document?.[field]].filter((value) => value !== undefined);
    const normalized = compared.map((value) => {
      if (typeof value === "number") return round(value);
      if (field === "ncf") return String(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
      return String(value).trim();
    });
    if (new Set(normalized.map(String)).size <= 1) continue;
    conflicts.push({
      invoice: registry.invoiceNumber,
      field,
      registerValue: registry[field] ?? "",
      matrixValue: matrixRow?.[field] ?? "",
      documentValue: document?.[field] ?? "",
      selectedSource: number <= 20 ? "Registro 2021" : "Documento emitido",
      finalValue: selected[field],
      note: number <= 20
        ? "El registro 2021 es la autoridad definida para F-0001–F-0020."
        : "El documento emitido prevalece sobre registro y matriz.",
    });
  }
}
for (const invoice of invoices) {
  const calculated = round(invoice.subtotal + invoice.tax);
  if (Math.abs(calculated - invoice.total) <= 0.02) continue;
  conflicts.push({
    invoice: invoice.number,
    field: "cuadre subtotal+ITBIS",
    registerValue: register.get(Number(invoice.number.slice(2)))?.total ?? "",
    matrixValue: matrix.get(Number(invoice.number.slice(2)))?.total ?? "",
    documentValue: `${invoice.subtotal} + ${invoice.tax} = ${calculated}; TOTAL impreso = ${invoice.total}`,
    selectedSource: invoice.authority === "documento_emitido" ? "Documento emitido" : "Registro 2021",
    finalValue: invoice.total,
    note: "Se conserva el TOTAL impreso de la fuente autoritativa; la diferencia aritmética queda documentada.",
  });
}

const sources = [];
for (const path of [...new Set([registerPath, matrixPath, ...allFiles])]) {
  const bytes = await readFile(path);
  const relativePath = path === matrixPath
    ? relative(resolve(sourceRoot, ".."), path).replaceAll("\\", "/")
    : relative(sourceRoot, path).replaceAll("\\", "/");
  const number = invoiceNumber(path.split(/[\\/]/).at(-1));
  const metadata = await stat(path);
  let role = "No utilizado para el consolidado";
  let representation = "—";
  if (path === registerPath) role = "Autoridad F-0001–F-0020 y snapshot PAGADO/balance cero";
  else if (path === matrixPath) role = "Corroboración exclusiva de F-0001–F-0072 (filas 2021)";
  else if (number && number.number >= 21 && number.number <= 92) {
    role = `Autoridad de ${number.formatted}`;
    if (number.number === 90 && /SEPTIEMBRE/i.test(path)) {
      role = "Representación duplicada no seleccionada de F-0090";
      representation = "Duplicado de la copia de diciembre";
    } else if (number.number === 90 && /DICIEMBRE/i.test(path)) {
      role = "Autoridad de F-0090";
      representation = "Copia principal de diciembre";
    }
  }
  sources.push({
    path: relativePath,
    sha256: sha256(bytes),
    role,
    representation,
    size: bytes.byteLength,
    modifiedAt: metadata.mtime.toISOString(),
  });
}

const reserved = [...register.keys()].filter((number) => number >= 93 && number <= 107).sort((a, b) => a - b);
const output = {
  generatedAt: new Date().toISOString(),
  invoices,
  sources: sources.sort((a, b) => a.path.localeCompare(b.path)),
  conflicts,
  reconciliation: {
    invoiceCount: invoices.length,
    uniqueInvoiceNumbers: new Set(invoices.map((invoice) => invoice.number)).size,
    uniqueNcf: new Set(invoices.map((invoice) => invoice.ncf.replace(/[^A-Z0-9]/gi, "").toUpperCase())).size,
    firstInvoice: invoices[0].number,
    lastInvoice: invoices.at(-1)!.number,
    reservedExcluded: reserved.map((number) => `F-${String(number).padStart(4, "0")}`),
    authoritativeRegisterRows: invoices.filter((invoice) => invoice.authority === "registro_2021").length,
    authoritativeIssuedRows: invoices.filter((invoice) => invoice.authority === "documento_emitido").length,
    issuedRepresentations: issuedAll.length,
    uniqueIssuedInvoices: canonicalIssued.size,
    duplicateRepresentations: issuedAll.length - canonicalIssued.size,
    matrix2021Rows: matrix.size,
    conflictCount: conflicts.length,
    totals: invoices.reduce((sum, invoice) => ({
      subtotal: round(sum.subtotal + invoice.subtotal),
      tax: round(sum.tax + invoice.tax),
      total: round(sum.total + invoice.total),
      paid: round(sum.paid + invoice.paid),
      balance: round(sum.balance + invoice.balance),
    }), { subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0 }),
  },
};
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output.reconciliation, null, 2));
