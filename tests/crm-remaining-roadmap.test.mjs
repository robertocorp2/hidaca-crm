import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("record actions associate new activities and respect agenda permissions", async () => {
  const workspace = await source("app/app/record-workspace.tsx");
  const shell = await source("app/app/operations-client.tsx");
  const agenda = await source("app/app/agenda-view.tsx");
  assert.match(workspace, /canCreateActivity/);
  assert.match(workspace, /onCreateActivity\(recordType, recordId\)/);
  assert.match(shell, /pendingActivityContext/);
  assert.match(shell, /agenda\.create/);
  assert.match(agenda, /initialCreateContext/);
  assert.match(agenda, /relatedId/);
});

test("timeline combines lifecycle, history, activities and related timestamps with deduplication", async () => {
  const workspace = await source("app/app/record-workspace.tsx");
  assert.match(workspace, /lifecycle-created-/);
  assert.match(workspace, /lifecycle-updated-/);
  assert.match(workspace, /relationLabels/);
  assert.match(workspace, /sort\(\(left, right\) => right\.date\.localeCompare\(left\.date\)\)/);
  assert.match(workspace, /const seen = new Set/);
});

test("business and contact collections expose URL-backed column filters", async () => {
  const entities = await source("app/app/entity-views.tsx");
  const ui = await source("app/app/ui.tsx");
  assert.match(entities, /useColumnFilters\("businesses"/);
  assert.match(entities, /useColumnFilters\("contacts"/);
  assert.match(entities, /ColumnFilterPopover/);
  assert.match(ui, /filter_\$\{namespace\}_\$\{definition\.key\}/);
  assert.match(ui, /params\.delete\("page"\)/);
});

test("generic collections support sortable filters and page-size options", async () => {
  const shell = await source("app/app/operations-client.tsx");
  const ui = await source("app/app/ui.tsx");
  assert.match(shell, /genericFilterDefinitions/);
  assert.match(shell, /onColumnFilter/);
  assert.match(shell, /ColumnFilterPopover/);
  assert.match(ui, /pageSizeOptions = \["10", "25", "50", "100", "all"\]/);
  assert.match(ui, /Todos/);
});

test("font preference remains local, allowlisted and resettable", async () => {
  const ui = await source("app/app/ui.tsx");
  assert.match(ui, /hidaca:font-family/);
  assert.match(ui, /fontChoices\.some/);
  assert.match(ui, /Restablecer/);
});

test("e-CF remains explicitly blocked until official schemas and credentials are configured", async () => {
  const docs = await source("docs/ecf/README.md");
  const route = await source("app/api/ecf/[id]/route.ts");
  assert.match(docs, /Producción bloqueada/);
  assert.match(docs, /Validación real con XSD/);
  assert.match(route, /CERTIFICATE_NOT_CONFIGURED|DGII_SERVICE_NOT_CONFIGURED/);
});
