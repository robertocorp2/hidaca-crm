import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("invoice APIs share the disabled feature gate and module-aware authorization", async () => {
  const api = await read("../app/lib/invoice-api.ts");
  assert.match(api, /isInvoiceImportPhase1Enabled/);
  assert.match(api, /status:\s*404/);
  assert.match(api, /PermissionModuleKey/);
  assert.match(api, /action: options\?\.action/);
  assert.match(api, /"administer"/);
  for (const path of [
    "../app/api/invoices/route.ts",
    "../app/api/payments/route.ts",
    "../app/api/credit-notes/route.ts",
    "../app/api/receivables/route.ts",
    "../app/api/collection-activities/route.ts",
  ]) {
    assert.match(await read(path), /authorizeInvoiceApi/);
  }
});

test("dry run, acceptance, reconciliation, reversal, and production controls are distinct", async () => {
  const dryRun = await read(
    "../app/api/imports/invoices/dry-run/route.ts",
  );
  const engine = await read("../app/lib/importers/invoice.ts");
  const acceptance = await read(
    "../app/api/imports/[id]/accept-invoices/route.ts",
  );
  const reversal = await read("../app/api/imports/[id]/reverse/route.ts");
  const promotion = await read("../app/api/imports/[id]/promote/route.ts");
  assert.match(dryRun, /source_hash = \?/);
  assert.match(dryRun, /dry_run = 1/);
  assert.match(dryRun, /sha256 = \? AND status <> 'failed'/);
  assert.match(dryRun, /normalized_rnc AS rnc_normalized/);
  assert.match(dryRun, /winnerTotal - candidateTotal\) > 0\.02/);
  assert.match(dryRun, /isInvoiceSpreadsheetExtension/);
  assert.match(dryRun, /extension === "\.xlsx"/);
  assert.match(dryRun, /extension === "\.xlsm"/);
  assert.match(dryRun, /extension === "\.xlsb"/);
  assert.match(dryRun, /isMultipartFile/);
  assert.match(dryRun, /\[\.\.\.form\.values\(\)\]\.filter\(isMultipartFile\)/);
  assert.doesNotMatch(dryRun, /instanceof File/);
  assert.match(dryRun, /extension === "\.pdf"/);
  assert.match(dryRun, /export async function POST/);
  assert.doesNotMatch(dryRun, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.match(engine, /invoice_register/);
  assert.match(acceptance, /ACEPTAR PILOTO/);
  assert.match(acceptance, /getD1\(\)\.batch\(statements\)/);
  assert.match(acceptance, /payment_evidence/);
  assert.match(reversal, /REVERTIR LOTE/);
  assert.match(reversal, /archived_at/);
  assert.match(promotion, /INVOICE_PRODUCTION_IMPORT_ENABLED|isInvoiceProductionImportEnabled/);
  assert.match(promotion, /IMPORTAR PRODUCCION/);
  assert.match(promotion, /backupId/);
  assert.match(promotion, /changeWindow/);
});

test("Spanish billing and invoice review surfaces expose normalized modules", async () => {
  const billing = await read("../app/app/billing-view.tsx");
  const review = await read("../app/app/invoice-import-review.tsx");
  const shell = await read("../app/app/operations-client.tsx");
  const imports = await read("../app/app/imports-view.tsx");
  for (const label of [
    "Facturas",
    "Pagos y asignaciones",
    "Notas de crédito",
    "Cuentas por cobrar",
    "Gestión de cobranza",
  ]) {
    assert.match(billing, new RegExp(label));
  }
  assert.match(review, /Aceptar piloto/);
  assert.match(review, /Avance y Pendiente nunca/);
  assert.match(shell, /invoiceFeatureEnabled/);
  assert.match(imports, /accept="\.xlsx,\.xlsm,\.xlsb"/);
});
