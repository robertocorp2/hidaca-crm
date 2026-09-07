import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Empresa and Contacto detail APIs resolve direct, inherited, and source documents", async () => {
  const business = await source("app/api/businesses/[id]/route.ts");
  const contact = await source("app/api/contacts/[id]/route.ts");
  for (const text of [business, contact]) {
    assert.match(text, /document_links/);
    assert.match(text, /source_references/);
    assert.match(text, /mergedDocuments/);
    assert.match(text, /originalUri/);
  }
  assert.match(business, /source_document_id/);
  assert.match(contact, /quotation_revisions/);
});

test("stored documents support safe inline previews while retaining downloads", async () => {
  const route = await source("app/api/documents/[id]/route.ts");
  const preview = await source("app/app/document-preview.tsx");
  assert.match(route, /disposition/);
  assert.match(route, /application\/pdf/);
  assert.match(route, /startsWith\("image\/"\)/);
  assert.match(preview, /StoredDocumentPreviewModal/);
  assert.match(preview, /Abrir en otra pestaña/);
});

test("accepted quotation conversion is permissioned, URL-addressable, and warns about repeat billing", async () => {
  const draftRoute = await source("app/api/quotations/[id]/invoice-draft/route.ts");
  const invoiceRoute = await source("app/api/invoices/route.ts");
  const invoiceView = await source("app/app/invoice-view.tsx");
  const quotationView = await source("app/app/cotizaciones-view.tsx");
  assert.match(draftRoute, /authorizeInvoiceApi\(\{ write: true, action: "create" \}\)/);
  assert.match(draftRoute, /text\(quotation\.status\) !== "accepted"/);
  assert.match(draftRoute, /existingInvoices/);
  assert.match(invoiceRoute, /quotationConversion/);
  assert.match(invoiceRoute, /quotation\.status !== "accepted"/);
  assert.doesNotMatch(invoiceView, /Desde cotización/);
  assert.doesNotMatch(invoiceView, /quotation-picker/);
  assert.match(invoiceView, /fromQuotationId/);
  assert.match(invoiceView, /Esta cotización ya tiene facturas/);
  assert.match(quotationView, /Convertir a factura/);
  assert.match(quotationView, /accepted/);
  assert.match(quotationView, /canCreateInvoice/);
  assert.match(quotationView, /Facturas vinculadas/);
});

test("related invoice and quotation links preserve SPA navigation with normal-link fallback", async () => {
  const workspace = await source("app/app/record-workspace.tsx");
  const invoice = await source("app/app/invoice-view.tsx");
  assert.match(workspace, /\/api\/documents/);
  assert.match(workspace, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey/);
  assert.match(invoice, /view=cotizaciones&record=/);
  assert.match(invoice, /onNavigate\("cotizaciones"/);
});
