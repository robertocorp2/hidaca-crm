import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("invoice list exposes the accounting register columns, search and sorting", async () => {
  const [view, api] = await Promise.all([
    read("../app/app/invoice-view.tsx"),
    read("../app/api/invoices/route.ts"),
  ]);
  for (const label of [
    "Fecha", "Factura", "NCF", "Cliente / Empresa", "Sub-Total", "ITBIS",
    "Total", "Estado",
  ]) assert.match(view, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(view, /Buscar por factura, NCF, cliente o RNC/);
  assert.match(view, /type SortKey = "issueDate" \| "invoiceNumberRaw" \| "businessName" \| "totalAmount"/);
  assert.match(api, /b\.rnc LIKE/);
  assert.match(api, /i\.subtotal_amount AS subtotalAmount/);
  assert.match(api, /i\.tax_amount AS taxAmount/);
});

test("invoice editor uses the shared line-item order and actions", async () => {
  const [view, shared, createApi, updateApi] = await Promise.all([
    read("../app/app/invoice-view.tsx"),
    read("../app/app/document-editor.tsx"),
    read("../app/api/invoices/route.ts"),
    read("../app/api/invoices/[id]/route.ts"),
  ]);
  for (const label of [
    "Condiciones de pago", "NCF", "Vencimiento", "Contacto", "Conceptos",
    "Descripción", "Cantidad", "Ancho", "Altura", "Área", "Precio",
    "Descuento", "Cargo adicional", "Avance / pagado",
  ]) assert.match(shared, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(shared, /Agregar/);
  assert.match(shared, /Duplicar/);
  assert.doesNotMatch(shared, /label="Código"/);
  assert.doesNotMatch(shared, /label="Ubicación"/);
  assert.match(view, /<DocumentEditor kind="invoice"/);
  assert.match(view, /className="responsive-table invoice-table"/);
  assert.match(view, /Imprimir/);
  assert.match(shared, /inputMode="numeric" type="number" min="1" step="1"/);
  assert.match(shared, /issueDate: todayInputValue\(\)/);
  assert.match(createApi, /quantity: calculated\.quantity/);
  assert.match(updateApi, /quantity: calculatedLine\.quantity/);
});
