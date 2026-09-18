import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const users = await readFile(new URL("../app/app/users-admin-view.tsx", import.meta.url), "utf8");

test("users editor tabs expose linked panels and keyboard navigation", () => {
  assert.match(users, /aria-label="Editor de usuario"[\s\S]*role="tablist"/);
  assert.match(users, /aria-controls=\{panelIds\.general\}[\s\S]*id=\{tabIds\.general\}[\s\S]*role="tab"/);
  assert.match(users, /aria-controls=\{panelIds\.permissions\}[\s\S]*id=\{tabIds\.permissions\}[\s\S]*role="tab"/);
  assert.match(users, /aria-labelledby=\{tabIds\.general\}[\s\S]*id=\{panelIds\.general\}[\s\S]*role="tabpanel"/);
  assert.match(users, /aria-labelledby=\{tabIds\.permissions\}[\s\S]*id=\{panelIds\.permissions\}[\s\S]*role="tabpanel"/);
  assert.match(users, /hidden=\{tab !== "general"\}/);
  assert.match(users, /hidden=\{tab !== "permissions"\}/);
});

test("users editor tabs support standard keyboard focus and activation", () => {
  assert.match(users, /event\.key === "ArrowRight"/);
  assert.match(users, /event\.key === "ArrowLeft"/);
  assert.match(users, /event\.key === "Home"/);
  assert.match(users, /event\.key === "End"/);
  assert.match(users, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(users, /tabIndex=\{tab === "general" \? 0 : -1\}/);
  assert.match(users, /tabIndex=\{tab === "permissions" \? 0 : -1\}/);
});
