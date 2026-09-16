import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("appearance choice controls opt out of text-input sizing", async () => {
  const [ui, usersAdmin, agenda, aiSettings, opportunities, prospecting, css] = await Promise.all([
    read("app/app/ui.tsx"),
    read("app/app/users-admin-view.tsx"),
    read("app/app/agenda-view.tsx"),
    read("app/app/ai-settings-view.tsx"),
    read("app/app/opportunities-view.tsx"),
    read("app/app/prospecting/prospecting-client.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(ui, /className="choice-control"/);
  assert.match(ui, /className="choice-control"[\s\S]*type="radio"/);
  for (const source of [usersAdmin, agenda, aiSettings, opportunities, prospecting]) {
    assert.equal(
      source.match(/type="(?:radio|checkbox)"/g)?.length,
      source.match(/className="choice-control"/g)?.length,
    );
  }
  assert.match(css, /\.choice-control\s*\{[\s\S]*appearance:\s*auto;[\s\S]*min-height:\s*0;[\s\S]*width:\s*18px;/);
  assert.match(css, /\.choice-control:focus-visible\s*\{/);
  assert.doesNotMatch(css, /input\[type="radio"\],\s*input\[type="checkbox"\]\s*\{/);
});
