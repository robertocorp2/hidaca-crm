import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("unknown routes have a branded Spanish recovery page", async () => {
  const page = await read("../app/not-found.tsx");
  assert.match(page, /Página no encontrada/);
  assert.match(page, /href=\"\/\"/);
  assert.match(page, /aria-labelledby=\"not-found-title\"/);
});

test("admin user editor exposes stable field metadata", async () => {
  const page = await read("../app/app/users-admin-view.tsx");
  for (const name of ["name", "email", "role", "status", "permissionSearch"]) {
    assert.match(page, new RegExp(`name=\\"${name}\\"`));
  }
  assert.match(page, /autoComplete=\"name\"/);
  assert.match(page, /autoComplete=\"email\"/);
  assert.match(page, /autoComplete=\"off\"/);
});

test("dashboard receivables use normalized balances and expose a summary endpoint", async () => {
  const [financials, route, page, client] = await Promise.all([
    read("../app/lib/dashboard-financials.ts"),
    read("../app/api/receivables/route.ts"),
    read("../app/app/page.tsx"),
    read("../app/app/operations-client.tsx"),
  ]);
  assert.match(financials, /payment_allocations/);
  assert.match(financials, /credit_note_applications/);
  assert.match(financials, /archived_at IS NULL/);
  assert.match(route, /summary.*===.*1/);
  assert.match(route, /totalBalance/);
  assert.match(page, /getDashboardReceivableBalance/);
  assert.match(client, /initialReceivableBalance/);
  assert.match(client, /\/api\/receivables\?summary=1/);
});

test("dashboard receivables preserve imported snapshots without allocations", async () => {
  const financials = await read("../app/lib/dashboard-financials.ts");
  const allocationBranch = financials.indexOf("WHEN EXISTS (SELECT 1 FROM payment_allocations");
  const snapshotBranch = financials.indexOf("WHEN i.balance_amount_snapshot IS NOT NULL");
  const paidFallback = financials.indexOf("WHEN i.status = 'paid' THEN 0");
  assert.ok(allocationBranch >= 0, "allocation-derived balance branch is present");
  assert.ok(snapshotBranch > allocationBranch, "snapshot is used after allocation-derived balances");
  assert.ok(paidFallback > snapshotBranch, "paid fallback is evaluated after an explicit snapshot");
  assert.match(financials, /ELSE MAX\(COALESCE\(i\.total_amount, 0\), 0\)/);
});
