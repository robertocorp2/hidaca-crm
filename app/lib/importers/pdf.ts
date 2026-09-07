import type { ExtractedPage, ImportExtraction } from "./types";

const MAX_FILE_SIZE = 32 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_PAGE_TEXT = 200_000;

function ensureMathSumPrecise() {
  const target = Math as Math & {
    sumPrecise?: (values: Iterable<number>) => number;
  };
  if (target.sumPrecise) return;
  target.sumPrecise = (values) => {
    let sum = 0;
    let correction = 0;
    for (const value of values) {
      const adjusted = value - correction;
      const next = sum + adjusted;
      correction = next - sum - adjusted;
      sum = next;
    }
    return sum;
  };
}

export async function parsePdf(bytes: ArrayBuffer): Promise<ImportExtraction> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_SIZE) {
    throw new Error("El archivo debe tener entre 1 byte y 32 MB.");
  }
  ensureMathSumPrecise();
  const { extractText, getDocumentProxy } = await import("unpdf");
  let result: Awaited<ReturnType<typeof extractText>>;
  try {
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    result = await extractText(proxy, { mergePages: false });
  } catch (error) {
    throw new Error(
      `No se pudo extraer el PDF: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const warnings: string[] = [];
  const rawPages = Array.isArray(result.text) ? result.text : [result.text];
  if (result.totalPages > MAX_PAGES) {
    warnings.push(
      `El PDF contiene ${result.totalPages} páginas; se inspeccionaron ${MAX_PAGES}.`,
    );
  }
  const pages: ExtractedPage[] = rawPages
    .slice(0, MAX_PAGES)
    .map((text, index) => {
      const value = String(text ?? "");
      if (value.length > MAX_PAGE_TEXT) {
        warnings.push(
          `Página ${index + 1}: el texto se limitó a ${MAX_PAGE_TEXT} caracteres.`,
        );
      }
      return {
        pageNumber: index + 1,
        text: value.slice(0, MAX_PAGE_TEXT),
      };
    });

  return {
    format: "pdf",
    parserName: "unpdf",
    parserVersion: "1",
    sheets: [],
    pages,
    hasMacros: false,
    partial: warnings.length > 0,
    warnings,
  };
}
