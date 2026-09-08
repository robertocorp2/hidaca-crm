import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseInvoiceReplacementWorkbook } from "../../app/lib/invoice-replacement";
import { parseSourceFile } from "../../app/lib/importers";

const path = process.argv[2];
if (!path) throw new Error("Uso: validate-workbook <HIDACA_Facturas_2021_Importacion.xlsx>");
const resolved = resolve(path);
const bytes = await readFile(resolved);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const extraction = await parseSourceFile(basename(resolved), buffer);
if (process.env.DEBUG_WORKBOOK === "1") {
  console.log(extraction.sheets[0].cells.filter((cell) => ["F2", "G2", "H2"].includes(cell.address)));
}
const parsed = await parseInvoiceReplacementWorkbook(basename(resolved), buffer);
console.log(JSON.stringify({
  workbookHash: parsed.workbookHash,
  sheets: parsed.sheetNames,
  invoices: parsed.rows.length,
  fiscalIdentities: new Set(parsed.rows.map((row) => row.normalizedNcf)).size,
  firstInvoice: parsed.rows[0]?.invoiceNumber,
  lastInvoice: parsed.rows.at(-1)?.invoiceNumber,
  issued2021: parsed.rows.slice(72).every((row) => row.issueDate.startsWith("2021-")),
  f0090Count: parsed.rows.filter((row) => row.invoiceNumber === "F-0090").length,
  formulaErrors: extraction.sheets.flatMap((sheet) =>
    sheet.cells.filter((cell) => /#(?:REF|DIV\/0|VALUE|NAME|N\/A|NUM|NULL)!?/i.test(cell.displayValue)),
  ).length,
  totals: parsed.totals,
}, null, 2));
