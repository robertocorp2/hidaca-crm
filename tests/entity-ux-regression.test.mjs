import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("shared CRM primitives expose accessible state and modal affordances", async () => {
  const ui = await source("app/app/ui.tsx");
  for (const primitive of [
    "PageHeader",
    "RecordHeader",
    "RecordActions",
    "RecordField",
    "SectionCard",
    "RelatedTabs",
    "RelatedListItem",
    "DocumentRow",
    "EmptyState",
    "LoadingState",
    "ErrorState",
    "OverflowMenu",
  ]) {
    assert.match(ui, new RegExp(`export function ${primitive}`));
  }
  assert.match(ui, /aria-describedby/);
  assert.match(ui, /previous\?\.focus\(\)/);
  assert.match(ui, /event\.key === "Escape"/);
});

test("Empresas and Contactos share the modern list/detail/form building blocks", async () => {
  const views = await source("app/app/entity-views.tsx");
  for (const primitive of [
    "PageHeader",
    "RecordHeader",
    "RecordField",
    "RelatedTabs",
    "DocumentRow",
    "OverflowMenu",
    "Modal",
  ]) {
    assert.match(views, new RegExp(`\\b${primitive}\\b`));
  }
  assert.match(views, /setSelectedId\(business\.id\)/);
  assert.match(views, /setSelectedId\(contact\.id\)/);
  assert.match(views, /\/api\/businesses\/\$\{encodeURIComponent\(selected\.id\)\}/);
  assert.match(views, /\/api\/contacts\/\$\{encodeURIComponent\(selected\.id\)\}/);
});

test("detail endpoints preserve old keys and add only FK-backed relations", async () => {
  const businessRoute = await source("app/api/businesses/[id]/route.ts");
  const contactRoute = await source("app/api/contacts/[id]/route.ts");
  assert.match(businessRoute, /business,\s*contacts:/s);
  assert.match(businessRoute, /invoices/);
  assert.match(contactRoute, /contact, projects, opportunities, quotations, invoices, documents, history/);
  assert.match(contactRoute, /o\.primary_contact_id = \?/);
  assert.match(contactRoute, /FROM invoices WHERE contact_id = \?/);
  assert.match(businessRoute, /cache-control.*private, no-store/);
  assert.match(contactRoute, /cache-control.*private, no-store/);
});

test("shared foundation includes semantic HIDACA tokens and reduced motion", async () => {
  const css = await source("app/globals.css");
  for (const token of ["--color-primary", "--color-accent", "--space-1", "--space-6", "--control-height", "--focus-ring"]) {
    assert.match(css, new RegExp(token.replaceAll("-", "\\-")));
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /document-row-copy/);
  assert.match(css, /overflow-menu/);
});
