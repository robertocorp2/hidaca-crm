import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("invoice replacement exposes separate admin preview and commit endpoints", async () => {
  const [preview, commit, service, parser] = await Promise.all([
    read("../app/api/imports/invoices/replace/preview/route.ts"),
    read("../app/api/imports/invoices/replace/commit/route.ts"),
    read("../app/lib/invoice-replacement-service.ts"),
    read("../app/lib/invoice-replacement.ts"),
  ]);
  assert.match(preview, /authorizeInvoiceApi\(\{ module: "importaciones", write: true, admin: true \}\)/);
  assert.match(commit, /authorizeInvoiceApi\(\{ module: "importaciones", write: true, admin: true \}\)/);
  assert.doesNotMatch(preview, /\.batch\(|\.put\(|\.delete\(/);
  assert.match(commit, /invoiceReplacementConfirmation/);
  assert.match(service, /await preflight\(input\.parsed\)/);
  assert.match(service, /expectedStateFingerprint/);
  assert.match(service, /getD1\(\)\.batch\(statements\)/);
  assert.match(service, /source = 'invoice_replace'/);
  assert.match(service, /idempotent: true/);
  assert.match(service, /DELETE FROM business_records WHERE module = 'facturas'/);
  assert.match(service, /b\.source = 'invoice_import'/);
  assert.match(service, /b\.source <> 'invoice_replace'/);
  assert.match(service, /invoice_lines/);
  assert.match(service, /payment_allocations/);
  assert.match(service, /credit_note_applications/);
  assert.match(service, /combined_register/);
  assert.match(parser, /invoiceReplacementCount = 92/);
  assert.match(parser, /Fecha no es una fecha real de Excel/);
});

test("the admin UI requires preview and an explicit irreversible confirmation", async () => {
  const [panel, imports] = await Promise.all([
    read("../app/app/invoice-replacement-panel.tsx"),
    read("../app/app/imports-view.tsx"),
  ]);
  assert.match(panel, /Previsualizar reemplazo/);
  assert.match(panel, /REEMPLAZAR FACTURAS 2021/);
  assert.match(panel, /purga es irreversible y no crea respaldo/);
  assert.match(panel, /stateFingerprint/);
  assert.match(panel, /workbookHash/);
  assert.match(imports, /isAdmin &&/);
  assert.match(imports, /InvoiceReplacementPanel/);
});
