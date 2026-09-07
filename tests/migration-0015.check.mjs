import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function apply(db, names) {
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of names) {
    const sql = readFileSync(new URL(name, migrationDirectory), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    db.exec(sql);
  }
}

{
  const db = new DatabaseSync(":memory:");
  apply(db, migrations);
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("staff_users"));
  assert.ok(tables.includes("role_permissions"));
  assert.ok(tables.includes("user_permission_overrides"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM role_permissions").get().count, 345);
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  apply(db, migrations.filter((name) => !name.startsWith("0015_")));
  db.prepare("INSERT INTO staff_users (email, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("existing@example.com", "Existing User", "operator", 1, "2026-01-01", "2026-01-02");
  const before = db.prepare("SELECT * FROM staff_users WHERE email = ?").get("existing@example.com");
  apply(db, migrations.filter((name) => name.startsWith("0015_")));
  const after = db.prepare("SELECT * FROM staff_users WHERE email = ?").get("existing@example.com");
  assert.deepEqual(after, before);
  db.prepare("INSERT INTO user_permission_overrides (user_id, module, action, effect) VALUES (?, 'equipos', 'view', 'deny')").run(after.id);
  db.prepare("DELETE FROM staff_users WHERE id = ?").run(after.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_permission_overrides WHERE user_id = ?").get(after.id).count, 0);
  db.close();
}

console.log("Migration 0015 passed empty and existing-database checks.");
