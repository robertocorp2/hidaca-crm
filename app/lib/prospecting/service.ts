import { ProspectingError, type Context, type ConversionMapping, type Feature, type Job, type Provider, type ScoreSnapshot, type TenantPolicy } from "./contracts";
import { authorize, hash, idempotencyKey, object, parseSearch, requireFeature, safeLink, text, validatePolicy } from "./domain";
import { HidacaCrm } from "./crm";
import { Repository } from "./repository";

export interface RuntimeSwitches {
  PROSPECTING_TENANT_ALLOWLIST?: string;
  PROSPECTING_DISCOVERY_ENABLED?: string; PROSPECTING_ENRICHMENT_ENABLED?: string;
  PROSPECTING_SCORING_ENABLED?: string; PROSPECTING_AUDIT_ENABLED?: string; PROSPECTING_CRM_ENABLED?: string;
  PROSPECTING_DISABLED_PROVIDERS?: string;
}
export function effectivePolicy(policy: TenantPolicy, tenantId: string, switches: RuntimeSwitches): TenantPolicy {
  const copy = structuredClone(policy), allowed = (switches.PROSPECTING_TENANT_ALLOWLIST ?? "").split(",").map(s => s.trim()).includes(tenantId);
  const gates = { discovery: switches.PROSPECTING_DISCOVERY_ENABLED, enrichment: switches.PROSPECTING_ENRICHMENT_ENABLED, scoring: switches.PROSPECTING_SCORING_ENABLED, audit: switches.PROSPECTING_AUDIT_ENABLED, crm: switches.PROSPECTING_CRM_ENABLED };
  for (const feature of Object.keys(gates) as Feature[]) copy.enabled[feature] = copy.enabled[feature] && allowed && gates[feature] === "true";
  for (const provider of (switches.PROSPECTING_DISABLED_PROVIDERS ?? "").split(",")) if (provider in copy.providers) copy.providers[provider as Provider] = false;
  return copy;
}
export class ProspectingService {
  crm: HidacaCrm;
  constructor(public repo: Repository, private switches: RuntimeSwitches = {}) { this.crm = new HidacaCrm(repo); }
  async policy(context: Context) { authorize(context); return effectivePolicy(await this.repo.policy(context.tenantId), context.tenantId, this.switches); }
  private async rememberRequest(context: Context, scope: string, key: string, input: unknown) {
    const inputHash = await hash(input);
    await this.repo.statement("INSERT INTO pi_requests(tenant_id,scope,request_key,input_hash,actor,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING", context.tenantId, scope, key, inputHash, context.actor, new Date().toISOString()).run();
    const stored = await this.repo.one<{ input_hash: string }>("SELECT input_hash FROM pi_requests WHERE tenant_id=? AND scope=? AND request_key=?", context.tenantId, scope, key);
    if (stored?.input_hash !== inputHash) throw new ProspectingError("conflict", "La clave de idempotencia ya se utilizó con otros datos.");
  }
  async settings(context: Context) { authorize(context, false, true); return { stored: await this.repo.policy(context.tenantId), effective: await this.policy(context) }; }
  async savePolicy(context: Context, input: unknown) {
    authorize(context, true, true);
    const p = validatePolicy(input), now = new Date().toISOString();
    p.version = crypto.randomUUID(); p.scoring.version = p.version;
    await this.repo.db.batch([
      this.repo.statement(`INSERT INTO pi_policies(tenant_id,version,policy,actor,created_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET version=excluded.version,policy=excluded.policy,actor=excluded.actor,updated_at=excluded.updated_at`, context.tenantId, p.version, JSON.stringify(p), context.actor, now, now),
      this.repo.statement("INSERT INTO audit_log(actor_email,action,entity_type,entity_id,detail,created_at) VALUES(?,'policy_update','prospecting',?,?,?)", context.actor, context.tenantId, JSON.stringify(p), now),
    ]);
    return this.settings(context);
  }
  async prospect(context: Context, id: string) {
    authorize(context);
    const prospect = await this.repo.getProspect(context.tenantId, id);
    if (!prospect) throw new ProspectingError("not_found");
    return prospect;
  }
  async list(context: Context, cursor = "", limit = 20) {
    authorize(context);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 100) throw new ProspectingError("invalid_request");
    const rows = await this.repo.all<{ id: string }>("SELECT id FROM pi_prospects WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?", context.tenantId, cursor, limit + 1);
    return { prospects: await Promise.all(rows.slice(0, limit).map(r => this.summary(context, r.id))), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
  }
  async summaries(context: Context, ids: string[]) {
    authorize(context);
    if (!ids.length || ids.length > 50 || ids.some(id => !id || id.length > 100)) throw new ProspectingError("invalid_request");
    return { prospects: await Promise.all([...new Set(ids)].map(id => this.summary(context, id))) };
  }
  async summary(context: Context, id: string) {
    const prospect = await this.prospect(context, id);
    const [score, latest, jobs] = await Promise.all([
      this.repo.one<{ snapshot: string }>("SELECT snapshot FROM pi_scores WHERE tenant_id=? AND prospect_id=? ORDER BY created_at DESC,id DESC LIMIT 1", context.tenantId, id),
      this.repo.one<{ expires_at: string }>("SELECT expires_at FROM pi_snapshots WHERE tenant_id=? AND prospect_id=? AND provider='google_places' AND status IN ('complete','partial') ORDER BY retrieved_at DESC LIMIT 1", context.tenantId, id),
      this.repo.all<{ id: string; provider: string; status: string; error_code: string | null }>("SELECT id,provider,status,error_code FROM pi_jobs WHERE tenant_id=? AND prospect_id=? ORDER BY created_at DESC LIMIT 12", context.tenantId, id),
    ]);
    const scoreSnapshot: ScoreSnapshot | null = score ? JSON.parse(score.snapshot) : null;
    const expiredInputs = scoreSnapshot ? await this.repo.one<{ count: number }>(`SELECT count(*) count FROM pi_score_evidence e JOIN pi_snapshots s ON s.tenant_id=e.tenant_id AND s.id=e.snapshot_id
      WHERE e.tenant_id=? AND e.score_id=? AND s.expires_at<=?`, context.tenantId, scoreSnapshot.id, new Date().toISOString()) : null;
    const currentPolicy = await this.repo.policy(context.tenantId);
    const scoreStale = !!scoreSnapshot && (!!expiredInputs?.count || scoreSnapshot.configVersion !== currentPolicy.scoring.version);
    return { prospect, score: scoreSnapshot, scoreStale, stale: !latest || latest.expires_at <= new Date().toISOString(), jobs };
  }
  async detail(context: Context, id: string) {
    const summary = await this.summary(context, id);
    const [snapshots, sources, audits, exports, operations, scores] = await Promise.all([
      this.repo.snapshots(context.tenantId, id), this.repo.all("SELECT * FROM pi_sources WHERE tenant_id=? AND prospect_id=?", context.tenantId, id),
      this.repo.all("SELECT a.*, (SELECT json_group_array(json_object('ruleId',f.rule_id,'severity',f.severity,'text',f.finding,'remediation',f.remediation,'evidenceIds',json(f.evidence_ids))) FROM pi_findings f WHERE f.tenant_id=a.tenant_id AND f.audit_id=a.id) findings FROM pi_audits a WHERE a.tenant_id=? AND a.prospect_id=? ORDER BY a.created_at DESC LIMIT 20", context.tenantId, id),
      this.repo.all("SELECT id,status,error_code,created_at,updated_at FROM pi_exports WHERE tenant_id=? AND prospect_id=?", context.tenantId, id),
      this.repo.all("SELECT o.* FROM pi_export_operations o JOIN pi_exports e ON e.tenant_id=o.tenant_id AND e.id=o.export_id WHERE e.tenant_id=? AND e.prospect_id=? ORDER BY o.ordinal", context.tenantId, id),
      this.repo.all<{ snapshot: string }>("SELECT snapshot FROM pi_scores WHERE tenant_id=? AND prospect_id=? ORDER BY created_at DESC LIMIT 20", context.tenantId, id),
    ]);
    // The contact vault and provider credential references are never selected.
    return { ...summary, snapshots: snapshots.map(s => ({ ...s, stale: s.expiresAt <= new Date().toISOString(), data: { ...s.data, contacts: undefined } })), sources, audits, exports, operations, scores: scores.map(s => JSON.parse(s.snapshot)) };
  }
  async search(context: Context, value: unknown) {
    authorize(context, true);
    const input = parseSearch(value), policy = await this.policy(context); requireFeature(policy, "discovery", "google_places");
    const cacheKey = await hash([context.tenantId, policy.version, "places-v1-fields-1", { ...input, query: input.query.toLowerCase().replace(/\s+/g, " ") }]);
    const cached = await this.repo.one<{ id: string; status: string; expires_at: string }>("SELECT id,status,expires_at FROM pi_searches WHERE tenant_id=? AND cache_key=?", context.tenantId, cacheKey);
    if (cached && cached.expires_at > new Date().toISOString()) {
      // Recover a request interrupted after persisting the search but before
      // enqueueing its job. The stored expiration identifies this generation.
      if (cached.status === "queued") await this.repo.enqueue(context, { provider: "google_places", operation: "search", key: `search:${cached.id}:${cached.expires_at}`, payload: { searchId: cached.id, input } });
      return { ...await this.searchResult(context, cached.id), cached: true };
    }
    const minute = new Date().toISOString().slice(0, 16);
    const slot = await this.repo.one(`INSERT INTO pi_budgets(tenant_id,provider,window,used) VALUES(?,'search_requests',?,1)
      ON CONFLICT(tenant_id,provider,window) DO UPDATE SET used=used+1 WHERE used<30 RETURNING used`, context.tenantId, minute);
    if (!slot) throw new ProspectingError("rate_limited", "Límite de 30 búsquedas por minuto.", 60);
    const id = cached?.id ?? `s_${await hash([context.tenantId, cacheKey])}`, now = new Date().toISOString();
    await this.repo.statement(`INSERT INTO pi_searches(id,tenant_id,cache_key,input,status,expires_at,actor,created_at,updated_at)
      VALUES(?,?,?,?,'queued',?,?,?,?) ON CONFLICT(tenant_id,cache_key) DO UPDATE SET status='queued',input=excluded.input,expires_at=excluded.expires_at,error_code=NULL,updated_at=excluded.updated_at WHERE pi_searches.expires_at<=?`, id, context.tenantId, cacheKey, JSON.stringify(input), new Date(Date.now() + 86400000).toISOString(), context.actor, now, now, now).run();
    const generation = await this.repo.one<{ expires_at: string; input: string }>("SELECT expires_at,input FROM pi_searches WHERE tenant_id=? AND id=?", context.tenantId, id);
    const job = await this.repo.enqueue(context, { provider: "google_places", operation: "search", key: `search:${id}:${generation!.expires_at}`, payload: { searchId: id, input: JSON.parse(generation!.input) } });
    return { id, status: "queued", jobId: job.id, prospects: [], cached: false };
  }
  async searchResult(context: Context, id: string) {
    authorize(context);
    const row = await this.repo.one<{ id: string; status: string; prospect_ids: string; next_page_token: string; error_code: string | null; expires_at: string; input: string }>("SELECT * FROM pi_searches WHERE tenant_id=? AND id=?", context.tenantId, id);
    if (!row) throw new ProspectingError("not_found");
    const ids: string[] = JSON.parse(row.prospect_ids);
    const jobs = await this.repo.all<{ id: string; status: string; error_code: string | null }>("SELECT id,status,error_code FROM pi_jobs WHERE tenant_id=? AND operation='search' AND json_extract(payload,'$.searchId')=? ORDER BY created_at DESC LIMIT 1", context.tenantId, id);
    return { id, status: row.status, error: row.error_code, input: JSON.parse(row.input), nextPageToken: row.next_page_token, stale: row.expires_at <= new Date().toISOString(), prospects: await Promise.all(ids.map(id => this.summary(context, id))), jobs };
  }
  async enrich(context: Context, id: string, input: unknown = {}, audit = false) {
    authorize(context, true); await this.prospect(context, id);
    const p = object(input), policy = await this.policy(context); requireFeature(policy, "enrichment");
    if (audit) requireFeature(policy, "audit");
    const requested = p.providers ?? ["pagespeed", "builtwith", "hunter"];
    if (!Array.isArray(requested) || !requested.length || requested.length > 3 || requested.some(v => !["pagespeed", "builtwith", "hunter"].includes(v))) throw new ProspectingError("invalid_request");
    const key = idempotencyKey(p.idempotencyKey), jobs: Job[] = [];
    await this.rememberRequest(context, `enrich:${id}`, key, { providers: [...new Set(requested)].sort(), audit });
    const snapshots = await this.repo.snapshots(context.tenantId, id);
    for (const provider of [...new Set(requested)] as Provider[]) {
      const fresh = snapshots.find(s => s.source === provider && ["complete", "partial"].includes(s.status) && s.expiresAt > new Date().toISOString());
      if (fresh) continue;
      // Disabled providers also receive a visible policy-blocked outcome.
      jobs.push(await this.repo.enqueue(context, { prospectId: id, provider, operation: "enrich", key: `enrich:${id}:${provider}:${key}`, payload: {} }));
    }
    if (audit) jobs.push(await this.repo.enqueue(context, { prospectId: id, provider: "internal", operation: "audit", key: `audit:${id}:${key}`, payload: { dependencies: jobs.map(j => j.id) } }));
    return { jobs: jobs.map(j => this.publicJob(j)), status: jobs.length ? "queued" : "fresh" };
  }
  mapping(prospectId: string, value: unknown): ConversionMapping {
    const p = object(value);
    return { prospectId, companyId: text(p.companyId, 100) || null, contactId: text(p.contactId, 100) || null,
      contactName: text(p.contactName, 180), opportunityTitle: text(p.opportunityTitle, 200), reviewed: p.reviewed === true,
      companyName: text(p.companyName, 200), companyAddress: text(p.companyAddress, 500), companyPhone: text(p.companyPhone, 80),
      companyWebsite: safeLink(text(p.companyWebsite, 2048)), contactPhone: text(p.contactPhone, 80) };
  }
  async preview(context: Context, input: unknown) {
    authorize(context, true); const p = object(input), policy = await this.policy(context); requireFeature(policy, "crm");
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > policy.maxBatch) throw new ProspectingError("invalid_request");
    const previews = [];
    for (const raw of p.items) {
      const item = object(raw), id = text(item.prospectId, 100), prospect = await this.prospect(context, id);
      const preview = await this.crm.preview(context, prospect, this.mapping(id, item));
      preview.exportState = await this.repo.one<{ id: string; status: string }>("SELECT id,status FROM pi_exports WHERE tenant_id=? AND prospect_id=?", context.tenantId, id);
      const listing = (await this.repo.snapshots(context.tenantId, id)).find(s => s.source === "google_places" && ["complete", "partial"].includes(s.status));
      if (!listing || listing.expiresAt <= new Date().toISOString()) preview.conflicts.push("La ficha de origen está vencida; vuelve a buscar el negocio.");
      previews.push(preview);
    }
    return { previews };
  }
  async convert(context: Context, input: unknown) {
    authorize(context, true); const p = object(input), policy = await this.policy(context); requireFeature(policy, "crm");
    const key = idempotencyKey(p.idempotencyKey);
    if (p.confirmed !== true) throw new ProspectingError("invalid_request", "Se requiere confirmar la vista previa.");
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > policy.maxBatch) throw new ProspectingError("invalid_request");
    // Validate every tenant-bound ID before recording any export in a batch.
    for (const raw of p.items) await this.prospect(context, text(object(raw).prospectId, 100));
    await this.rememberRequest(context, "convert", key, p.items.map(raw => {
      const item = object(raw); return this.mapping(text(item.prospectId, 100), item);
    }).sort((a, b) => a.prospectId.localeCompare(b.prospectId)));
    const jobs = [], outcomes = [];
    for (const raw of p.items) {
      const item = object(raw), id = text(item.prospectId, 100), mapping = this.mapping(id, item);
      const existing = await this.repo.one<{ id: string; status: string; mapping: string }>("SELECT * FROM pi_exports WHERE tenant_id=? AND prospect_id=?", context.tenantId, id);
      if (existing?.status === "completed") { outcomes.push({ prospectId: id, exportId: existing.id, status: "completed" }); continue; }
      if (existing && existing.mapping !== JSON.stringify(mapping)) throw new ProspectingError("conflict", "La conversión existente utiliza otro mapeo. Utiliza la reparación con una vista previa revisada.");
      const preview = (await this.preview(context, { items: [item] })).previews[0];
      if (preview.missing.length || preview.conflicts.length || (!existing && item.fingerprint !== preview.fingerprint)) throw new ProspectingError("conflict", "La vista previa cambió o tiene conflictos; revísala de nuevo.");
      const exportId = existing?.id ?? `ex_${await hash([context.tenantId, id])}`, now = new Date().toISOString();
      await this.repo.db.batch([
        this.repo.statement(`INSERT INTO pi_exports(id,tenant_id,prospect_id,idempotency_key,mapping,fingerprint,status,actor,created_at,updated_at)
          VALUES(?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT DO NOTHING`, exportId, context.tenantId, id, `${key}:${id}`, JSON.stringify(mapping), preview.fingerprint, context.actor, now, now),
        this.repo.statement("INSERT INTO pi_dedup_decisions(id,tenant_id,prospect_id,candidates,resolution,reviewer,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", exportId, context.tenantId, id, JSON.stringify({ company: preview.company.matches, contact: preview.contact.matches }), JSON.stringify(mapping), context.actor, now),
      ]);
      const job = await this.repo.enqueue(context, { prospectId: id, provider: "hidaca", operation: "convert", key: `convert:${exportId}`, payload: { exportId } });
      jobs.push(this.publicJob(job)); outcomes.push({ prospectId: id, exportId, status: job.status });
    }
    return { jobs, outcomes };
  }
  async repair(context: Context, input: unknown) {
    authorize(context, true); const p = object(input), policy = await this.policy(context); requireFeature(policy, "crm");
    const key = idempotencyKey(p.idempotencyKey);
    if (p.confirmed !== true || !Array.isArray(p.items) || !p.items.length || p.items.length > policy.maxBatch) throw new ProspectingError("invalid_request");
    const previews = (await this.preview(context, p)).previews;
    await this.rememberRequest(context, "repair", key, p.items.map(raw => { const item = object(raw); return this.mapping(text(item.prospectId, 100), item); }));
    const results = [];
    for (let i = 0; i < previews.length; i++) {
      const preview = previews[i], item = object(p.items[i]);
      const existing = await this.repo.one<{ id: string; status: string; mapping: string }>("SELECT * FROM pi_exports WHERE tenant_id=? AND prospect_id=?", context.tenantId, preview.prospectId);
      if (!existing) throw new ProspectingError("not_found");
      const applied = await this.repo.one("SELECT id FROM pi_dedup_decisions WHERE tenant_id=? AND id=?", context.tenantId, `${existing.id}:repair:${key}`);
      if (applied) {
        if (existing.status === "queued") await this.repo.enqueue(context, { prospectId: preview.prospectId, provider: "hidaca", operation: "convert", key: `convert:${existing.id}`, payload: { exportId: existing.id } });
        results.push({ exportId: existing.id, status: existing.status }); continue;
      }
      if (existing.status === "completed") { results.push({ exportId: existing.id, status: "completed" }); continue; }
      if (preview.missing.length || preview.conflicts.length || preview.fingerprint !== item.fingerprint) throw new ProspectingError("conflict", "Actualiza la vista previa antes de reparar.");
      const previous: ConversionMapping = JSON.parse(existing.mapping);
      const completed = await this.repo.all<{ operation: string; remote_id: string }>("SELECT operation,remote_id FROM pi_export_operations WHERE tenant_id=? AND export_id=? AND status='completed'", context.tenantId, existing.id);
      for (const operation of completed) {
        if (operation.operation === "company" && preview.mapping.companyId !== operation.remote_id) throw new ProspectingError("conflict", "La empresa ya creada no puede cambiar durante una reparación.");
        if (operation.operation === "contact" && (preview.mapping.contactId !== operation.remote_id || preview.mapping.contactName !== previous.contactName)) throw new ProspectingError("conflict", "El contacto ya creado no puede cambiar durante una reparación.");
        if (operation.operation === "opportunity" && preview.mapping.opportunityTitle !== previous.opportunityTitle) throw new ProspectingError("conflict", "La oportunidad ya creada no puede cambiar durante una reparación.");
      }
      const now = new Date().toISOString(), mapping = JSON.stringify(preview.mapping);
      const updates = await this.repo.db.batch([
        this.repo.statement(`UPDATE pi_exports SET mapping=?,fingerprint=?,status='queued',error_code=NULL,updated_at=?
          WHERE tenant_id=? AND id=? AND status IN ('failed','partial','queued')
          AND NOT EXISTS(SELECT 1 FROM pi_jobs j WHERE j.tenant_id=pi_exports.tenant_id AND j.operation='convert' AND json_extract(j.payload,'$.exportId')=pi_exports.id AND j.status IN ('running','retrying')) RETURNING id`, mapping, preview.fingerprint, now, context.tenantId, existing.id),
        this.repo.statement(`UPDATE pi_jobs SET status='queued',attempts=0,error_code=NULL,next_run=?,updated_at=?,actor=?,request_id=?
          WHERE tenant_id=? AND operation='convert' AND json_extract(payload,'$.exportId')=? AND status IN ('failed','dead_letter','cancelled','queued')
          AND EXISTS(SELECT 1 FROM pi_exports e WHERE e.tenant_id=pi_jobs.tenant_id AND e.id=? AND e.mapping=? AND e.updated_at=?)`, Date.now(), now, context.actor, context.requestId, context.tenantId, existing.id, existing.id, mapping, now),
        this.repo.statement(`INSERT INTO pi_dedup_decisions(id,tenant_id,prospect_id,candidates,resolution,reviewer,created_at)
          SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pi_exports WHERE tenant_id=? AND id=? AND mapping=? AND updated_at=?) ON CONFLICT DO NOTHING`, `${existing.id}:repair:${key}`, context.tenantId, preview.prospectId, JSON.stringify({ company: preview.company.matches, contact: preview.contact.matches }), mapping, context.actor, now, context.tenantId, existing.id, mapping, now),
      ]);
      if (!updates[0].results.length) throw new ProspectingError("conflict", "La conversión está en curso; espera antes de reparar.");
      await this.repo.enqueue(context, { prospectId: preview.prospectId, provider: "hidaca", operation: "convert", key: `convert:${existing.id}`, payload: { exportId: existing.id } });
      results.push({ exportId: existing.id, status: "queued" });
    }
    return { outcomes: results };
  }
  publicJob(job: Job) { return { id: job.id, prospectId: job.prospect_id, provider: job.provider, operation: job.operation, status: job.status, attempts: job.attempts, error: job.error_code, nextRun: job.next_run, result: job.result ? JSON.parse(job.result) : null, updatedAt: job.updated_at }; }
  async job(context: Context, id: string) {
    authorize(context); const job = await this.repo.one<Job>("SELECT * FROM pi_jobs WHERE tenant_id=? AND id=?", context.tenantId, id);
    if (!job) throw new ProspectingError("not_found"); return this.publicJob(job);
  }
  async retry(context: Context, id: string) {
    authorize(context, true);
    const job = await this.repo.one<Job>("SELECT * FROM pi_jobs WHERE tenant_id=? AND id=?", context.tenantId, id);
    if (!job) throw new ProspectingError("not_found");
    if (job.status === "dead_letter") authorize(context, true, true);
    const policy = await this.policy(context); requireFeature(policy, job.operation === "search" ? "discovery" : job.operation === "convert" ? "crm" : job.operation === "audit" ? "audit" : "enrichment");
    if (!["failed", "dead_letter", "cancelled"].includes(job.status)) return this.publicJob(job);
    // New evidence requires a new immutable snapshot/job; failed enrichments can
    // be requested again with a new idempotency key from the detail view.
    if (job.operation === "enrich" && ["failed", "dead_letter", "cancelled"].includes(job.status)) return this.enrich(context, job.prospect_id!, { providers: [job.provider], idempotencyKey: `retry:${id}:${crypto.randomUUID()}` });
    const updates = await this.repo.db.batch([
      this.repo.statement(`UPDATE pi_jobs SET status='queued',attempts=0,error_code=NULL,next_run=?,updated_at=? WHERE tenant_id=? AND id=? AND status IN ('failed','dead_letter','cancelled')
        AND NOT EXISTS(SELECT 1 FROM pi_jobs active WHERE active.tenant_id=pi_jobs.tenant_id AND active.prospect_id=pi_jobs.prospect_id AND active.provider=pi_jobs.provider AND active.operation=pi_jobs.operation AND active.status IN ('queued','running','retrying')) RETURNING id`, Date.now(), new Date().toISOString(), context.tenantId, id),
      this.repo.statement("UPDATE pi_searches SET status='queued',error_code=NULL,updated_at=? WHERE tenant_id=? AND id=? AND EXISTS(SELECT 1 FROM pi_jobs WHERE tenant_id=? AND id=? AND status='queued')", new Date().toISOString(), context.tenantId, JSON.parse(job.payload).searchId ?? "", context.tenantId, id),
      this.repo.statement("UPDATE pi_exports SET status='queued',error_code=NULL,updated_at=? WHERE tenant_id=? AND id=? AND EXISTS(SELECT 1 FROM pi_jobs WHERE tenant_id=? AND id=? AND status='queued')", new Date().toISOString(), context.tenantId, JSON.parse(job.payload).exportId ?? "", context.tenantId, id),
      this.repo.statement("INSERT INTO audit_log(actor_email,action,entity_type,entity_id,detail,created_at) VALUES(?,'job_retry','prospecting_job',?,'Explicit retry',?)", context.actor, id, new Date().toISOString()),
    ]);
    if (!updates[0].results.length) throw new ProspectingError("conflict", "Ya existe un trabajo activo para esta operación.");
    return this.job(context, id);
  }
  async bulk(context: Context, input: unknown) {
    authorize(context, true); const p = object(input), policy = await this.policy(context), key = idempotencyKey(p.idempotencyKey);
    if (p.operation !== "enrich" && p.operation !== "audit") throw new ProspectingError("invalid_request");
    requireFeature(policy, "enrichment"); if (p.operation === "audit") requireFeature(policy, "audit");
    if (!Array.isArray(p.prospectIds) || !p.prospectIds.length || p.prospectIds.length > policy.maxBatch || p.prospectIds.some(v => typeof v !== "string")) throw new ProspectingError("invalid_request");
    const ids = [...new Set(p.prospectIds as string[])].sort(), inputHash = await hash([p.operation, ids]);
    for (const id of ids) await this.prospect(context, id);
    const existing = await this.repo.one<{ id: string; input_hash: string; cancelled: number }>("SELECT * FROM pi_bulk WHERE tenant_id=? AND idempotency_key=?", context.tenantId, key);
    if (existing && existing.input_hash !== inputHash) throw new ProspectingError("conflict");
    if (existing?.cancelled) return this.bulkStatus(context, existing.id);
    const id = existing?.id ?? `bulk_${await hash([context.tenantId, key])}`;
    if (!existing) {
      const calls: Partial<Record<Provider, number>> = {}; let requiredJobs = 0;
      for (const prospectId of ids) {
        const prospect = await this.prospect(context, prospectId), snapshots = await this.repo.snapshots(context.tenantId, prospectId);
        for (const provider of ["pagespeed", "builtwith", "hunter"] as Provider[]) {
          if (snapshots.some(s => s.source === provider && ["complete", "partial"].includes(s.status) && s.expiresAt > new Date().toISOString())) continue;
          if (await this.repo.one("SELECT id FROM pi_jobs WHERE tenant_id=? AND prospect_id=? AND provider=? AND operation='enrich' AND status IN ('queued','running','retrying')", context.tenantId, prospectId, provider)) continue;
          requiredJobs++;
          if (prospect.website && policy.providers[provider] && (provider !== "hunter" || (policy.contactAllowed && policy.contactPolicyReference))) calls[provider] = (calls[provider] ?? 0) + 1;
        }
        if (p.operation === "audit" && !await this.repo.one("SELECT id FROM pi_jobs WHERE tenant_id=? AND prospect_id=? AND operation='audit' AND status IN ('queued','running','retrying')", context.tenantId, prospectId)) requiredJobs++;
      }
      const pending = await this.repo.one<{ count: number }>("SELECT count(*) count FROM pi_jobs WHERE tenant_id=? AND status IN ('queued','running','retrying')", context.tenantId);
      if ((pending?.count ?? 0) + requiredJobs > policy.maxQueuedJobs) throw new ProspectingError("rate_limited", "La cola no tiene capacidad para este lote.", 60);
      const budgets = await this.repo.all<{ provider: string; used: number }>("SELECT provider,used FROM pi_budgets WHERE tenant_id=? AND window=?", context.tenantId, new Date().toISOString().slice(0, 10));
      const used = (provider: string) => budgets.find(b => b.provider === provider)?.used ?? 0;
      if (used("all") + Object.values(calls).reduce((a, b) => a + b, 0) > policy.dailyBudget || Object.entries(calls).some(([provider, count]) => used(provider) + count > policy.providerBudgets[provider as Provider])) throw new ProspectingError("budget_exhausted");
      // This is admission preflight; atomic enqueue and worker reservations also
      // enforce caps if other requests consume capacity after this read.
    }
    await this.repo.statement("INSERT INTO pi_bulk(id,tenant_id,idempotency_key,input_hash,operation,actor,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", id, context.tenantId, key, inputHash, p.operation, context.actor, new Date().toISOString()).run();
    for (const prospectId of ids) {
      const result = await this.enrich(context, prospectId, { idempotencyKey: `bulk:${id}` }, p.operation === "audit");
      for (const job of result.jobs) await this.repo.statement("INSERT INTO pi_bulk_items(tenant_id,bulk_id,prospect_id,job_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING", context.tenantId, id, prospectId, job.id).run();
    }
    return this.bulkStatus(context, id);
  }
  async bulkStatus(context: Context, id: string) {
    authorize(context);
    const bulk = await this.repo.one<{ id: string; operation: string; cancelled: number; created_at: string }>("SELECT id,operation,cancelled,created_at FROM pi_bulk WHERE tenant_id=? AND id=?", context.tenantId, id);
    if (!bulk) throw new ProspectingError("not_found");
    const jobs = await this.repo.all<Job>("SELECT j.* FROM pi_jobs j JOIN pi_bulk_items i ON i.tenant_id=j.tenant_id AND i.job_id=j.id WHERE i.tenant_id=? AND i.bulk_id=? ORDER BY i.prospect_id,j.created_at", context.tenantId, id);
    return { ...bulk, jobs: jobs.map(j => this.publicJob(j)), total: jobs.length, completed: jobs.filter(j => j.status === "completed").length, failed: jobs.filter(j => ["failed", "dead_letter"].includes(j.status)).length };
  }
  async cancelBulk(context: Context, id: string) {
    authorize(context, true); await this.bulkStatus(context, id);
    await this.repo.db.batch([
      this.repo.statement("UPDATE pi_bulk SET cancelled=1 WHERE tenant_id=? AND id=?", context.tenantId, id),
      this.repo.statement(`UPDATE pi_jobs SET status='cancelled',updated_at=? WHERE tenant_id=? AND status IN ('queued','retrying')
        AND dedupe_key LIKE ? AND id IN (SELECT job_id FROM pi_bulk_items WHERE tenant_id=? AND bulk_id=?)
        AND NOT EXISTS(SELECT 1 FROM pi_bulk_items i JOIN pi_bulk b ON b.tenant_id=i.tenant_id AND b.id=i.bulk_id
          WHERE i.tenant_id=pi_jobs.tenant_id AND i.job_id=pi_jobs.id AND b.id<>? AND b.cancelled=0)`, new Date().toISOString(), context.tenantId, `%:bulk:${id}`, context.tenantId, id, id),
    ]); return this.bulkStatus(context, id);
  }
  async metrics(context: Context) {
    authorize(context, false, true);
    const policy = await this.policy(context);
    const [jobs, budgets, events, freshness, coverage, exports] = await Promise.all([
      this.repo.all<{ status: string; count: number; oldest: string }>("SELECT status,count(*) count,min(created_at) oldest FROM pi_jobs WHERE tenant_id=? GROUP BY status", context.tenantId),
      this.repo.all<{ provider: string; used: number; window: string }>("SELECT provider,used,window FROM pi_budgets WHERE tenant_id=? AND window=? AND provider<>'search_requests'", context.tenantId, new Date().toISOString().slice(0, 10)),
      this.repo.all<{ provider: string; outcome: string; count: number; latency: number }>("SELECT provider,outcome,count(*) count,avg(latency_ms) latency FROM pi_events WHERE tenant_id=? AND created_at>=? GROUP BY provider,outcome", context.tenantId, new Date(Date.now() - 86400000).toISOString()),
      this.repo.one<{ total: number; stale: number | null }>(`SELECT count(*) total,sum(s.expires_at<=?) stale FROM pi_snapshots s WHERE s.tenant_id=? AND s.status IN ('complete','partial')
        AND NOT EXISTS(SELECT 1 FROM pi_snapshots n WHERE n.tenant_id=s.tenant_id AND n.prospect_id=s.prospect_id AND n.provider=s.provider AND n.status IN ('complete','partial') AND (n.retrieved_at>s.retrieved_at OR (n.retrieved_at=s.retrieved_at AND n.id>s.id)))`, new Date().toISOString(), context.tenantId),
      this.repo.one<{ average: number | null; count: number }>(`SELECT avg(json_extract(s.snapshot,'$.digitalHealth.coverage')) average,count(*) count FROM pi_scores s WHERE s.tenant_id=?
        AND NOT EXISTS(SELECT 1 FROM pi_scores n WHERE n.tenant_id=s.tenant_id AND n.prospect_id=s.prospect_id AND (n.created_at>s.created_at OR (n.created_at=s.created_at AND n.id>s.id)))`, context.tenantId),
      this.repo.all<{ status: string; count: number }>("SELECT status,count(*) count FROM pi_exports WHERE tenant_id=? GROUP BY status", context.tenantId),
    ]);
    const alerts: string[] = [];
    if (jobs.some(j => j.status === "dead_letter" && j.count)) alerts.push("Trabajos en dead letter requieren revisión.");
    if (jobs.some(j => ["queued", "retrying"].includes(j.status) && Date.parse(j.oldest) < Date.now() - 900000)) alerts.push("La cola tiene trabajos de más de 15 minutos.");
    if (exports.some(e => ["partial", "failed"].includes(e.status) && e.count)) alerts.push("Hay conversiones pendientes de reparación.");
    for (const budget of budgets) {
      const limit = budget.provider === "all" ? policy.dailyBudget : policy.providerBudgets?.[budget.provider as Provider] ?? policy.dailyBudget;
      if (budget.used >= limit * 0.8) alerts.push(`Presupuesto ${budget.provider}: ${budget.used} de ${limit} unidades reservadas.`);
    }
    for (const provider of new Set(events.map(e => e.provider))) {
      const samples = events.filter(e => e.provider === provider && !["policy_blocked", "budget_exhausted"].includes(e.outcome));
      const total = samples.reduce((sum, e) => sum + e.count, 0), failures = samples.filter(e => e.outcome !== "completed").reduce((sum, e) => sum + e.count, 0);
      if (total >= 5 && failures / total >= 0.2) alerts.push(`${provider}: ${Math.round(failures / total * 100)}% de errores en las últimas 24 horas.`);
    }
    if (freshness?.total && (freshness.stale ?? 0) / freshness.total >= 0.5) alerts.push("Al menos la mitad de la evidencia vigente más reciente necesita actualización.");
    if (coverage?.count && (coverage.average ?? 0) < policy.scoring.minimumCoverage) alerts.push("La cobertura promedio de las puntuaciones está por debajo del mínimo configurado.");
    return { jobs, budgets, events, freshness, coverage, exports, alerts };
  }
  async deleteContacts(context: Context, prospectId: string) {
    authorize(context, true, true); await this.prospect(context, prospectId);
    await this.repo.db.batch([
      this.repo.statement("DELETE FROM pi_contact_vault WHERE tenant_id=? AND snapshot_id IN(SELECT id FROM pi_snapshots WHERE tenant_id=? AND prospect_id=?)", context.tenantId, context.tenantId, prospectId),
      this.repo.statement("INSERT INTO audit_log(actor_email,action,entity_type,entity_id,detail,created_at) VALUES(?,'contact_erasure','prospecting',?,'Encrypted contact payloads erased; evidence metadata retained',?)", context.actor, prospectId, new Date().toISOString()),
    ]); return { deleted: true };
  }
}
