import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import test from "node:test";
import { readDashboardReceivableBalance } from "../app/lib/dashboard-financial-query.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const run = promisify(execFile);

test("unknown routes have a branded Spanish recovery page", async () => {
  const page = await read("../app/not-found.tsx");
  assert.match(page, /Página no encontrada/);
  assert.match(page, /href=\"\/app\"/);
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
  const [financials, receivableQuery, route, page, client, billing] = await Promise.all([
    read("../app/lib/dashboard-financials.ts"),
    read("../app/lib/dashboard-financial-query.ts"),
    read("../app/api/receivables/route.ts"),
    read("../app/app/page.tsx"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/billing-view.tsx"),
  ]);
  assert.match(financials, /readDashboardReceivableBalance/);
  assert.match(receivableQuery, /payment_allocations/);
  assert.match(receivableQuery, /credit_note_applications/);
  assert.match(receivableQuery, /archived_at IS NULL/);
  assert.match(receivableQuery, /LOWER\(TRIM\(COALESCE\(br\.status, ''\)\)\) IN \('cancelado', 'cancelled', 'reemplazado', 'replaced'/);
  assert.match(receivableQuery, /'pagado', 'pagada', 'paid'/);
  assert.match(route, /summary.*===.*1/);
  assert.match(route, /totalBalance/);
  assert.match(route, /normalized_invoice_read_model_with_legacy_read_through/);
  assert.match(route, /sources: \["normalized_invoice_read_model", "legacy_read_through"\]/);
  assert.match(route, /balance_amount_snapshot IS NOT NULL/);
  assert.match(route, /legacyReceivables/);
  assert.match(route, /x\.status IN \('replaced', 'void', 'draft'\) THEN x\.status/);
  assert.match(billing, /legacyReceivables/);
  assert.match(page, /getDashboardReceivableBalance/);
  assert.match(page, /may\("cuentas-cobrar"\)\s*\?/);
  assert.match(client, /initialReceivableBalance/);
  assert.match(client, /\/api\/receivables\?summary=1/);
  assert.match(client, /canOpenReceivables/);
  assert.match(client, /canViewReceivables/);
  assert.doesNotMatch(client, /records\s*\.filter\(\(record\) => record\.module === "facturas"\)/);
  assert.doesNotMatch(route, /LIMIT\s+1000/);
  assert.match(billing, /setLegacyRows\(\[\]\)/);
  assert.match(billing, /loadSequence/);
});

test("dashboard receivables preserve imported snapshots without allocations", async () => {
  const financials = await read("../app/lib/dashboard-financial-query.ts");
  const allocationBranch = financials.indexOf("WHEN EXISTS (SELECT 1 FROM payment_allocations");
  const snapshotBranch = financials.indexOf("WHEN i.balance_amount_snapshot IS NOT NULL");
  const paidFallback = financials.indexOf("WHEN i.status = 'paid' THEN 0");
  assert.ok(allocationBranch >= 0, "allocation-derived balance branch is present");
  assert.ok(snapshotBranch > allocationBranch, "snapshot is used after allocation-derived balances");
  assert.ok(paidFallback > snapshotBranch, "paid fallback is evaluated after an explicit snapshot");
  assert.match(financials, /ELSE MAX\(COALESCE\(i\.total_amount, 0\), 0\)/);
  assert.doesNotMatch(financials, /LIMIT\s+250/);
});

test("legacy paid statuses cannot inflate dashboard receivables", async () => {
  const [financials, route] = await Promise.all([
    read("../app/lib/dashboard-financial-query.ts"),
    read("../app/api/receivables/route.ts"),
  ]);
  assert.match(financials, /'pagado', 'pagada', 'paid'\) THEN 0/);
  assert.match(route, /'pagado', 'pagada', 'paid'\) THEN 0/);
  assert.match(route, /'pagado', 'pagada', 'paid'\) THEN 'paid'/);
});

test("dashboard receivable read model reconciles normalized and legacy records without a row cap", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      status TEXT,
      total_amount REAL,
      balance_amount_snapshot REAL,
      archived_at TEXT,
      legacy_record_id TEXT
    );
    CREATE TABLE payment_allocations (invoice_id TEXT, status TEXT, amount REAL);
    CREATE TABLE credit_note_applications (invoice_id TEXT, status TEXT, amount REAL);
    CREATE TABLE business_records (
      id TEXT PRIMARY KEY,
      module TEXT,
      status TEXT,
      balance REAL,
      archived_at TEXT
    );
  `);

  const legacy = database.prepare(
    "INSERT INTO business_records (id, module, status, balance, archived_at) VALUES (?, 'facturas', ?, ?, ?)",
  );
  for (let index = 0; index < 260; index += 1) {
    legacy.run(`legacy-${index}`, "Pendiente", 10, null);
  }
  legacy.run("legacy-paid", "Pagado", 100, null);
  legacy.run("legacy-null-status", null, null, null);
  legacy.run("legacy-archived", "Pendiente", 500, "2026-01-01");
  legacy.run("legacy-promoted", "Pendiente", 999, null);

  const invoice = database.prepare(
    "INSERT INTO invoices (id, status, total_amount, balance_amount_snapshot, archived_at, legacy_record_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  invoice.run("normalized-paid", "paid", 50, null, null, null);
  invoice.run("normalized-partial", "issued", 100, null, null, null);
  invoice.run("normalized-snapshot", "issued", 100, 25, null, null);
  invoice.run("normalized-archived", "issued", 90, 90, "2026-01-01", null);
  invoice.run("promoted-invoice", "issued", 20, null, null, "legacy-promoted");
  database.prepare("INSERT INTO payment_allocations VALUES ('normalized-partial', 'applied', 30)").run();
  database.prepare("INSERT INTO credit_note_applications VALUES ('normalized-partial', 'applied', 10)").run();

  const balance = await readDashboardReceivableBalance({
    prepare(sql) {
      return {
        async first() {
          return database.prepare(sql).get();
        },
      };
    },
  });

  assert.equal(balance, 2705, "260 legacy rows plus normalized allocations, snapshot and promotion must reconcile exactly");
  database.close();
});

test("dashboard receivable policy handles snapshots, allocations and paid status", async () => {
  const script = `
    import { strict as assert } from "node:assert";
    import { calculateDashboardInvoiceBalance as balance } from "./app/lib/dashboard-financial-policy.ts";
    assert.equal(balance({ status: "issued", totalAmount: 100, balanceSnapshot: 0 }), 0);
    assert.equal(balance({ status: "paid", totalAmount: 100, balanceSnapshot: null }), 0);
    assert.equal(balance({ status: "partial", totalAmount: 100, balanceSnapshot: 70, paidAllocations: 20, creditedApplications: 10, hasAppliedAllocations: true }), 70);
    assert.equal(balance({ status: "draft", totalAmount: 100, balanceSnapshot: 100 }), 0);
  `;
  await run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url) });
});
