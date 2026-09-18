import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("appearance choice controls opt out of text-input sizing", async () => {
  const [ui, css] = await Promise.all([
    read("app/app/ui.tsx"),
    read("app/globals.css"),
  ]);
  const normalizedCss = css.replaceAll("\r\n", "\n");

  assert.match(ui, /className="choice-control"/);
  assert.match(ui, /className="choice-control"[\s\S]*type="radio"/);
  const textControlRule = normalizedCss.indexOf("input,\nselect,\ntextarea {\n  background: white;");
  const choiceControlRule = normalizedCss.indexOf('input[type="radio"],\ninput[type="checkbox"] {');
  assert.ok(textControlRule >= 0, "text/select/textarea sizing rule should remain explicit");
  assert.ok(choiceControlRule >= 0, "choice controls should have a dedicated rule");
  assert.match(normalizedCss.slice(textControlRule, textControlRule + 300), /min-height: 42px;[\s\S]*padding: 9px 11px;[\s\S]*width: 100%;/);
  assert.match(css, /input\[type="radio"\],\s*input\[type="checkbox"\][\s\S]*appearance:\s*auto;[\s\S]*min-height:\s*0;[\s\S]*width:\s*18px;/);
  assert.match(css, /input\[type="radio"\]:focus-visible,\s*input\[type="checkbox"\]:focus-visible/);
});
