import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationPaths = [
  "../drizzle/0000_sour_fat_cobra.sql",
  "../drizzle/0001_big_celestials.sql",
  "../drizzle/0002_sturdy_silk_fever.sql",
  "../drizzle/0003_dark_puma.sql",
  "../drizzle/0004_public_namor.sql",
  "../drizzle/0005_sudden_viper.sql",
  "../drizzle/0006_nasty_chameleon.sql",
  "../drizzle/0007_awesome_toxin.sql",
  "../drizzle/0008_melted_sauron.sql",
  "../drizzle/0009_glamorous_millenium_guard.sql",
  "../drizzle/0010_light_clea.sql",
];

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function applyMigration(database, source) {
  for (const statement of source.split("--> statement-breakpoint")) {
    if (!statement.trim()) continue;
    database.exec(statement);
  }
}

async function invoiceDatabase({ seedLegacy = true } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyMigration(database, await read(migrationPaths[0]));
  if (seedLegacy) {
    const insertLegacyRecord = database.prepare(
      `INSERT INTO business_records (
        id, module, title, status, customer_name, contact, amount, balance,
        notes, metadata, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    );
  insertLegacyRecord.run(
    "legacy-business",
    "clientes",
    "Cliente heredado",
    "Activo",
    "Cliente heredado",
    "809-555-0101",
    "Cliente de prueba",
    "{}",
    "owner@example.com",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  insertLegacyRecord.run(
      "legacy-invoice",
      "facturas",
      "Factura heredada F0001",
      "Pagado",
      "Cliente heredado",
      "809-555-0101",
      "Debe conservarse",
      '{"invoice_number":"F0001"}',
      "owner@example.com",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  }
  for (const path of migrationPaths.slice(1)) {
    applyMigration(database, await read(path));
  }
  return database;
}

function insertInvoice(
  database,
  {
    id,
    number,
    ncf = "",
    year = 2026,
    version = 1,
    status = "issued",
  },
) {
  database
    .prepare(
      `INSERT INTO invoices (
        id, business_id, invoice_number_raw, invoice_number_normalized,
        issue_year, ncf_raw, ncf_normalized, document_version, status,
        source_authority, created_by, created_at, updated_at
      ) VALUES (?, 'legacy-business', ?, ?, ?, ?, ?, ?, ?,
                'issued_document', 'owner@example.com', '2026-01-01',
                '2026-01-01')`,
    )
    .run(id, number, number, year, ncf, ncf, version, status);
}

test("invoice migration is additive and preserves every legacy row", async () => {
  const cleanDatabase = await invoiceDatabase({ seedLegacy: false });
  assert.equal(
    cleanDatabase
      .prepare("SELECT count(*) AS count FROM business_records")
      .get().count,
    0,
  );
  cleanDatabase.close();

  const database = await invoiceDatabase();
  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  for (const expected of [
    "invoices",
    "invoice_lines",
    "payment_allocations",
    "credit_notes",
    "credit_note_lines",
    "credit_note_applications",
    "receivable_snapshots",
    "collection_activities",
    "products_services",
    "tax_configurations",
  ]) {
    assert.ok(tables.has(expected), `missing ${expected}`);
  }

  const legacy = database
    .prepare(
      `SELECT title, metadata
       FROM business_records
       WHERE id = 'legacy-invoice'`,
    )
    .get();
  assert.deepEqual(
    { ...legacy },
    {
      title: "Factura heredada F0001",
      metadata: '{"invoice_number":"F0001"}',
    },
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM invoices").get().count,
    0,
    "schema migration must not import or backfill canonical invoices",
  );
  database.close();
});

test("invoice migration adds the approved staging and payment fields", async () => {
  const database = await invoiceDatabase();
  const columns = (table) =>
    new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );

  for (const expected of [
    "transaction_reference",
    "receipt_number",
    "payer_name",
    "bank_name",
    "account_last4",
    "evidence_status",
    "voided_at",
    "void_reason",
    "import_batch_id",
    "legacy_record_id",
  ]) {
    assert.ok(columns("payments").has(expected), `missing payments.${expected}`);
  }
  assert.ok(columns("invoices").has("import_batch_id"));
  assert.ok(columns("credit_notes").has("import_batch_id"));
  assert.ok(columns("receivable_snapshots").has("reversed_at"));
  assert.ok(columns("receivable_snapshots").has("reversal_reason"));
  for (const expected of [
    "document_kind",
    "source_modified_at",
    "download_status",
    "delta_status",
  ]) {
    assert.ok(
      columns("import_files").has(expected),
      `missing import_files.${expected}`,
    );
  }
  for (const expected of ["identity_fingerprint", "document_kind"]) {
    assert.ok(
      columns("import_rows").has(expected),
      `missing import_rows.${expected}`,
    );
  }

  const migrationSql = (
    await Promise.all(migrationPaths.slice(7).map((path) => read(path)))
  ).join("\n");
  assert.doesNotMatch(migrationSql, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
  assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\s+business_records\b/i);
  database.close();
});

test("invoice identity, NCF, status, version, and line constraints are enforced", async () => {
  const database = await invoiceDatabase();
  insertInvoice(database, {
    id: "invoice-1",
    number: "F0001",
    ncf: "E310000000001",
  });
  assert.throws(() =>
    insertInvoice(database, {
      id: "invoice-duplicate-ncf",
      number: "F9999",
      ncf: "E310000000001",
    }),
  );
  assert.throws(() =>
    insertInvoice(database, {
      id: "invoice-duplicate-identity",
      number: "F0001",
      ncf: "E310000000001",
    }),
  );
  assert.throws(() =>
    insertInvoice(database, {
      id: "invoice-invalid-status",
      number: "F0002",
      status: "invented",
    }),
  );
  assert.throws(() =>
    insertInvoice(database, {
      id: "invoice-invalid-version",
      number: "F0003",
      version: 0,
    }),
  );

  insertInvoice(database, { id: "invoice-blank-1", number: "F0004" });
  insertInvoice(database, { id: "invoice-blank-2", number: "F0005" });
  database
    .prepare(
      `INSERT INTO invoice_lines (
        id, invoice_id, line_number, description
      ) VALUES ('line-1', 'invoice-1', 1, 'Servicio')`,
    )
    .run();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO invoice_lines (
          id, invoice_id, line_number, description
        ) VALUES ('line-duplicate', 'invoice-1', 1, 'Duplicada')`,
      )
      .run(),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO invoice_lines (
          id, invoice_id, line_number
        ) VALUES ('line-zero', 'invoice-1', 0)`,
      )
      .run(),
  );
  database
    .prepare("DELETE FROM invoices WHERE id = 'invoice-1'")
    .run();
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM invoice_lines WHERE invoice_id = 'invoice-1'",
      )
      .get().count,
    0,
  );
  database.close();
});

test("documented payment identity and positive allocations are enforced", async () => {
  const database = await invoiceDatabase();
  insertInvoice(database, { id: "invoice-payment", number: "F0010" });
  const insertPayment = database.prepare(
    `INSERT INTO payments (
      id, business_id, amount, payment_date, transaction_reference,
      evidence_status, created_by, created_at, updated_at
    ) VALUES (?, 'legacy-business', 1000, '2026-01-10', ?, 'documented',
              'owner@example.com', '2026-01-10', '2026-01-10')`,
  );
  insertPayment.run("payment-1", "TX-001");
  assert.throws(() => insertPayment.run("payment-duplicate", "TX-001"));
  insertPayment.run("payment-no-ref-1", "");
  insertPayment.run("payment-no-ref-2", "");

  database
    .prepare(
      `INSERT INTO payment_allocations (
        id, payment_id, invoice_id, amount, currency, status,
        created_by, created_at
      ) VALUES ('allocation-1', 'payment-1', 'invoice-payment', 500, 'DOP',
                'applied', 'owner@example.com', '2026-01-10')`,
    )
    .run();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO payment_allocations (
          id, payment_id, invoice_id, amount, created_by, created_at
        ) VALUES ('allocation-zero', 'payment-1', 'invoice-payment', 0,
                  'owner@example.com', '2026-01-10')`,
      )
      .run(),
  );
  assert.throws(() =>
    database.prepare("DELETE FROM payments WHERE id = 'payment-1'").run(),
  );
  database.close();
});

test("credit, receivable, tax, and collection foreign keys and enums are enforced", async () => {
  const database = await invoiceDatabase();
  insertInvoice(database, { id: "invoice-ar", number: "F0020" });
  database
    .prepare(
      `INSERT INTO tax_configurations (
        id, code, label, tax_kind, rate, effective_from, applies_to,
        created_by, created_at, updated_at
      ) VALUES ('tax-itbis', 'ITBIS', 'ITBIS observado', 'itbis', 0.18,
                '2026-01-01', 'line', 'owner@example.com', '2026-01-01',
                '2026-01-01')`,
    )
    .run();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO tax_configurations (
          id, code, label, tax_kind, rate, effective_from, applies_to,
          created_by, created_at, updated_at
        ) VALUES ('tax-negative', 'NEG', 'Inválido', 'other', -0.01,
                  '2026-01-01', 'line', 'owner@example.com', '2026-01-01',
                  '2026-01-01')`,
      )
      .run(),
  );
  database
    .prepare(
      `INSERT INTO credit_notes (
        id, business_id, credit_note_number_raw,
        credit_note_number_normalized, issue_year, status,
        source_authority, created_by, created_at, updated_at
      ) VALUES ('credit-1', 'legacy-business', 'NC-0001', 'NC-0001', 2026,
                'issued', 'issued_document', 'owner@example.com',
                '2026-01-20', '2026-01-20')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO credit_note_applications (
        id, credit_note_id, invoice_id, amount, status, created_by, created_at
      ) VALUES ('credit-application-1', 'credit-1', 'invoice-ar', 100,
                'applied', 'owner@example.com', '2026-01-20')`,
    )
    .run();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO receivable_snapshots (
          id, invoice_id, as_of, status_normalized, created_at
        ) VALUES ('snapshot-bad', 'invoice-ar', '2026-01-31', 'invented',
                  '2026-01-31')`,
      )
      .run(),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO collection_activities (
          id, invoice_id, business_id, activity_type, occurred_at,
          owner_email, created_by, created_at, updated_at
        ) VALUES ('collection-bad', 'invoice-ar', 'legacy-business', 'sms',
                  '2026-01-31', 'owner@example.com', 'owner@example.com',
                  '2026-01-31', '2026-01-31')`,
      )
      .run(),
  );
  database.close();
});
