import { ProspectingError, type BusinessFacts, type Context, type Job, type Prospect, type ProspectRepository, type Provider, type Snapshot, type TenantPolicy } from "./contracts";
import { defaultPolicy, hash, identityKeys } from "./domain";

export class Repository implements ProspectRepository {
  constructor(public db: D1Database) {}
  statement(sql: string, ...values: (string | number | null)[]) { return this.db.prepare(sql).bind(...values); }
  async one<T>(sql: string, ...values: (string | number | null)[]): Promise<T | null> { return this.statement(sql, ...values).first<T>(); }
  async all<T>(sql: string, ...values: (string | number | null)[]): Promise<T[]> { return (await this.statement(sql, ...values).all<T>()).results; }
  async policy(tenantId: string): Promise<TenantPolicy> {
    const row = await this.one<{ policy: string }>("SELECT policy FROM pi_policies WHERE tenant_id=?", tenantId);
    return row ? JSON.parse(row.policy) : defaultPolicy();
  }
  async getProspect(tenantId: string, id: string): Promise<Prospect | null> {
    const row = await this.one<{ id: string; identity_key: string; facts: string; first_seen: string; last_seen: string }>("SELECT * FROM pi_prospects WHERE tenant_id=? AND id=?", tenantId, id);
    return row ? { ...JSON.parse(row.facts), id: row.id, tenantId, identityKey: row.identity_key, firstSeen: row.first_seen, lastSeen: row.last_seen } : null;
  }
  async canonicalize(context: Context, facts: BusinessFacts): Promise<Prospect> {
    const keys = await identityKeys(facts), now = new Date().toISOString(), candidate = `p_${await hash([context.tenantId, keys[0]])}`;
    const slots = keys.map(() => "?").join(",");
    const select = `SELECT prospect_id FROM pi_identities WHERE tenant_id=? AND identity_key IN (${slots}) ORDER BY prospect_id LIMIT 1`;
    const existing = await this.all<{ prospect_id: string }>(`SELECT DISTINCT prospect_id FROM pi_identities WHERE tenant_id=? AND identity_key IN (${slots})`, context.tenantId, ...keys);
    if (existing.length > 1) throw new ProspectingError("conflict", "Las señales corresponden a prospectos distintos; se requiere revisión.");
    // Every statement in the D1 batch is one transaction. A concurrent caller
    // resolves the aliases installed by the first writer inside that transaction.
    await this.db.batch([
      this.statement(`INSERT INTO pi_prospects (id,tenant_id,identity_key,facts,first_seen,last_seen,actor)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (${select}) ON CONFLICT DO NOTHING`, candidate, context.tenantId, keys[0], JSON.stringify(facts), now, now, context.actor, context.tenantId, ...keys),
      ...keys.map(key => this.statement(`INSERT INTO pi_identities (tenant_id,identity_key,prospect_id,created_at)
        VALUES (?,?,COALESCE((${select}),?),?) ON CONFLICT DO NOTHING`, context.tenantId, key, context.tenantId, ...keys, candidate, now)),
    ]);
    const canonical = await this.one<{ prospect_id: string }>(select, context.tenantId, ...keys);
    if (!canonical) throw new ProspectingError("unknown");
    const ids = await this.all<{ prospect_id: string }>(`SELECT DISTINCT prospect_id FROM pi_identities WHERE tenant_id=? AND identity_key IN (${slots})`, context.tenantId, ...keys);
    if (ids.length !== 1) throw new ProspectingError("conflict", "Identidad ambigua; se requiere revisión.");
    const previous = await this.getProspect(context.tenantId, canonical.prospect_id);
    if (!previous) throw new ProspectingError("unknown");
    const merged = { ...facts, website: facts.website || previous.website, domain: facts.domain || previous.domain, phone: facts.phone || previous.phone, address: facts.address || previous.address };
    await this.db.batch([
      this.statement("UPDATE pi_prospects SET facts=?,last_seen=? WHERE tenant_id=? AND id=?", JSON.stringify(merged), now, context.tenantId, previous.id),
      this.statement(`INSERT INTO pi_sources (tenant_id,provider,external_id,prospect_id,source_url,confidence,first_seen,last_seen)
        VALUES (?,'google_places',?,?,?,1,?,?) ON CONFLICT(tenant_id,provider,external_id) DO UPDATE SET last_seen=excluded.last_seen,source_url=excluded.source_url`, context.tenantId, facts.placeId || keys[0], previous.id, facts.mapsUrl, now, now),
    ]);
    return { ...previous, ...merged, lastSeen: now };
  }
  async snapshots(tenantId: string, prospectId: string): Promise<Snapshot[]> {
    const rows = await this.all<{ snapshot: string }>("SELECT snapshot FROM pi_snapshots WHERE tenant_id=? AND prospect_id=? ORDER BY retrieved_at DESC,id DESC LIMIT 200", tenantId, prospectId);
    return rows.map(row => JSON.parse(row.snapshot));
  }
  async enqueue(context: Context, input: Parameters<ProspectRepository["enqueue"]>[1]): Promise<Job> {
    const now = new Date().toISOString(), id = `j_${await hash([context.tenantId, input.key])}`;
    const policy = await this.policy(context.tenantId);
    await this.statement(`INSERT INTO pi_jobs (id,tenant_id,prospect_id,provider,operation,dedupe_key,status,next_run,payload,request_id,actor,created_at,updated_at)
      SELECT ?,?,?,?,?,?,'queued',?,?,?,?,?,? WHERE (SELECT count(*) FROM pi_jobs WHERE tenant_id=? AND status IN ('queued','running','retrying'))<?
      ON CONFLICT DO NOTHING`, id, context.tenantId, input.prospectId ?? null, input.provider, input.operation, input.key, Date.now(), JSON.stringify(input.payload), context.requestId, context.actor, now, now, context.tenantId, policy.maxQueuedJobs ?? 300).run();
    const job = await this.one<Job>(`SELECT * FROM pi_jobs WHERE tenant_id=? AND (id=? OR (prospect_id=? AND provider=? AND operation=? AND status IN ('queued','running','retrying'))) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`, context.tenantId, id, input.prospectId ?? null, input.provider, input.operation, id);
    if (!job) throw new ProspectingError("rate_limited", "La cola está llena; espera a que terminen los trabajos pendientes.", 60);
    return job;
  }
  async claim(tenantId: string, policy: TenantPolicy, now = Date.now()): Promise<Job | null> {
    const expired = "j.tenant_id=? AND j.status='running' AND j.lease_until<=? AND j.attempts>=j.max_attempts";
    await this.db.batch([
      this.statement(`UPDATE pi_searches SET status='dead_letter',error_code='timeout',updated_at=? WHERE tenant_id=?
        AND id IN(SELECT json_extract(j.payload,'$.searchId') FROM pi_jobs j WHERE ${expired} AND j.operation='search')`, new Date(now).toISOString(), tenantId, tenantId, now),
      this.statement(`UPDATE pi_exports SET status=CASE WHEN EXISTS(SELECT 1 FROM pi_export_operations o WHERE o.tenant_id=pi_exports.tenant_id AND o.export_id=pi_exports.id AND o.status='completed') THEN 'partial' ELSE 'failed' END,error_code='timeout',updated_at=?
        WHERE tenant_id=? AND id IN(SELECT json_extract(j.payload,'$.exportId') FROM pi_jobs j WHERE ${expired} AND j.operation='convert')`, new Date(now).toISOString(), tenantId, tenantId, now),
      this.statement(`INSERT INTO pi_audits(id,tenant_id,prospect_id,job_id,status,actor,created_at)
        SELECT j.id,j.tenant_id,j.prospect_id,j.id,'failed',j.actor,? FROM pi_jobs j WHERE ${expired} AND j.operation='audit' AND j.prospect_id IS NOT NULL ON CONFLICT DO NOTHING`, new Date(now).toISOString(), tenantId, now),
      this.statement("UPDATE pi_jobs SET status='dead_letter',error_code='timeout',lease_token=NULL,lease_until=NULL,updated_at=? WHERE tenant_id=? AND status='running' AND lease_until<=? AND attempts>=max_attempts", new Date(now).toISOString(), tenantId, now),
    ]);
    const token = crypto.randomUUID();
    return this.one<Job>(`UPDATE pi_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
      WHERE tenant_id=? AND id=(SELECT q.id FROM pi_jobs q WHERE q.tenant_id=? AND q.attempts<q.max_attempts
        AND ((q.status IN ('queued','retrying') AND q.next_run<=?) OR (q.status='running' AND q.lease_until<=?))
        AND NOT (q.operation='audit' AND EXISTS(SELECT 1 FROM json_each(q.payload,'$.dependencies') d
          JOIN pi_jobs dep ON dep.tenant_id=q.tenant_id AND dep.id=d.value WHERE dep.status IN ('queued','running','retrying')))
        AND (SELECT COUNT(*) FROM pi_jobs r WHERE r.tenant_id=q.tenant_id AND r.status='running' AND r.lease_until>?)<?
        AND (SELECT COUNT(*) FROM pi_jobs r WHERE r.provider=q.provider AND r.status='running' AND r.lease_until>?)<?
        ORDER BY q.next_run,q.created_at LIMIT 1) RETURNING *`, token, now + 90000, new Date(now).toISOString(), tenantId, tenantId, now, now, now, policy.tenantConcurrency, now, policy.providerConcurrency);
  }
  async owns(job: Job): Promise<boolean> {
    return !!await this.one("SELECT id FROM pi_jobs WHERE tenant_id=? AND id=? AND status='running' AND lease_token=? AND lease_until>?", job.tenant_id, job.id, job.lease_token, Date.now());
  }
  async renew(job: Job): Promise<boolean> {
    return !!await this.one("UPDATE pi_jobs SET lease_until=? WHERE tenant_id=? AND id=? AND status='running' AND lease_token=? AND lease_until>? RETURNING id", Date.now() + 90000, job.tenant_id, job.id, job.lease_token, Date.now());
  }
  async reserveBudget(job: Job, policy: TenantPolicy, now = Date.now()) {
    const circuit = await this.one<{ open_until: number }>("SELECT open_until FROM pi_circuits WHERE tenant_id=? AND provider=?", job.tenant_id, job.provider);
    if (circuit && circuit.open_until > now) throw new ProspectingError("unavailable", "Circuito temporalmente abierto.", Math.ceil((circuit.open_until - now) / 1000));
    const window = new Date(now).toISOString().slice(0, 10);
    if (!await this.owns(job)) throw new ProspectingError("conflict");
    const token = crypto.randomUUID(), providerLimit = policy.providerBudgets?.[job.provider as Provider] ?? policy.dailyBudget;
    const budget = await this.db.batch([
      this.statement(`INSERT INTO pi_budget_reservations(tenant_id,id,job_id,lease_token,provider,window,created_at)
        SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT used FROM pi_budgets WHERE tenant_id=? AND provider='all' AND window=?),0)<?
        AND COALESCE((SELECT used FROM pi_budgets WHERE tenant_id=? AND provider=? AND window=?),0)<? ON CONFLICT DO NOTHING RETURNING id`, job.tenant_id, token, job.id, job.lease_token, job.provider, window, new Date(now).toISOString(), job.tenant_id, window, policy.dailyBudget, job.tenant_id, job.provider, window, providerLimit),
      ...["all", job.provider].map(provider => this.statement(`INSERT INTO pi_budgets(tenant_id,provider,window,used)
        SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM pi_budget_reservations WHERE tenant_id=? AND id=?)
        ON CONFLICT(tenant_id,provider,window) DO UPDATE SET used=used+1`, job.tenant_id, provider, window, job.tenant_id, token)),
    ]);
    if (!budget[0].results.length) throw new ProspectingError("budget_exhausted");
  }
  async finish(job: Job, status: Job["status"], result: unknown, error: Job["error_code"] = null, delaySeconds = 0) {
    await this.statement(`UPDATE pi_jobs SET status=?,result=?,error_code=?,lease_token=NULL,lease_until=NULL,next_run=?,updated_at=?
      WHERE tenant_id=? AND id=? AND lease_token=? AND status='running'`, status, JSON.stringify(result), error, Date.now() + delaySeconds * 1000, new Date().toISOString(), job.tenant_id, job.id, job.lease_token).run();
  }
  async event(job: Job, outcome: string, latencyMs = 0) {
    await this.statement(`INSERT INTO pi_events(tenant_id,job_id,prospect_id,request_id,provider,operation,outcome,retry_count,latency_ms,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, job.tenant_id, job.id, job.prospect_id, job.request_id, job.provider, job.operation, outcome, Math.max(0, job.attempts - 1), latencyMs, new Date().toISOString()).run();
    console.log(JSON.stringify({ event: "prospecting", tenantId: job.tenant_id, requestId: job.request_id, traceId: job.request_id, jobId: job.id, prospectId: job.prospect_id, provider: job.provider, operation: job.operation, retryCount: Math.max(0, job.attempts - 1), outcome, latencyMs }));
  }
}
