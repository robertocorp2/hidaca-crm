// SQL migration 0015 is authoritative, including immutable-snapshot triggers.
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, primaryKey, unique, index, uniqueIndex, foreignKey, check } from "drizzle-orm/sqlite-core";

export const piPolicies = sqliteTable("pi_policies", {
  tenantId: text("tenant_id").primaryKey(),
  version: text("version").notNull(),
  policy: text("policy").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const piProspects = sqliteTable("pi_prospects", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  identityKey: text("identity_key").notNull(),
  facts: text("facts").notNull(),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  actor: text("actor").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.identityKey),
]);

export const piIdentities = sqliteTable("pi_identities", {
  tenantId: text("tenant_id").notNull(),
  identityKey: text("identity_key").notNull(),
  prospectId: text("prospect_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.identityKey] }),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piSources = sqliteTable("pi_sources", {
  tenantId: text("tenant_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  confidence: real("confidence").notNull(),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.provider, table.externalId] }),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piJobs = sqliteTable("pi_jobs", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id"),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  leaseToken: text("lease_token"),
  leaseUntil: integer("lease_until"),
  nextRun: integer("next_run").notNull(),
  payload: text("payload").notNull(),
  result: text("result"),
  errorCode: text("error_code"),
  requestId: text("request_id").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  uniqueIndex("pi_jobs_active_operation").on(table.tenantId, table.prospectId, table.provider, table.operation).where(sql`prospect_id IS NOT NULL AND status IN ('queued','running','retrying')`),
  index("pi_jobs_prospect").on(table.tenantId, table.prospectId, table.createdAt),
  index("pi_jobs_ready").on(table.status, table.nextRun, table.leaseUntil),
  unique().on(table.tenantId, table.dedupeKey),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
  check("pi_jobs_operation", sql`${table.operation} IN ('search','enrich','audit','convert')`),
  check("pi_jobs_status", sql`${table.status} IN ('queued','running','retrying','completed','failed','dead_letter','cancelled')`),
]);

export const piSearches = sqliteTable("pi_searches", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  cacheKey: text("cache_key").notNull(),
  input: text("input").notNull(),
  status: text("status").notNull(),
  prospectIds: text("prospect_ids").notNull().default("[]"),
  nextPageToken: text("next_page_token").notNull().default(""),
  errorCode: text("error_code"),
  expiresAt: text("expires_at").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.cacheKey),
]);

export const piSnapshots = sqliteTable("pi_snapshots", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull(),
  snapshot: text("snapshot").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  jobId: text("job_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  index("pi_snapshot_latest").on(table.tenantId, table.prospectId, table.provider, table.retrievedAt),
  unique().on(table.tenantId, table.jobId, table.prospectId),
  foreignKey({ columns: [table.tenantId, table.jobId], foreignColumns: [piJobs.tenantId, piJobs.id] }),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piContactVault = sqliteTable("pi_contact_vault", {
  tenantId: text("tenant_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  ciphertext: text("ciphertext").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.snapshotId] }),
  foreignKey({ columns: [table.tenantId, table.snapshotId], foreignColumns: [piSnapshots.tenantId, piSnapshots.id] }).onDelete("cascade"),
]);

export const piScores = sqliteTable("pi_scores", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  inputKey: text("input_key").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.prospectId, table.inputKey),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piScoreEvidence = sqliteTable("pi_score_evidence", {
  tenantId: text("tenant_id").notNull(),
  scoreId: text("score_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.scoreId, table.snapshotId] }),
  foreignKey({ columns: [table.tenantId, table.snapshotId], foreignColumns: [piSnapshots.tenantId, piSnapshots.id] }),
  foreignKey({ columns: [table.tenantId, table.scoreId], foreignColumns: [piScores.tenantId, piScores.id] }).onDelete("cascade"),
]);

export const piAudits = sqliteTable("pi_audits", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  jobId: text("job_id").notNull(),
  status: text("status").notNull(),
  scoreId: text("score_id"),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.jobId),
  foreignKey({ columns: [table.tenantId, table.scoreId], foreignColumns: [piScores.tenantId, piScores.id] }),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piFindings = sqliteTable("pi_findings", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  auditId: text("audit_id").notNull(),
  ruleId: text("rule_id").notNull(),
  severity: text("severity").notNull(),
  finding: text("finding").notNull(),
  remediation: text("remediation").notNull(),
  evidenceIds: text("evidence_ids").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  foreignKey({ columns: [table.tenantId, table.auditId], foreignColumns: [piAudits.tenantId, piAudits.id] }).onDelete("cascade"),
]);

export const piDedupDecisions = sqliteTable("pi_dedup_decisions", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  candidates: text("candidates").notNull(),
  resolution: text("resolution").notNull(),
  reviewer: text("reviewer").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piExports = sqliteTable("pi_exports", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  mapping: text("mapping").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.prospectId),
  unique().on(table.tenantId, table.idempotencyKey),
  foreignKey({ columns: [table.tenantId, table.prospectId], foreignColumns: [piProspects.tenantId, piProspects.id] }),
]);

export const piExportOperations = sqliteTable("pi_export_operations", {
  tenantId: text("tenant_id").notNull(),
  exportId: text("export_id").notNull(),
  operation: text("operation").notNull(),
  ordinal: integer("ordinal").notNull(),
  status: text("status").notNull(),
  remoteId: text("remote_id"),
  errorCode: text("error_code"),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.exportId, table.operation] }),
  foreignKey({ columns: [table.tenantId, table.exportId], foreignColumns: [piExports.tenantId, piExports.id] }),
]);

export const piCrmLinks = sqliteTable("pi_crm_links", {
  tenantId: text("tenant_id").notNull(),
  entityType: text("entity_type").notNull(),
  identityKey: text("identity_key").notNull(),
  remoteId: text("remote_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.entityType, table.identityKey] }),
]);

export const piBulk = sqliteTable("pi_bulk", {
  id: text("id").notNull(),
  tenantId: text("tenant_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  inputHash: text("input_hash").notNull(),
  operation: text("operation").notNull(),
  cancelled: integer("cancelled").notNull().default(0),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.idempotencyKey),
]);

export const piBulkItems = sqliteTable("pi_bulk_items", {
  tenantId: text("tenant_id").notNull(),
  bulkId: text("bulk_id").notNull(),
  prospectId: text("prospect_id").notNull(),
  jobId: text("job_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.bulkId, table.prospectId, table.jobId] }),
  foreignKey({ columns: [table.tenantId, table.jobId], foreignColumns: [piJobs.tenantId, piJobs.id] }),
  foreignKey({ columns: [table.tenantId, table.bulkId], foreignColumns: [piBulk.tenantId, piBulk.id] }),
]);

export const piProviderCredentials = sqliteTable("pi_provider_credentials", {
  tenantId: text("tenant_id").notNull(),
  provider: text("provider").notNull(),
  secretReference: text("secret_reference").notNull(),
  scopes: text("scopes").notNull(),
  lastValidatedAt: text("last_validated_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.provider] }),
]);

export const piBudgets = sqliteTable("pi_budgets", {
  tenantId: text("tenant_id").notNull(),
  provider: text("provider").notNull(),
  window: text("window").notNull(),
  used: integer("used").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.provider, table.window] }),
]);

export const piCircuits = sqliteTable("pi_circuits", {
  tenantId: text("tenant_id").notNull(),
  provider: text("provider").notNull(),
  failures: integer("failures").notNull().default(0),
  openUntil: integer("open_until").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.provider] }),
]);

export const piEvents = sqliteTable("pi_events", {
  id: integer("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  jobId: text("job_id"),
  prospectId: text("prospect_id"),
  requestId: text("request_id").notNull(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  outcome: text("outcome").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("pi_events_recent").on(table.tenantId, table.createdAt),
]);

export const piRequests = sqliteTable("pi_requests", {
  tenantId: text("tenant_id").notNull(),
  scope: text("scope").notNull(),
  requestKey: text("request_key").notNull(),
  inputHash: text("input_hash").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.scope, table.requestKey] }),
]);

export const piBudgetReservations = sqliteTable("pi_budget_reservations", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  jobId: text("job_id").notNull(),
  leaseToken: text("lease_token").notNull(),
  provider: text("provider").notNull(),
  window: text("window").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  unique().on(table.tenantId, table.jobId, table.leaseToken),
  foreignKey({ columns: [table.tenantId, table.jobId], foreignColumns: [piJobs.tenantId, piJobs.id] }),
]);
