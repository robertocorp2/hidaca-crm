import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../design-system/", import.meta.url);
const appRoot = new URL("../app/", import.meta.url);

test("design system contract includes tokens, component and pattern references", async () => {
  const tokens = JSON.parse(
    await readFile(new URL("tokens.json", root), "utf8"),
  );
  assert.equal(tokens.name, "HIDACA Operaciones design tokens");
  assert.equal(tokens.color.brand.primary.value, "#0c6747");
  assert.equal(tokens.space.md.value, "16px");
  assert.equal(tokens.breakpoint.compact.value, "760px");
  for (const file of [
    "DESIGN_SYSTEM.md",
    "typography.md",
    "spacing.md",
    "icons.md",
    "components/inventory.md",
    "components/record-workspace.md",
    "patterns/list-pages.md",
    "patterns/record-detail.md",
    "patterns/responsive.md",
    "references/source-inventory.md",
  ]) {
    await access(new URL(file, root));
  }
});

test("showcase is development-only and reuses approved UI primitives", async () => {
  const route = await readFile(
    new URL("design-system/page.tsx", appRoot),
    "utf8",
  );
  const showcase = await readFile(
    new URL("app/design-system-showcase.tsx", appRoot),
    "utf8",
  );
  assert.match(route, /process\.env\.NODE_ENV === "production"/);
  assert.match(route, /notFound\(\)/);
  for (const primitive of [
    "PageHeader",
    "Modal",
    "Empty",
    "LoadingState",
    "ErrorState",
    "StatusBadge",
    "Pagination",
    "ActivityTimeline",
  ]) {
    assert.match(showcase, new RegExp(`\\b${primitive}\\b`));
  }
  assert.match(showcase, /lucide-react/);
  assert.doesNotMatch(showcase, /[⌕⌄×↑↓↕▧—]/u);
});
