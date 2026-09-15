import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("company detail exposes server timing and payload diagnostics", async () => {
  const route = await read("../app/api/businesses/[id]/route.ts");
  assert.match(route, /measureQuery/);
  assert.match(route, /server-timing/);
  assert.match(route, /x-hidaca-detail-duration-ms/);
  assert.match(route, /x-hidaca-detail-payload-bytes/);
  assert.match(route, /measureQuery\(queryTimings, "business"/);
  for (const name of ["contacts", "projects", "opportunities", "quotations", "invoices", "payments", "addresses", "documents", "sourceDocuments", "cases", "history"]) {
    assert.match(route, new RegExp(`query(?:Many|Twice)?\\(\\"${name}\\"`));
  }
});

test("company detail records client request and first-content milestones", async () => {
  const workspace = await read("../app/app/record-workspace.tsx");
  assert.match(workspace, /hidaca-record-\$\{kind\}-\$\{record\.id\}/);
  assert.match(workspace, /-request-start/);
  assert.match(workspace, /-data-ready/);
  assert.match(workspace, /-time-to-first-content/);
  assert.match(workspace, /performance\.measure/);
});
