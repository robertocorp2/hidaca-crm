import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("company detail exposes safe server timing and payload metrics", async () => {
  const [route, workspace, docs] = await Promise.all([
    read("app/api/businesses/[id]/route.ts"),
    read("app/app/record-workspace.tsx"),
    read("docs/COMPANY-DETAIL-PERFORMANCE.md"),
  ]);

  assert.match(route, /const queryDurations: number\[\] = \[\];/);
  assert.match(route, /"server-timing"/);
  assert.match(route, /"x-hidaca-payload-bytes"/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(route, /queryDurations\.reduce/);
  assert.match(workspace, /performance\.mark\(\x60\$\{timingName\}:data-ready\x60/);
  assert.match(workspace, /performance\.measure\(\x60\$\{timingName\}:request\x60/);
  assert.match(workspace, /performance\.measure\(\x60\$\{timingName\}:render\x60/);
  assert.match(workspace, /x-hidaca-payload-bytes/);
  assert.match(docs, /Capture server timing, payload bytes, browser milestones/);
});
