import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("main Cotizaciones workspace keeps legacy rows and uses the shared editor", async () => {
  const [view, editor, api] = await Promise.all([
    read("../app/app/cotizaciones-view.tsx"),
    read("../app/app/document-editor.tsx"),
    read("../app/api/quotations/route.ts"),
  ]);
  assert.match(view, /Nueva cotización/);
  assert.match(view, /Registro legacy/);
  assert.match(view, /CotizacionesReplacementPanel/);
  assert.match(view, /<DocumentEditor kind="quotation"/);
  assert.match(editor, /Guardar cotización/);
  assert.match(editor, /quotationDate: todayInputValue\(\)/);
  assert.match(view, /onPrint/);
  assert.match(view, /Imprimir/);
  assert.match(api, /export async function POST/);
  assert.match(api, /quotation_line_items/);
  assert.match(api, /quotation_financials/);
});

test("document preview exposes download, print and close actions", async () => {
  const [preview, pdf] = await Promise.all([
    read("../app/app/document-preview.tsx"),
    read("../app/lib/document-pdf.ts"),
  ]);
  for (const label of ["Descargar PDF", "Imprimir", "Cerrar"]) assert.match(preview, new RegExp(label));
  assert.match(preview, /URL\.revokeObjectURL/);
  assert.match(pdf, /StandardFonts/);
  assert.match(pdf, /COTIZACIÓN|FACTURA/);
});

test("document detail layout contains the responsive modal protections", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /\.modal-dialog \{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /\.invoice-lines-table\.responsive-table[\s\S]*?min-width: 0;/);
  assert.match(css, /\.invoice-detail-buttons/);
});
