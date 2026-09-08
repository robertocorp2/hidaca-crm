CREATE TABLE pi_policies (
 tenant_id TEXT PRIMARY KEY, version TEXT NOT NULL, policy TEXT NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE pi_prospects (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, identity_key TEXT NOT NULL, facts TEXT NOT NULL,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, actor TEXT NOT NULL,
 PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, identity_key)
);
--> statement-breakpoint
CREATE TABLE pi_identities (
 tenant_id TEXT NOT NULL, identity_key TEXT NOT NULL, prospect_id TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, identity_key),
 FOREIGN KEY (tenant_id, prospect_id) REFERENCES pi_prospects(tenant_id, id)
);
--> statement-breakpoint
CREATE TABLE pi_sources (
 tenant_id TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL, prospect_id TEXT NOT NULL,
 source_url TEXT NOT NULL, confidence REAL NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
 PRIMARY KEY (tenant_id, provider, external_id),
 FOREIGN KEY (tenant_id, prospect_id) REFERENCES pi_prospects(tenant_id, id)
);
--> statement-breakpoint
CREATE TABLE pi_jobs (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT, provider TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('search','enrich','audit','convert')), dedupe_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','retrying','completed','failed','dead_letter','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 4,
 lease_token TEXT, lease_until INTEGER, next_run INTEGER NOT NULL,
 payload TEXT NOT NULL, result TEXT, error_code TEXT, request_id TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,dedupe_key),
 FOREIGN KEY (tenant_id, prospect_id) REFERENCES pi_prospects(tenant_id, id)
);
--> statement-breakpoint
CREATE INDEX pi_jobs_ready ON pi_jobs(status,next_run,lease_until);
--> statement-breakpoint
CREATE INDEX pi_jobs_prospect ON pi_jobs(tenant_id,prospect_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX pi_jobs_active_operation ON pi_jobs(tenant_id,prospect_id,provider,operation)
 WHERE prospect_id IS NOT NULL AND status IN ('queued','running','retrying');
--> statement-breakpoint
CREATE TABLE pi_searches (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, cache_key TEXT NOT NULL, input TEXT NOT NULL,
 status TEXT NOT NULL, prospect_ids TEXT NOT NULL DEFAULT '[]', next_page_token TEXT NOT NULL DEFAULT '',
 error_code TEXT, expires_at TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,cache_key)
);
--> statement-breakpoint
CREATE TABLE pi_snapshots (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, provider TEXT NOT NULL,
 operation TEXT NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL,
 retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL, job_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,job_id,prospect_id),
 FOREIGN KEY (tenant_id, prospect_id) REFERENCES pi_prospects(tenant_id,id),
 FOREIGN KEY (tenant_id,job_id) REFERENCES pi_jobs(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX pi_snapshot_latest ON pi_snapshots(tenant_id,prospect_id,provider,retrieved_at);
--> statement-breakpoint
CREATE TRIGGER pi_snapshots_immutable BEFORE UPDATE ON pi_snapshots BEGIN SELECT RAISE(ABORT,'Snapshots are immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_contact_vault (
 tenant_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,snapshot_id), FOREIGN KEY(tenant_id,snapshot_id) REFERENCES pi_snapshots(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE pi_scores (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, input_key TEXT NOT NULL,
 snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,prospect_id,input_key),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES pi_prospects(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_score_evidence (
 tenant_id TEXT NOT NULL, score_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,score_id,snapshot_id),
 FOREIGN KEY(tenant_id,score_id) REFERENCES pi_scores(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES pi_snapshots(tenant_id,id)
);
--> statement-breakpoint
CREATE TRIGGER pi_scores_immutable BEFORE UPDATE ON pi_scores BEGIN SELECT RAISE(ABORT,'Scores are immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_audits (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, job_id TEXT NOT NULL,
 status TEXT NOT NULL, score_id TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES pi_prospects(tenant_id,id),
 FOREIGN KEY(tenant_id,score_id) REFERENCES pi_scores(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_findings (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, audit_id TEXT NOT NULL, rule_id TEXT NOT NULL,
 severity TEXT NOT NULL, finding TEXT NOT NULL, remediation TEXT NOT NULL, evidence_ids TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,audit_id) REFERENCES pi_audits(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE pi_dedup_decisions (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, candidates TEXT NOT NULL,
 resolution TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,prospect_id) REFERENCES pi_prospects(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_exports (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 mapping TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT,
 actor TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,prospect_id),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES pi_prospects(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_export_operations (
 tenant_id TEXT NOT NULL, export_id TEXT NOT NULL, operation TEXT NOT NULL, ordinal INTEGER NOT NULL,
 status TEXT NOT NULL, remote_id TEXT, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,export_id,operation), FOREIGN KEY(tenant_id,export_id) REFERENCES pi_exports(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_crm_links (
 tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL, identity_key TEXT NOT NULL, remote_id TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,entity_type,identity_key)
);
--> statement-breakpoint
CREATE TABLE pi_bulk (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL,
 operation TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE pi_bulk_items (
 tenant_id TEXT NOT NULL, bulk_id TEXT NOT NULL, prospect_id TEXT NOT NULL, job_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,bulk_id,prospect_id,job_id),
 FOREIGN KEY(tenant_id,bulk_id) REFERENCES pi_bulk(tenant_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES pi_jobs(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE pi_provider_credentials (
 tenant_id TEXT NOT NULL, provider TEXT NOT NULL, secret_reference TEXT NOT NULL, scopes TEXT NOT NULL,
 last_validated_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,provider)
);
--> statement-breakpoint
CREATE TABLE pi_budgets (
 tenant_id TEXT NOT NULL, provider TEXT NOT NULL, window TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,provider,window)
);
--> statement-breakpoint
CREATE TABLE pi_circuits (
 tenant_id TEXT NOT NULL, provider TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, open_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,provider)
);
--> statement-breakpoint
CREATE TABLE pi_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, job_id TEXT, prospect_id TEXT,
 request_id TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL,
 retry_count INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX pi_events_recent ON pi_events(tenant_id,created_at);
--> statement-breakpoint
CREATE TABLE pi_requests (
 tenant_id TEXT NOT NULL, scope TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,scope,request_key)
);
--> statement-breakpoint
CREATE TABLE pi_budget_reservations (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, job_id TEXT NOT NULL, lease_token TEXT NOT NULL,
 provider TEXT NOT NULL, window TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,job_id,lease_token),
 FOREIGN KEY(tenant_id,job_id) REFERENCES pi_jobs(tenant_id,id)
);
