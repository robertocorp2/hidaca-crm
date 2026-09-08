import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("shared CRM workspace exposes the modern record primitives", async () => {
  const [workspace, ui, css] = await Promise.all([
    read("../app/app/record-workspace.tsx"),
    read("../app/app/ui.tsx"),
    read("../app/globals.css"),
  ]);

  for (const marker of [
    "RecordHeader",
    "RecordActions",
    "RecordTabs",
    "RecordPropertyList",
    "RecordQuickSummary",
    "RelationshipEmptyState",
    "ActivityTimeline",
    "RelatedRecordSection",
    "aria-haspopup=\"menu\"",
    "ArrowRight",
  ]) {
    assert.match(workspace, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
  for (const marker of ["PageHeader", "LoadingState", "ErrorState", "DocumentRow", "ColumnFilterPopover", "useColumnFilters", "AppearancePreferences", "AutocompleteInput", "PageSizeControl", "ActiveFilterChip", "FilterableStatus", "SortHeader"]) {
    assert.match(ui, new RegExp(`export function ${marker}`));
  }
  assert.match(ui, /export const fontChoices/);
  for (const marker of [
    "--color-primary",
    "--space-6",
    ".compact-action",
    ".record-action-menu-popover",
    ".record-quick-summary",
    ".relationship-empty-state",
    ".record-recent-activity",
    ".document-row",
    "prefers-reduced-motion",
  ]) {
    assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
});

test("authenticated collections share autocomplete, page sizing, URL filters and localized status interactions", async () => {
  const [projects, leads, opportunities, agenda, operations, users, css] = await Promise.all([
    read("../app/app/projects-view.tsx"),
    read("../app/app/leads-view.tsx"),
    read("../app/app/opportunities-view.tsx"),
    read("../app/app/agenda-view.tsx"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/users-admin-view.tsx"),
    read("../app/globals.css"),
  ]);

  for (const source of [projects, leads, opportunities, agenda, operations, users]) {
    assert.match(source, /AutocompleteInput/);
    assert.match(source, /PageSizeControl/);
    assert.match(source, /useUrlState\("q"/);
  }
  for (const source of [projects, leads, opportunities, agenda, operations, users]) {
    assert.match(source, /FilterableStatus/);
  }
  for (const source of [projects, leads, opportunities]) {
    assert.match(source, /SortHeader/);
    assert.match(source, /useUrlState\("dir"/);
  }
  assert.match(operations, /En progreso/);
  assert.match(projects, /projectStatusLabels/);
  assert.match(css, /Site-wide collection language/);
  assert.match(css, /\.collection-table/);
  assert.match(css, /\.active-filter-row/);
});

test("Empresa and Contacto lists share the same page header and form language", async () => {
  const source = await read("../app/app/entity-views.tsx");
  assert.equal((source.match(/<PageHeader/g) ?? []).length, 2);
  assert.match(source, /record-form-grid/);
  assert.match(source, /list-view-panel/);
  assert.match(source, /Nuevo contacto/);
  assert.match(source, /Nueva empresa/);
});
