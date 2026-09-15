import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("shared button primitives expose the canonical variant and size contract", async () => {
  const [ui, css, docs, workspace, showcase] = await Promise.all([
    read("../app/app/ui.tsx"),
    read("../app/globals.css"),
    read("../docs/BUTTONS.md"),
    read("../app/app/record-workspace.tsx"),
    read("../app/app/design-system-showcase.tsx"),
  ]);

  assert.match(ui, /export function Button/);
  assert.match(ui, /export function IconButton/);
  for (const variant of ["primary", "secondary", "danger", "ghost", "text"]) {
    assert.match(ui, new RegExp(`${variant}: "${variant}-button"`));
  }
  assert.match(ui, /label: string/);
  assert.match(css, /\.button-size-sm[\s\S]*min-height: 34px/);
  assert.match(css, /\.button-size-lg[\s\S]*min-height: 48px/);
  assert.match(css, /\.icon-button\.button-size-sm[\s\S]*width: 34px/);
  assert.match(css, /\.primary-button:focus-visible[\s\S]*\.icon-button:focus-visible/);
  assert.match(docs, /\| Plus \|/);
  assert.match(docs, /\| Overflow \|/);
  assert.match(workspace, /<Button onClick=\{onEdit\} size="sm">/);
  assert.match(showcase, /<IconButton className="ds-icon-button" label="Abrir menú"/);
});
