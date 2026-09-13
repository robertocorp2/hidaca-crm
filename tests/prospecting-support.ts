import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Repository } from "../app/lib/prospecting/repository";
import { defaultPolicy } from "../app/lib/prospecting/domain";
import type { BusinessFacts, Context, TenantPolicy } from "../app/lib/prospecting/contracts";
import type { RuntimeSwitches } from "../app/lib/prospecting/service";
export const context: Context = { tenantId: "hidaca", actor: "operator@example.com", role: "admin", requestId: "request-fixture" };
export const switches: RuntimeSwitches = { PROSPECTING_TENANT_ALLOWLIST: "hidaca,other", PROSPECTING_DISCOVERY_ENABLED: "true", PROSPECTING_ENRICHMENT_ENABLED: "true", PROSPECTING_SCORING_ENABLED: "true", PROSPECTING_AUDIT_ENABLED: "true", PROSPECTING_CRM_ENABLED: "true" };
export const facts: BusinessFacts = { name: "Constructora Ejemplo", address: "Av. Principal 42, Santo Domingo", latitude: 18.4861, longitude: -69.9312, phone: "+1 809 555 0101", website: "https://example.com/", domain: "example.com", categories: ["general_contractor"], placeId: "ChIJ-fixture-1", mapsUrl: "https://maps.google.com/?cid=123", rating: 4.2, reviewCount: 10, attributions: [] };
export const searchInput = { mode: "text", query: "constructoras", latitude: 18.4861, longitude: -69.9312, radius: 5000, locale: "es", pageSize: 20 };
export function testPolicy(): TenantPolicy {
  const p = defaultPolicy();
  p.enabled = { discovery: true, enrichment: true, scoring: true, audit: true, crm: true };
  p.providers = { google_places: true, pagespeed: true, builtwith: true, hunter: true };
  p.scoring.targetTypes = ["general_contractor"];
  return p;
}
export function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const folder = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(folder).filter(f => /^\d+.*\.sql$/.test(f)).sort()) sqlite.exec(readFileSync(new URL(file, folder), "utf8"));
  const meta = () => ({ duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 });
  function prepare(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    return {
      bind(...params: unknown[]) { return prepare(sql, params as SQLInputValue[]); },
      async first<T>(column?: string): Promise<T | null> { const row = sqlite.prepare(sql).get(...values); return row ? (column ? row[column] : row) as T : null; },
      async all<T>(): Promise<D1Result<T>> { return { success: true, results: sqlite.prepare(sql).all(...values) as T[], meta: meta() }; },
      async run<T>(): Promise<D1Result<T>> { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { ...meta(), changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      async raw<T extends unknown[]>(): Promise<T[]> { return sqlite.prepare(sql).all(...values).map(row => Object.values(row) as T); },
    } as D1PreparedStatement;
  }
  // SQLite batch is synchronous/atomic, matching D1's serialized transaction
  // semantics. We retain the SQL and bindings to execute batch without awaits.
  const statements = new WeakMap<D1PreparedStatement, { sql: string; values: SQLInputValue[] }>();
  function tracked(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    const statement = prepare(sql, values); statement.bind = (...p: unknown[]) => tracked(sql, p as SQLInputValue[]); statements.set(statement, { sql, values }); return statement;
  }
  const binding = {
    prepare: tracked,
    async batch<T>(batch: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = batch.map(statement => { const entry = statements.get(statement)!; const rows = sqlite.prepare(entry.sql).all(...entry.values); return { success: true as const, results: rows as T[], meta: meta() }; });
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as D1Database;
  const repo = new Repository(binding);
  sqlite.prepare("INSERT INTO staff_users(email,name,role,active,created_at,updated_at) VALUES(?,?,'admin',1,?,?)").run(context.actor, "Test Operator", new Date().toISOString(), new Date().toISOString());
  for (const tenant of ["hidaca", "other"]) sqlite.prepare("INSERT INTO pi_policies(tenant_id,version,policy,actor,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(tenant, "1", JSON.stringify(testPolicy()), context.actor, new Date().toISOString(), new Date().toISOString());
  return { sqlite, binding, repo };
}
