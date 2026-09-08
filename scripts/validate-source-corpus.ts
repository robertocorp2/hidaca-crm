import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseSourceFile } from "../app/lib/importers";
import { mapHidacaExtraction } from "../app/lib/importers/hidaca-mapper";

const paths = process.argv.slice(2);
if (!paths.length) {
  throw new Error("Pass one or more read-only PDF/XLSX/XLSM/XLSB paths.");
}

const results = [];
for (const [index, path] of paths.entries()) {
  try {
    const bytes = await readFile(path);
    const arrayBuffer = Uint8Array.from(bytes).buffer;
    const extraction = await parseSourceFile(path, arrayBuffer);
    const preview = mapHidacaExtraction(path, extraction);
    results.push({
      sample: index + 1,
      extension: extname(path).toLowerCase(),
      result: "parsed",
      format: extraction.format,
      templateType: preview.templateType,
      sheets: extraction.sheets.length,
      pages: extraction.pages.length,
      lineItems: preview.lineItems.length,
      payments: preview.payments.length,
      manufacturingWorksheets: preview.manufacturing.length,
      issueTypes: [...new Set(preview.issues.map((issue) => issue.type))],
      hasBusinessName: Boolean(preview.business.name),
      hasQuotationIdentity: Boolean(preview.quotation.quotationNumber),
    });
  } catch (error) {
    results.push({
      sample: index + 1,
      extension: extname(path).toLowerCase(),
      result: "retained_failure",
      errorType: error instanceof Error ? error.name : "Error",
    });
  }
}

console.log(JSON.stringify(results, null, 2));
