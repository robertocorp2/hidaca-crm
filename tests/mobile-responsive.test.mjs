import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shell = await readFile(new URL("../app/app/operations-client.tsx", import.meta.url), "utf8");
const editor = await readFile(new URL("../app/app/document-editor.tsx", import.meta.url), "utf8");

test("mobile navigation exposes quick access and preserves permission filtering", () => {
  assert.match(shell, /className="mobile-bottom-nav"/);
  assert.match(shell, /items={mobileQuickViews}/);
  assert.match(shell, /onMore=\{\(\) => setMobileNav\(true\)\}/);
  assert.match(shell, /permissions\[permissionModule\]\.view/);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*safe-area-inset-bottom/);
});

test("mobile modal and form actions use dynamic viewport sizing and safe areas", () => {
  assert.match(css, /max-height: calc\(100dvh/);
  assert.match(css, /\.modal-dialog \.form-actions[\s\S]*position: sticky/);
  assert.match(css, /\.modal-dialog \.form-actions[\s\S]*safe-area-inset-bottom/);
  assert.match(css, /\.mobile-current-module[\s\S]*text-overflow: ellipsis/);
});

test("primary mobile tables and document line items reflow without page overflow", () => {
  assert.match(css, /\.responsive-table tr[\s\S]*border-radius: 12px/);
  assert.match(css, /\.responsive-table td[\s\S]*min-width: 0/);
  assert.match(css, /\.invoice-line-editor-row[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(editor, /className="invoice-line-editor-row"/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("mobile presentation preserves desktop layout boundary", () => {
  assert.match(css, /@media \(min-width: 761px\)[\s\S]*\.mobile-bottom-nav[\s\S]*display: none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.workspace[\s\S]*padding: 28px 18px/);
});
