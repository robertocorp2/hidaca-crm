import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrations = (await readdir("drizzle")).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(`drizzle/${migration}`, "utf8");
    for (const statement of sql.split(/--> statement-breakpoint/).map((item) => item.trim()).filter(Boolean)) database.exec(statement);
  }
  return database;
}

test("0021 adds persisted Daily Brief storage and approval execution metadata", async () => {
  const database = await migratedDatabase();
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("ai_daily_briefs"));
  assert.ok(tables.includes("ai_daily_brief_items"));
  const columns = database.prepare("PRAGMA table_info(ai_approvals)").all().map((row) => row.name);
  assert.ok(columns.includes("idempotency_key"));
  assert.ok(columns.includes("execution_result"));
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("ai_daily_briefs_owner_date_unique"));
  assert.ok(indexes.includes("ai_daily_brief_items_key_unique"));
  assert.ok(indexes.includes("ai_approvals_idempotency_unique"));
  const migration = await readFile("drizzle/0021_loving_famine.sql", "utf8");
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+business_records\b/i);
});
