import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function applyMigration(database, source) {
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

test("AI foundation migration is additive and creates the voice/report primitives", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await readdir("drizzle")).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const migration of migrations) applyMigration(database, await readFile(`drizzle/${migration}`, "utf8"));
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const expected of ["ai_provider_configs", "ai_threads", "ai_messages", "ai_runs", "ai_tool_calls", "ai_approvals", "ai_usage_events", "ai_settings", "voice_recordings", "voice_transcriptions", "record_notes", "daily_reports", "daily_report_documents"]) assert.ok(tables.has(expected), `missing ${expected}`);
  assert.ok(tables.has("business_records"));
  const sql = await readFile("drizzle/0018_flaky_squadron_sinister.sql", "utf8");
  assert.doesNotMatch(sql, /DROP TABLE/i);
  const settingsColumns = database.prepare("PRAGMA table_info(ai_settings)").all();
  assert.ok(settingsColumns.some((column) => column.name === "default_provider"));
  const approvalPermission = database.prepare("SELECT role, allowed FROM role_permissions WHERE module = 'ai' AND action = 'approve' ORDER BY role").all().map((row) => ({ role: row.role, allowed: row.allowed }));
  assert.deepEqual(approvalPermission, [
    { role: "admin", allowed: 1 },
    { role: "operator", allowed: 0 },
    { role: "viewer", allowed: 0 },
  ]);
  database.close();
});
