import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCodexPrompt,
  buildCssDiff,
  buildTokenDiff,
  createTokenChanges,
  flattenTokenDocument,
  readStoredDraft,
  tokenValues,
  validateTokenValue,
} from "../app/app/design-system-token-utils.ts";

const root = new URL("../../design-system/tokens.json", import.meta.url);
const appRoot = new URL("../app/", import.meta.url);
const tokenDocument = JSON.parse(await readFile(root, "utf8"));
const leaves = flattenTokenDocument(tokenDocument);

test("token editor flattens every canonical value and preserves its category", () => {
  assert.equal(leaves.length, 76);
  assert.equal(leaves[0].path, "color.brand.forest");
  assert.equal(leaves.find((leaf) => leaf.path === "zIndex.modal").inputKind, "integer");
  assert.equal(leaves.find((leaf) => leaf.path === "motion.fast").inputKind, "duration");
});

test("token changes, validation, and reset-safe draft loading are deterministic", () => {
  const defaults = tokenValues(leaves);
  const changed = { ...defaults, "color.brand.primary": "#123456", "zIndex.modal": "101" };
  const changes = createTokenChanges(leaves, changed);
  assert.deepEqual(changes.map((change) => change.path), ["color.brand.primary", "zIndex.modal"]);
  assert.equal(validateTokenValue(leaves.find((leaf) => leaf.path === "zIndex.modal"), "10.5"), "Usa un número entero.");
  assert.equal(validateTokenValue(leaves.find((leaf) => leaf.path === "space.md"), "16px"), null);
  assert.match(buildTokenDiff(changes), /@@ color\.brand\.primary @@/);
  assert.match(buildCssDiff(changes), /--green-700/);
  assert.match(buildCssDiff(changes), /zIndex\.modal/);

  const storage = new Map([["editor", JSON.stringify({ version: "0.9.0", values: changed })]]);
  const fakeStorage = { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) };
  const draft = readStoredDraft(fakeStorage, "editor", tokenDocument.version, defaults);
  assert.equal(draft.discarded, true);
  assert.deepEqual(draft.values, defaults);
});

test("Codex output includes exact changes, constraints, and validation commands", () => {
  const defaults = tokenValues(leaves);
  const changes = createTokenChanges(leaves, { ...defaults, "typography.size.xl": "26px" });
  const prompt = buildCodexPrompt(tokenDocument, changes);
  assert.match(prompt, /typography\.size\.xl/);
  assert.match(prompt, /design-system\/tokens\.json/);
  assert.match(prompt, /npm run typecheck/);
  assert.match(prompt, /1440×900/);
});

test("editor route is development-only and uses the canonical token document", async () => {
  const route = await readFile(new URL("design-system/editor/page.tsx", appRoot), "utf8");
  assert.match(route, /process\.env\.NODE_ENV === "production"/);
  assert.match(route, /notFound\(\)/);
  assert.match(route, /tokens\.json/);
  assert.match(route, /DesignSystemTokenEditor/);
});
