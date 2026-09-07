import { ProspectingError, retryable, type Context, type ConversionMapping, type DiscoveryPort, type EnrichmentPort, type Job, type Provider, type ProviderResult, type ScoreSnapshot, type Snapshot, type TenantPolicy } from "./contracts";
import { hash, requireFeature } from "./domain";
import { auditFindings, calculateScores, eligibleSnapshots, SCORING_VERSION } from "./scoring";
import { sealContacts } from "./providers";
import { Repository } from "./repository";
import { effectivePolicy, ProspectingService, type RuntimeSwitches } from "./service";

export interface Adapters {
  discovery(): DiscoveryPort;
  enrichment(provider: Provider): EnrichmentPort;
  contactEncryptionKey(): string;
}
export class WorkerRuntime {
  service: ProspectingService;
  constructor(private repo: Repository, private switches: RuntimeSwitches, private adapters: Adapters) { this.service = new ProspectingService(repo, switches); }
  private context(job: Job): Context { return { tenantId: job.tenant_id, actor: job.actor, role: "operator", requestId: job.request_id }; }
  async tick(tenantId: string, maxJobs = 10) {
    const policy = effectivePolicy(await this.repo.policy(tenantId), tenantId, this.switches);
    // Privacy cleanup must continue while every feature is switched off.
    await this.repo.statement("DELETE FROM pi_contact_vault WHERE tenant_id=? AND expires_at<=?", tenantId, new Date().toISOString()).run();
    await this.repo.statement("DELETE FROM pi_events WHERE tenant_id=? AND created_at<?", tenantId, new Date(Date.now() - policy.retentionDays * 86400000).toISOString()).run();
    await this.repo.statement("DELETE FROM pi_budgets WHERE tenant_id=? AND window<?", tenantId, new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)).run();
    await this.repo.statement("DELETE FROM pi_budget_reservations WHERE tenant_id=? AND window<?", tenantId, new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)).run();
    if (!Object.values(policy.enabled).some(Boolean)) return { processed: 0 };
    let processed = 0;
    // Bounded sequential drain per invocation. Multiple invocations safely share
    // the D1 leases and tenant/provider concurrency guards.
    while (processed < Math.min(maxJobs, 10)) {
      const job = await this.repo.claim(tenantId, policy);
      if (!job) break;
      await this.execute(job); processed++;
    }
    const abandoned = await this.repo.all<Job>("SELECT j.* FROM pi_jobs j WHERE j.tenant_id=? AND j.operation='enrich' AND j.status='dead_letter' AND j.prospect_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pi_snapshots s WHERE s.tenant_id=j.tenant_id AND s.job_id=j.id) LIMIT 10", tenantId);
    for (const job of abandoned) await this.saveSnapshot(job, job.prospect_id!, { data: {}, status: "failed", providerVersion: "v1", ttlSeconds: 3600 }, Date.now(), "timeout");
    return { processed };
  }
  private async permitted(job: Job) {
    const staff = await this.repo.one<{ role: string }>("SELECT role FROM staff_users WHERE email=? AND active=1", job.actor);
    if (!staff || !["admin", "operator"].includes(staff.role)) throw new ProspectingError("forbidden");
    const policy = effectivePolicy(await this.repo.policy(job.tenant_id), job.tenant_id, this.switches);
    requireFeature(policy, job.operation === "search" ? "discovery" : job.operation === "convert" ? "crm" : job.operation === "audit" ? "audit" : "enrichment",
      job.operation === "search" || job.operation === "enrich" ? job.provider as Provider : undefined);
    if (job.provider === "hunter" && (!policy.contactAllowed || !policy.contactPolicyReference || !this.adapters.contactEncryptionKey())) throw new ProspectingError("policy_blocked");
    if (!await this.repo.renew(job)) throw new ProspectingError("conflict");
    return policy;
  }
  async execute(job: Job) {
    const start = Date.now();
    try {
      const policy = await this.permitted(job);
      const payload = JSON.parse(job.payload);
      if (job.operation === "enrich") {
        const persisted = await this.repo.one<{ snapshot: string }>("SELECT snapshot FROM pi_snapshots WHERE tenant_id=? AND prospect_id=? AND job_id=?", job.tenant_id, job.prospect_id, job.id);
        if (persisted) {
          const snapshot: Snapshot = JSON.parse(persisted.snapshot);
          const score = policy.enabled.scoring ? await this.score(job, job.prospect_id!, policy) : null;
          await this.repo.finish(job, ["complete", "partial", "missing"].includes(snapshot.status) ? "completed" : "failed", { status: snapshot.status, scoreId: score?.id ?? null }, snapshot.error);
          return;
        }
      }
      if (job.operation === "audit") {
        const persisted = await this.repo.one<{ id: string; status: string }>("SELECT id,status FROM pi_audits WHERE tenant_id=? AND job_id=?", job.tenant_id, job.id);
        if (persisted && persisted.status !== "failed") { await this.repo.finish(job, "completed", { auditId: persisted.id }); return; }
      }
      if (job.operation === "audit") {
        const dependencies: string[] = payload.dependencies ?? [];
        for (const id of dependencies) {
          const dependency = await this.repo.one<{ status: string }>("SELECT status FROM pi_jobs WHERE tenant_id=? AND id=?", job.tenant_id, id);
          if (dependency && ["queued", "running", "retrying"].includes(dependency.status)) {
            // Waiting for dependencies is not a provider attempt or failure.
            await this.repo.statement("UPDATE pi_jobs SET status='queued',attempts=attempts-1,next_run=?,lease_until=NULL,lease_token=NULL WHERE tenant_id=? AND id=? AND lease_token=?", Date.now() + 15000, job.tenant_id, job.id, job.lease_token).run();
            return;
          }
        }
      }
      let result: unknown;
      if (job.operation === "search") {
        await this.repo.reserveBudget(job, policy);
        const discovery = await this.adapters.discovery().discoverBusinesses(payload.input);
        if (!await this.repo.owns(job)) return;
        const ids: string[] = []; let partial = discovery.partial;
        for (const facts of discovery.businesses) {
          try {
            await this.permitted(job);
            const prospect = await this.repo.canonicalize(this.context(job), facts); ids.push(prospect.id);
            await this.saveSnapshot(job, prospect.id, { data: { facts }, status: "complete", providerVersion: "places-v1-fields-1", ttlSeconds: 86400 }, start);
            if (policy.enabled.scoring) await this.score(job, prospect.id, policy);
          } catch (error) { if (error instanceof ProspectingError && error.code === "conflict") partial = true; else throw error; }
        }
        await this.repo.statement("UPDATE pi_searches SET status=?,prospect_ids=?,next_page_token=?,error_code=NULL,updated_at=? WHERE tenant_id=? AND id=?", partial ? "partial" : "completed", JSON.stringify([...new Set(ids)]), discovery.nextPageToken, new Date().toISOString(), job.tenant_id, payload.searchId).run();
        result = { searchId: payload.searchId, count: new Set(ids).size, partial };
      } else if (job.operation === "enrich") {
        const prospect = await this.service.prospect(this.context(job), job.prospect_id!);
        let enriched: ProviderResult;
        if (!prospect.website) enriched = { data: {}, status: "missing", providerVersion: "v1", ttlSeconds: 86400 };
        else { await this.repo.reserveBudget(job, policy); enriched = await this.adapters.enrichment(job.provider as Provider).enrich(prospect); }
        if (!await this.repo.owns(job)) return;
        await this.saveSnapshot(job, prospect.id, enriched, start);
        const score = policy.enabled.scoring ? await this.score(job, prospect.id, policy) : null;
        result = { status: enriched.status, scoreId: score?.id ?? null };
      } else if (job.operation === "audit") {
        requireFeature(policy, "scoring");
        const score = await this.score(job, job.prospect_id!, policy), snapshots = await this.repo.snapshots(job.tenant_id, job.prospect_id!);
        const findings = auditFindings(score, snapshots), now = new Date().toISOString();
        await this.repo.db.batch([
          this.repo.statement("INSERT INTO pi_audits(id,tenant_id,prospect_id,job_id,status,score_id,actor,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET status=excluded.status,score_id=excluded.score_id WHERE pi_audits.status='failed'", job.id, job.tenant_id, job.prospect_id, job.id, score.digitalHealth.unknown.length ? "partial" : "completed", score.id, job.actor, now),
          ...findings.map((finding, index) => this.repo.statement("INSERT INTO pi_findings(id,tenant_id,audit_id,rule_id,severity,finding,remediation,evidence_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", `${job.id}:${index}`, job.tenant_id, job.id, finding.ruleId, finding.severity, finding.text, finding.remediation, JSON.stringify(finding.evidenceIds), now)),
        ]);
        result = { auditId: job.id, findings: findings.length, scoreId: score.id };
      } else {
        const exportRow = await this.repo.one<{ mapping: string; status: string; fingerprint: string }>("SELECT * FROM pi_exports WHERE tenant_id=? AND id=?", job.tenant_id, payload.exportId);
        if (!exportRow) throw new ProspectingError("not_found");
        const prospect = await this.service.prospect(this.context(job), job.prospect_id!), mapping: ConversionMapping = JSON.parse(exportRow.mapping);
        const preview = await this.service.crm.preview(this.context(job), prospect, mapping);
        // Re-evaluate conflicts on every attempt; do not erase completed steps.
        if (preview.conflicts.length || preview.missing.length) throw new ProspectingError("conflict");
        const steps = await this.repo.one<{ count: number }>("SELECT count(*) count FROM pi_export_operations WHERE tenant_id=? AND export_id=? AND status='completed'", job.tenant_id, payload.exportId);
        if (!steps?.count && preview.fingerprint !== exportRow.fingerprint) throw new ProspectingError("conflict", "El mapeo cambió después de confirmar.");
        const companyId = await this.service.crm.createCompany(this.context(job), prospect, mapping, payload.exportId);
        await this.permitted(job);
        const contactId = await this.service.crm.createContact(this.context(job), prospect, mapping, payload.exportId, companyId);
        await this.permitted(job);
        const opportunityId = await this.service.crm.createOpportunity(this.context(job), prospect, mapping, payload.exportId, companyId, contactId);
        await this.permitted(job);
        const pipeline = await this.service.crm.ensurePipeline(this.context(job));
        await this.repo.db.batch([
          this.repo.statement("INSERT INTO pi_export_operations(tenant_id,export_id,operation,ordinal,status,remote_id,attempts,updated_at) VALUES(?,?,'pipeline',4,'completed',?,1,?) ON CONFLICT DO NOTHING", job.tenant_id, payload.exportId, pipeline.id, new Date().toISOString()),
          this.repo.statement("UPDATE pi_exports SET status='completed',error_code=NULL,updated_at=? WHERE tenant_id=? AND id=?", new Date().toISOString(), job.tenant_id, payload.exportId),
        ]);
        result = { exportId: payload.exportId, companyId, contactId, opportunityId, pipelineId: pipeline.id };
      }
      await this.repo.finish(job, "completed", result);
      await this.repo.statement("INSERT INTO pi_circuits(tenant_id,provider,failures,open_until) VALUES(?,?,0,0) ON CONFLICT(tenant_id,provider) DO UPDATE SET failures=0,open_until=0", job.tenant_id, job.provider).run();
      await this.repo.event(job, "completed", Date.now() - start);
    } catch (error) {
      if (!await this.repo.owns(job)) return;
      const typed = error instanceof ProspectingError ? error : new ProspectingError("unknown");
      const status = retryable(typed.code) ? job.attempts >= job.max_attempts ? "dead_letter" : "retrying" : "failed";
      const jitter = crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff;
      const delay = Math.max(typed.retryAfter, Math.min(3600, 5 * 2 ** job.attempts + jitter * 5));
      if (status !== "retrying" && job.operation === "enrich") {
        await this.saveSnapshot(job, job.prospect_id!, { data: {}, status: typed.code === "policy_blocked" ? "policy_blocked" : "failed", providerVersion: "v1", ttlSeconds: 3600 }, start, typed.code);
      }
      if (job.operation === "search") {
        await this.repo.statement("UPDATE pi_searches SET status=?,error_code=?,updated_at=? WHERE tenant_id=? AND id=?", status, typed.code, new Date().toISOString(), job.tenant_id, JSON.parse(job.payload).searchId).run();
      }
      if (job.operation === "convert") {
        await this.repo.statement("UPDATE pi_exports SET status=CASE WHEN EXISTS(SELECT 1 FROM pi_export_operations o WHERE o.tenant_id=pi_exports.tenant_id AND o.export_id=pi_exports.id AND o.status='completed') THEN 'partial' ELSE 'failed' END,error_code=?,updated_at=? WHERE tenant_id=? AND id=?", typed.code, new Date().toISOString(), job.tenant_id, JSON.parse(job.payload).exportId).run();
      }
      if (job.operation === "audit" && status !== "retrying") {
        await this.repo.statement("INSERT INTO pi_audits(id,tenant_id,prospect_id,job_id,status,actor,created_at) VALUES(?,?,?,?,'failed',?,?) ON CONFLICT DO NOTHING", job.id, job.tenant_id, job.prospect_id, job.id, job.actor, new Date().toISOString()).run();
      }
      if (retryable(typed.code)) await this.repo.statement(`INSERT INTO pi_circuits(tenant_id,provider,failures,open_until) VALUES(?,?,1,0)
        ON CONFLICT(tenant_id,provider) DO UPDATE SET failures=failures+1,open_until=CASE WHEN failures+1>=5 THEN ? ELSE open_until END`, job.tenant_id, job.provider, Date.now() + 60000).run();
      await this.repo.finish(job, status, null, typed.code, delay);
      await this.repo.event(job, typed.code, Date.now() - start);
    }
  }
  private async saveSnapshot(job: Job, prospectId: string, result: ProviderResult, started: number, error: Snapshot["error"] = null) {
    const id = `ev_${await hash([job.tenant_id, prospectId, job.id])}`, now = new Date().toISOString(), data = structuredClone(result.data);
    let encrypted: string | null = null;
    if (data.contacts?.length) encrypted = await sealContacts(data.contacts, this.adapters.contactEncryptionKey(), `${job.tenant_id}:${id}`);
    delete data.contacts;
    const snapshot: Snapshot = { id, tenantId: job.tenant_id, prospectId, source: job.provider as Provider, providerVersion: result.providerVersion, operation: job.operation,
      status: result.status, retrievedAt: now, expiresAt: new Date(Date.now() + result.ttlSeconds * 1000).toISOString(), data, error,
      latencyMs: Date.now() - started, costUnits: error === "policy_blocked" || result.status === "missing" ? 0 : 1, requestId: job.request_id };
    const policy = await this.repo.policy(job.tenant_id);
    await this.repo.db.batch([
      this.repo.statement("INSERT INTO pi_snapshots(id,tenant_id,prospect_id,provider,operation,status,snapshot,retrieved_at,expires_at,job_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", id, job.tenant_id, prospectId, job.provider, job.operation, snapshot.status, JSON.stringify(snapshot), now, snapshot.expiresAt, job.id),
      ...(encrypted ? [this.repo.statement("INSERT INTO pi_contact_vault(tenant_id,snapshot_id,ciphertext,expires_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING", job.tenant_id, id, encrypted, new Date(Date.now() + Math.min(policy.retentionDays, 7) * 86400000).toISOString())] : []),
    ]);
  }
  private async score(job: Job, prospectId: string, policy: TenantPolicy): Promise<ScoreSnapshot> {
    const prospect = await this.service.prospect(this.context(job), prospectId), snapshots = await this.repo.snapshots(job.tenant_id, prospectId), now = new Date().toISOString();
    const eligible = eligibleSnapshots(snapshots, now);
    const inputKey = await hash([SCORING_VERSION, policy.scoring, eligible.map(s => s.id), now.slice(0, 10)]);
    const existing = await this.repo.one<{ snapshot: string }>("SELECT snapshot FROM pi_scores WHERE tenant_id=? AND prospect_id=? AND input_key=?", job.tenant_id, prospectId, inputKey);
    if (existing) return JSON.parse(existing.snapshot);
    const score = await calculateScores(prospect, snapshots, policy.scoring, now);
    // Use the input key for the ID so concurrent completions converge, while the
    // stored calculation time remains the first writer's reproducible instant.
    score.id = `sc_${await hash([job.tenant_id, prospectId, inputKey])}`;
    await this.repo.db.batch([
      this.repo.statement("INSERT INTO pi_scores(id,tenant_id,prospect_id,input_key,snapshot,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING", score.id, job.tenant_id, prospectId, inputKey, JSON.stringify(score), now),
      ...score.evidenceIds.map(id => this.repo.statement("INSERT INTO pi_score_evidence(tenant_id,score_id,snapshot_id) VALUES(?,?,?) ON CONFLICT DO NOTHING", job.tenant_id, score.id, id)),
    ]);
    const stored = await this.repo.one<{ snapshot: string }>("SELECT snapshot FROM pi_scores WHERE tenant_id=? AND id=?", job.tenant_id, score.id);
    return JSON.parse(stored!.snapshot);
  }
}
