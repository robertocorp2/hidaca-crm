import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canWriteDocuments,
  documentReadOnlyResponse,
} from "../app/lib/document-authorization";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("document roles allow operators to create and edit while viewers remain read-only", () => {
  assert.equal(canWriteDocuments("admin"), true);
  assert.equal(canWriteDocuments("operator"), true);
  assert.equal(canWriteDocuments("viewer"), false);
  assert.equal(documentReadOnlyResponse().status, 403);
});

test("document APIs use centralized module actions and keep admin-only surfaces", async () => {
  const [invoiceApi, quoteCreate, quoteUpdate, users, replacement] = await Promise.all([
    read("../app/lib/invoice-api.ts"),
    read("../app/api/quotations/route.ts"),
    read("../app/api/quotations/[id]/route.ts"),
    read("../app/api/users/route.ts"),
    read("../app/api/cotizaciones/replace/route.ts"),
  ]);

  assert.match(invoiceApi, /authorizeApi\(\{/);
  assert.match(invoiceApi, /module: options\?\.module \?\? "facturas"/);
  assert.match(quoteCreate, /module: "cotizaciones", action: "create"/);
  assert.match(quoteUpdate, /module: "cotizaciones", action: "edit"/);
  assert.match(users, /module: "usuarios", action: "create"/);
  assert.match(replacement, /module: "cotizaciones", action: "administer"/);
});

test("document write errors identify the field that needs correction", async () => {
  const [invoiceCreate, invoiceUpdate, quoteCreate, quoteUpdate] = await Promise.all([
    read("../app/api/invoices/route.ts"),
    read("../app/api/invoices/[id]/route.ts"),
    read("../app/api/quotations/route.ts"),
    read("../app/api/quotations/[id]/route.ts"),
  ]);

  for (const source of [invoiceCreate, invoiceUpdate, quoteCreate, quoteUpdate]) {
    assert.match(source, /field:/);
    assert.match(source, /field: "lines"/);
    assert.match(source, /status: 400/);
  }
  assert.match(invoiceCreate, /ncfRaw/);
  assert.match(invoiceUpdate, /ncfRaw/);
  assert.match(quoteCreate, /quotationNumber/);
  assert.match(quoteUpdate, /quotationNumber/);
  assert.match(invoiceCreate, /status: 409/);
  assert.match(quoteCreate, /status: 409/);
  assert.match(invoiceCreate, /Response\.json\(\{ invoice \}, \{ status: 201 \}\)/);
  assert.match(quoteCreate, /status: 201/);
  assert.match(invoiceUpdate, /Response\.json\(\{ invoice \}\)/);
  assert.match(quoteUpdate, /quotationId/);
});
