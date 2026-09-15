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

  assert.match(ui, /className="choice-control"/);
  assert.match(ui, /className="choice-control"[\s\S]*type="radio"/);
  assert.match(css, /input\[type="radio"\],\s*input\[type="checkbox"\][\s\S]*appearance:\s*auto;[\s\S]*min-height:\s*0;[\s\S]*width:\s*18px;/);
  assert.match(css, /input\[type="radio"\]:focus-visible,\s*input\[type="checkbox"\]:focus-visible/);
});
