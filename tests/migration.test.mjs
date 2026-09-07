import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function applyMigration(database, source) {
  for (const statement of source.split("--> statement-breakpoint")) {
    if (!statement.trim()) continue;
    try {
      database.exec(statement);
    } catch (error) {
      error.message = `${error.message}: ${statement.trim().slice(0, 120)}`;
      throw error;
    }
  }
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyMigration(database, await read("../drizzle/0000_sour_fat_cobra.sql"));
  database
    .prepare(
      `INSERT INTO business_records (
        id, module, title, status, customer_name, contact, amount, balance,
        notes, metadata, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, '{}', ?, ?, ?)`,
    )
    .run(
      "legacy-business",
      "clientes",
      "Constructora Álvarez",
      "Activo",
      "Constructora Álvarez",
      "809-555-0101",
      "Registro conservado",
      "owner@example.com",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  applyMigration(database, await read("../drizzle/0001_big_celestials.sql"));
  applyMigration(database, await read("../drizzle/0002_sturdy_silk_fever.sql"));
  applyMigration(database, await read("../drizzle/0003_dark_puma.sql"));
  applyMigration(database, await read("../drizzle/0004_public_namor.sql"));
  applyMigration(database, await read("../drizzle/0005_sudden_viper.sql"));
  return database;
}

test("additive migration preserves and backfills legacy records", async () => {
  const database = await migratedDatabase();
  const legacy = database
    .prepare("SELECT title FROM business_records WHERE id = ?")
    .get("legacy-business");
  const business = database
    .prepare(
      "SELECT name, legacy_record_id AS legacyRecordId FROM businesses WHERE id = ?",
    )
    .get("legacy-business");
  assert.equal(legacy.title, "Constructora Álvarez");
  assert.equal(business.name, "Constructora Álvarez");
  assert.equal(business.legacyRecordId, "legacy-business");

  const indexed = database
    .prepare(
      `SELECT d.entity_type AS entityType, d.entity_id AS entityId
       FROM search_documents_fts
       JOIN search_documents d ON d.row_id = search_documents_fts.rowid
       WHERE search_documents_fts MATCH '"constructora"*'`,
    )
    .get();
  assert.equal(indexed.entityType, "business");
  assert.equal(indexed.entityId, "legacy-business");
  database.close();
});

test("migration creates the indexes used by bounded CRM queries", async () => {
  const database = await migratedDatabase();
  const indexes = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_idx'",
    )
    .all()
    .map((row) => row.name);
  for (const expected of [
    "businesses_normalized_name_idx",
    "contacts_email_idx",
    "contacts_phone_idx",
    "contacts_normalized_name_idx",
    "leads_status_idx",
    "opportunities_stage_idx",
    "activities_start_idx",
    "quotations_number_year_idx",
    "quotation_revisions_quote_idx",
    "import_files_hash_idx",
    "import_issues_file_idx",
    "import_rows_file_outcome_idx",
    "import_batch_sources_batch_idx",
    "source_references_row_idx",
    "project_contacts_primary_idx",
    "project_locations_project_idx",
    "payments_revision_idx",
    "material_components_worksheet_idx",
  ]) {
    assert.ok(indexes.includes(expected), `missing ${expected}`);
  }
  database.close();
});

test("source expansion keeps old rows and supplies backward-compatible defaults", async () => {
  const database = await migratedDatabase();
  const business = database
    .prepare(
      `SELECT customer_type AS customerType, rnc, mobile_phone AS mobilePhone,
              source_metadata AS sourceMetadata
       FROM businesses WHERE id = 'legacy-business'`,
    )
    .get();
  assert.deepEqual(
    { ...business },
    {
      customerType: "organization",
      rnc: "",
      mobilePhone: "",
      sourceMetadata: "{}",
    },
  );
  const legacy = database
    .prepare("SELECT title FROM business_records WHERE id = 'legacy-business'")
    .get();
  assert.equal(legacy.title, "Constructora Álvarez");
  database.close();
});

test("individual customers do not require RNC and quotation numbers are not globally unique", async () => {
  const database = await migratedDatabase();
  const insertBusiness = database.prepare(
    `INSERT INTO businesses (
      id, name, normalized_name, customer_type, rnc, normalized_rnc,
      owner_email, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '', 'owner@example.com', 'owner@example.com',
              '2026-01-01', '2026-01-01')`,
  );
  insertBusiness.run("individual", "Ana Pérez", "ana perez", "individual");
  insertBusiness.run(
    "organization",
    "Empresa Uno",
    "empresa uno",
    "organization",
  );
  const insertQuotation = database.prepare(
    `INSERT INTO quotations (
      id, business_id, quotation_number, quotation_year, title,
      quotation_type, status, currency, owner_email, created_by,
      created_at, updated_at
    ) VALUES (?, ?, 'C001-2026', 2026, ?, 'installation', 'draft', 'DOP',
              'owner@example.com', 'owner@example.com', '2026-01-01', '2026-01-01')`,
  );
  insertQuotation.run("quote-individual", "individual", "Alternativa manual");
  insertQuotation.run(
    "quote-company",
    "organization",
    "Alternativa motorizada",
  );
  const count = database
    .prepare(
      "SELECT count(*) AS count FROM quotations WHERE quotation_number = 'C001-2026'",
    )
    .get();
  assert.equal(count.count, 2);

  const insertRevision = database.prepare(
    `INSERT INTO quotation_revisions (
      id, quotation_id, identity_key, revision_number, alternative_label,
      created_by, created_at, updated_at
    ) VALUES (?, 'quote-individual', ?, 1, ?, 'owner@example.com',
              '2026-01-01', '2026-01-01')`,
  );
  insertRevision.run("rev-manual", "c001-2026:1:manual", "Manual");
  insertRevision.run("rev-motor", "c001-2026:1:motorized", "Motorizada");
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM quotation_revisions WHERE quotation_id = 'quote-individual'",
      )
      .get().count,
    2,
  );
  database.close();
});

test("source provenance and internal material relationships enforce foreign keys", async () => {
  const database = await migratedDatabase();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO import_files (
          id, batch_id, document_id, filename, extension, sha256,
          imported_by, imported_at
        ) VALUES ('file', 'missing-batch', 'missing-document', 'x.xlsb',
                  '.xlsb', 'hash', 'owner@example.com', '2026-01-01')`,
      )
      .run(),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO material_components (
          id, worksheet_id, name
        ) VALUES ('component', 'missing-worksheet', 'Motor')`,
      )
      .run(),
  );
  database.close();
});

test("source expansion down migration removes only expansion structures", async () => {
  const database = await migratedDatabase();
  applyMigration(
    database,
    await read("../drizzle/rollback/0005_contact_normalized_name.down.sql"),
  );
  applyMigration(
    database,
    await read("../drizzle/rollback/0004_register_import.down.sql"),
  );
  applyMigration(
    database,
    await read("../drizzle/rollback/0003_source_expansion.down.sql"),
  );
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("business_records"));
  assert.ok(tables.includes("businesses"));
  assert.ok(tables.includes("contacts"));
  assert.ok(!tables.includes("quotations"));
  assert.ok(!tables.includes("import_files"));
  assert.ok(!tables.includes("material_components"));
  const legacy = database
    .prepare("SELECT title FROM business_records WHERE id = 'legacy-business'")
    .get();
  assert.equal(legacy.title, "Constructora Álvarez");
  database.close();
});

test("register import migration is additive, row-addressable, and reversible", async () => {
  const database = await migratedDatabase();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  for (const expected of [
    "import_rows",
    "import_batch_sources",
    "source_references",
    "project_contacts",
    "project_locations",
  ]) {
    assert.ok(tables.includes(expected), `missing ${expected}`);
  }

  const importBatchColumns = database
    .prepare("PRAGMA table_info(import_batches)")
    .all()
    .map((row) => row.name);
  for (const expected of [
    "source_filename",
    "source_hash",
    "dry_run",
    "total_rows",
    "matched_count",
    "duplicate_count",
    "unmapped_field_count",
    "summary_json",
  ]) {
    assert.ok(importBatchColumns.includes(expected), `missing ${expected}`);
  }

  applyMigration(
    database,
    await read("../drizzle/rollback/0005_contact_normalized_name.down.sql"),
  );
  applyMigration(
    database,
    await read("../drizzle/rollback/0004_register_import.down.sql"),
  );
  const remaining = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(remaining.includes("businesses"));
  assert.ok(remaining.includes("quotations"));
  assert.ok(!remaining.includes("import_rows"));
  assert.ok(!remaining.includes("source_references"));

  const legacy = database
    .prepare("SELECT title FROM business_records WHERE id = 'legacy-business'")
    .get();
  assert.match(String(legacy.title), /lvarez$/);
  database.close();
});

test("a failed conversion-style transaction rolls back every record", async () => {
  const database = await migratedDatabase();
  assert.throws(() => {
    database.exec("BEGIN");
    try {
      database
        .prepare(
          `INSERT INTO businesses (
            id, name, normalized_name, owner_email, created_by, created_at, updated_at
          ) VALUES ('atomic-business', 'Atomic', 'atomic', 'a@example.com',
                    'a@example.com', '2026-01-01', '2026-01-01')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO opportunities (
            id, title, business_id, stage, owner_email, created_by, created_at, updated_at
          ) VALUES ('atomic-opportunity', 'Atomic', 'missing-business',
                    'evaluation', 'a@example.com', 'a@example.com',
                    '2026-01-01', '2026-01-01')`,
        )
        .run();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  const count = database
    .prepare(
      "SELECT count(*) AS count FROM businesses WHERE id = 'atomic-business'",
    )
    .get();
  assert.equal(count.count, 0);
  database.close();
});
