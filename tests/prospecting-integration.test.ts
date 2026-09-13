import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ProspectingError, type Job, type Provider } from "../app/lib/prospecting/contracts";
import { ProspectingService } from "../app/lib/prospecting/service";
import { WorkerRuntime, type Adapters } from "../app/lib/prospecting/runtime";
import { handleApi } from "../app/lib/prospecting/api";
import { context, database, facts, searchInput, switches, testPolicy } from "./prospecting-support";

function fixtures(options: { fail?: Provider; counters?: Record<string, number>; count?: number } = {}): Adapters {
  return {
    discovery: () => ({ async discoverBusinesses() { if (options.counters) options.counters.search = (options.counters.search ?? 0) + 1; return { businesses: Array.from({ length: options.count ?? 1 }, (_, i) => ({ ...facts, placeId: `${facts.placeId}-${i}`, address: `${facts.address}-${i}`, phone: `+1809555${String(i).padStart(4, "0")}` })), nextPageToken: "", partial: false }; }, async getPlaceDetails() { return facts; } }),
    enrichment: provider => ({ provider, async enrich() {
      if (options.counters) options.counters[provider] = (options.counters[provider] ?? 0) + 1;
      if (options.fail === provider) throw new ProspectingError("unauthorized");
      return { data: provider === "pagespeed" ? { performance: 40, accessibility: 70, seo: 80, trust: 100 } : provider === "builtwith" ? { technologies: [{ name: "WordPress", lastDetected: null }] } : { contacts: [{ email: "private@example.com", name: "Private", verification: "valid", sources: ["https://example.com/contact"] }], contactCount: 1, verifiedContacts: 1 }, status: "complete", providerVersion: "fixture-v1", ttlSeconds: 86400 };
    } }),
    contactEncryptionKey: () => btoa("a".repeat(32)),
  };
}
test("retrying a failed audit replaces its failure with an evidence-linked result", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const request = await service.enrich(context, prospect.id, { idempotencyKey: "audit-recovery-test", providers: ["pagespeed"] }, true);
    const audit = request.jobs.find(job => job.operation === "audit")!;
    db.sqlite.prepare("INSERT INTO pi_audits(id,tenant_id,prospect_id,job_id,status,actor,created_at) VALUES(?,?,?,?,'failed',?,'now')").run(audit.id, context.tenantId, prospect.id, audit.id, context.actor);
    db.sqlite.prepare("UPDATE pi_jobs SET status='failed' WHERE id=?").run(audit.id);
    await service.retry(context, audit.id); await runtime.tick(context.tenantId);
    const recovered = db.sqlite.prepare("SELECT status,score_id FROM pi_audits WHERE id=?").get(audit.id);
    assert.equal(recovered?.status, "partial"); assert.ok(recovered?.score_id);
    assert.equal((await service.job(context, audit.id)).status, "completed");
  } finally { db.sqlite.close(); }
});
async function discover(db: ReturnType<typeof database>, adapters = fixtures()) {
  const service = new ProspectingService(db.repo, switches), runtime = new WorkerRuntime(db.repo, switches, adapters);
  const search = await service.search(context, searchInput);
  await runtime.tick("hidaca");
  const result = await service.searchResult(context, search.id);
  assert.equal(result.status, "completed");
  return { service, runtime, result, prospect: result.prospects[0].prospect };
}
test("migration enforces tenant FKs, immutable evidence and reversible empty installation", () => {
  const db = database();
  assert.throws(() => db.sqlite.exec("INSERT INTO pi_identities(tenant_id,identity_key,prospect_id,created_at) VALUES('other','x','missing','now')"), /FOREIGN KEY/);
  db.sqlite.exec(readFileSync(new URL("../drizzle/rollback/0022_prospecting_intelligence.down.sql", import.meta.url), "utf8"));
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'pi_%'").get()?.n, 0);
  assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='businesses'").get());
  db.sqlite.close();
});
test("concurrent canonicalization merges aliases and isolates tenant identities", async () => {
  const db = database();
  try {
    const prospects = await Promise.all(Array.from({ length: 20 }, () => db.repo.canonicalize(context, facts)));
    assert.equal(new Set(prospects.map(p => p.id)).size, 1);
    const alias = await db.repo.canonicalize(context, { ...facts, placeId: "other-google-id" });
    assert.equal(alias.id, prospects[0].id);
    const secondTenant = await db.repo.canonicalize({ ...context, tenantId: "other" }, facts);
    assert.notEqual(secondTenant.id, alias.id); assert.equal(await db.repo.getProspect("other", alias.id), null);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_prospects WHERE tenant_id='hidaca'").get()?.n, 1);
  } finally { db.sqlite.close(); }
});
test("duplicate search requests share canonical results and fresh cache avoids spend", async () => {
  const db = database(), counters: Record<string, number> = {};
  try {
    const service = new ProspectingService(db.repo, switches), runtime = new WorkerRuntime(db.repo, switches, fixtures({ counters }));
    const requests = await Promise.all(Array.from({ length: 10 }, () => service.search(context, searchInput)));
    assert.equal(new Set(requests.map(r => r.id)).size, 1); await runtime.tick("hidaca");
    const result = await service.search(context, { ...searchInput, query: "  CONSTRUCTORAS  " });
    assert.equal(result.cached, true); assert.equal(counters.search, 1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_jobs").get()?.n, 1);
  } finally { db.sqlite.close(); }
});
test("leases recover after interruption; stale owners cannot finalize and attempts are bounded", async () => {
  const db = database();
  try {
    await db.repo.enqueue(context, { provider: "internal", operation: "audit", key: "lease-test", payload: {} });
    const first = await db.repo.claim("hidaca", testPolicy()); assert.ok(first);
    const none = await db.repo.claim("hidaca", testPolicy()); assert.equal(none, null);
    db.sqlite.prepare("UPDATE pi_jobs SET lease_until=0 WHERE id=?").run(first.id);
    const recovered = await db.repo.claim("hidaca", testPolicy()); assert.ok(recovered); assert.notEqual(first.lease_token, recovered.lease_token);
    await db.repo.finish(first, "completed", { stale: true }); assert.equal((await db.repo.one<Job>("SELECT * FROM pi_jobs WHERE id=?", first.id))?.status, "running");
    db.sqlite.prepare("UPDATE pi_jobs SET attempts=max_attempts,lease_until=0 WHERE id=?").run(first.id);
    assert.equal(await db.repo.claim("hidaca", testPolicy()), null);
    assert.equal((await db.repo.one<Job>("SELECT * FROM pi_jobs WHERE id=?", first.id))?.status, "dead_letter");
  } finally { db.sqlite.close(); }
});
test("atomic budgets and tenant/provider concurrency guard multiple claimers", async () => {
  const db = database();
  try {
    for (let i = 0; i < 10; i++) await db.repo.enqueue(context, { provider: "pagespeed", operation: "enrich", key: `concurrency-${i}`, payload: {} });
    const policy = { ...testPolicy(), dailyBudget: 2, tenantConcurrency: 3, providerConcurrency: 2 };
    const claimed = (await Promise.all(Array.from({ length: 10 }, () => db.repo.claim("hidaca", policy)))).filter((j): j is Job => j !== null);
    assert.equal(claimed.length, 2);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => db.repo.reserveBudget(claimed[i % claimed.length], policy)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
    assert.equal(db.sqlite.prepare("SELECT used FROM pi_budgets WHERE provider='all'").get()?.used, 2);
  } finally { db.sqlite.close(); }
});
test("progressive enrichment keeps independent successes, provenance and immutable score history", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db, fixtures({ fail: "pagespeed" }));
    await service.enrich(context, prospect.id, { idempotencyKey: "enrichment-1" }, true);
    await runtime.tick("hidaca");
    const detail = await service.detail(context, prospect.id);
    assert.ok(detail.snapshots.some(s => s.source === "pagespeed" && s.status === "failed"));
    assert.ok(detail.snapshots.some(s => s.source === "builtwith" && s.status === "complete"));
    assert.ok(detail.snapshots.some(s => s.source === "hunter" && s.status === "policy_blocked"));
    assert.equal(detail.score?.digitalHealth.value, null);
    assert.ok(detail.audits.length === 1); assert.ok(detail.sources.length);
    assert.throws(() => db.sqlite.exec("UPDATE pi_snapshots SET status='complete'"), /immutable/);
    assert.throws(() => db.sqlite.exec("UPDATE pi_scores SET snapshot='{}'"), /immutable/);
  } finally { db.sqlite.close(); }
});
test("search → enrichment → score → audit → confirmed conversion replays create one CRM record set", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    await service.enrich(context, prospect.id, { idempotencyKey: "full-enrichment-1" }, true); await runtime.tick("hidaca");
    const detail = await service.detail(context, prospect.id); assert.equal(detail.score?.digitalHealth.value, 67); assert.equal(detail.audits.length, 1);
    const preview = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "Contacto general", opportunityTitle: "Evaluación de servicios" }] })).previews[0];
    assert.deepEqual(preview.conflicts, []); assert.deepEqual(preview.missing, []);
    const body = { idempotencyKey: "conversion-fixture-1", confirmed: true, items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] };
    const first = await service.convert(context, body); await runtime.tick("hidaca");
    const replay = await service.convert(context, body); assert.equal(first.outcomes[0].exportId, replay.outcomes[0].exportId); assert.equal(replay.outcomes[0].status, "completed");
    for (const table of ["businesses", "contacts", "opportunities"]) assert.equal(db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()?.n, 1, table);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_export_operations WHERE status='completed'").get()?.n, 4);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM search_documents").get()?.n, 3);
  } finally { db.sqlite.close(); }
});
test("CRM partial failure resumes from completed operations without duplicate writes", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const preview = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "Contacto", opportunityTitle: "Proyecto" }] })).previews[0];
    const result = await service.convert(context, { idempotencyKey: "partial-conversion", confirmed: true, items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] });
    db.sqlite.exec("CREATE TRIGGER fail_contact BEFORE INSERT ON contacts BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END");
    await runtime.tick("hidaca"); assert.equal(db.sqlite.prepare("SELECT status FROM pi_exports").get()?.status, "partial");
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM businesses").get()?.n, 1);
    db.sqlite.exec("DROP TRIGGER fail_contact"); await service.retry(context, result.jobs[0].id); await runtime.tick("hidaca");
    assert.equal(db.sqlite.prepare("SELECT status FROM pi_exports").get()?.status, "completed");
    for (const table of ["businesses", "contacts", "opportunities"]) assert.equal(db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()?.n, 1);
  } finally { db.sqlite.close(); }
});
test("name-only duplicates require explicit review and contact matches cannot cross companies", async () => {
  const db = database();
  try {
    const { service, prospect } = await discover(db);
    db.sqlite.prepare("INSERT INTO businesses(id,name,normalized_name,owner_email,created_by,created_at,updated_at) VALUES('existing',?,lower(?),'owner','owner','now','now')").run(prospect.name, prospect.name);
    const mapping = { prospectId: prospect.id, contactName: "General", opportunityTitle: "Review" };
    const preview = (await service.preview(context, { items: [mapping] })).previews[0];
    assert.equal(preview.company.action, "review"); assert.ok(preview.conflicts.length);
    const reviewed = (await service.preview(context, { items: [{ ...mapping, companyId: "existing", reviewed: true }] })).previews[0];
    assert.deepEqual(reviewed.conflicts, []);
    db.sqlite.prepare("INSERT INTO contacts(id,business_id,name,normalized_phone,owner_email,created_by,created_at,updated_at) VALUES('wrong',NULL,'Contact',?,'owner','owner','now','now')").run(prospect.phone.replace(/\D/g, ""));
    const contactPreview = (await service.preview(context, { items: [{ ...mapping, companyId: "existing", contactId: "wrong", reviewed: true }] })).previews[0];
    assert.ok(contactPreview.conflicts.length);
  } finally { db.sqlite.close(); }
});
test("bulk duplicate selection, idempotency conflicts, cancellation and max size are enforced", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const body = { operation: "enrich", prospectIds: [prospect.id, prospect.id], idempotencyKey: "bulk-fixture-1" };
    const first = await service.bulk(context, body), replay = await service.bulk(context, body);
    assert.equal(first.id, replay.id); assert.equal(first.total, 3);
    await assert.rejects(service.bulk(context, { ...body, operation: "audit" }), /conflict/);
    const cancelled = await service.cancelBulk(context, String(first.id)); assert.ok(cancelled.jobs.every(j => j.status === "cancelled"));
    await runtime.tick("hidaca"); assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_snapshots WHERE provider<>'google_places'").get()?.n, 0);
    await assert.rejects(service.bulk(context, { ...body, prospectIds: Array(51).fill(prospect.id) }), /invalid_request/);
  } finally { db.sqlite.close(); }
});
test("API and worker recheck roles, tenant isolation, kill switches and origin", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const viewer = { ...context, role: "viewer" as const };
    await assert.rejects(service.search(viewer, searchInput), /forbidden/);
    await assert.rejects(service.prospect({ ...context, tenantId: "other" }, prospect.id), /not_found/);
    await assert.rejects(service.crm.ensurePipeline({ ...context, tenantId: "other" }), /HIDACA/);
    const response = await handleApi(new Request("https://crm.example.com/v1/prospects", { method: "POST", headers: { origin: "https://evil.example.org" } }), ["prospects"], context, service); assert.equal(response.status, 403);
    const invalid = await handleApi(new Request("https://crm.example.com/v1/prospect-searches", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" }), ["prospect-searches"], context, service); assert.equal(invalid.status, 400);
    await service.enrich(context, prospect.id, { idempotencyKey: "revoke-staff-test" });
    db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE email=?").run(context.actor); await runtime.tick("hidaca");
    const jobs = await db.repo.all<Job>("SELECT * FROM pi_jobs WHERE operation='enrich'"); assert.ok(jobs.every(j => j.error_code === "forbidden"));
    const disabled = new ProspectingService(db.repo, {}); await assert.rejects(disabled.search(context, searchInput), /desactivada/);
  } finally { db.sqlite.close(); }
});
test("Hunter contacts are encrypted, omitted from API and erasable without deleting evidence", async () => {
  const db = database();
  try {
    const p = testPolicy(); p.contactAllowed = true; p.contactPolicyReference = "approved-policy-v1";
    db.sqlite.prepare("UPDATE pi_policies SET policy=? WHERE tenant_id='hidaca'").run(JSON.stringify(p));
    const { service, runtime, prospect } = await discover(db);
    await service.enrich(context, prospect.id, { providers: ["hunter"], idempotencyKey: "contact-fixture-1" }); await runtime.tick("hidaca");
    const vault = db.sqlite.prepare("SELECT ciphertext FROM pi_contact_vault").get(); assert.ok(vault); assert.ok(!String(vault.ciphertext).includes("private@example.com"));
    const detail = await service.detail(context, prospect.id); assert.ok(!JSON.stringify(detail).includes("private@example.com"));
    await service.deleteContacts(context, prospect.id); assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_contact_vault").get()?.n, 0); assert.ok((await service.detail(context, prospect.id)).snapshots.length > 0);
  } finally { db.sqlite.close(); }
});
test("retry classes preserve approved transient errors and dead letter at attempt limit", async () => {
  const db = database();
  try {
    const adapters = fixtures(); adapters.discovery = () => ({ async discoverBusinesses() { throw new ProspectingError("rate_limited"); }, async getPlaceDetails() { return facts; } });
    const service = new ProspectingService(db.repo, switches), runtime = new WorkerRuntime(db.repo, switches, adapters);
    await service.search(context, searchInput);
    for (let i = 0; i < 4; i++) { db.sqlite.exec("UPDATE pi_jobs SET next_run=0"); await runtime.tick("hidaca"); }
    assert.equal(db.sqlite.prepare("SELECT status FROM pi_jobs").get()?.status, "dead_letter");
    const metrics = await service.metrics(context); assert.ok(metrics.alerts.some(a => a.includes("dead letter")));
  } finally { db.sqlite.close(); }
});
test("exhausted abandoned search reconciles visible state and renewal is fenced", async () => {
  const db = database();
  try {
    const service = new ProspectingService(db.repo, switches), search = await service.search(context, searchInput);
    const job = await db.repo.claim(context.tenantId, testPolicy()); assert.ok(job);
    assert.equal(await db.repo.renew(job), true);
    db.sqlite.prepare("UPDATE pi_jobs SET attempts=max_attempts,lease_until=0 WHERE id=?").run(job.id);
    assert.equal(await db.repo.renew(job), false); await db.repo.claim(context.tenantId, testPolicy());
    const result = await service.searchResult(context, search.id); assert.equal(result.status, "dead_letter"); assert.equal(result.error, "timeout");
  } finally { db.sqlite.close(); }
});
test("search replays recover an interrupted outbox enqueue without another search generation", async () => {
  const db = database();
  try {
    const service = new ProspectingService(db.repo, switches), first = await service.search(context, searchInput);
    db.sqlite.exec("DELETE FROM pi_jobs");
    const replay = await service.search(context, searchInput);
    assert.equal(first.id, replay.id); assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_jobs").get()?.n, 1);
    await new WorkerRuntime(db.repo, switches, fixtures()).tick(context.tenantId);
    assert.equal((await service.searchResult(context, first.id)).status, "completed");
  } finally { db.sqlite.close(); }
});
test("equivalent formatted CRM phones and addresses are found before candidate filtering", async () => {
  const db = database();
  try {
    const { service, prospect } = await discover(db);
    db.sqlite.prepare("INSERT INTO businesses(id,name,normalized_name,phone,address,owner_email,created_by,created_at,updated_at) VALUES('formatted','Different legal name','different legal name',?,?,'owner','owner','now','now')").run(prospect.phone.replace(/\D/g, ""), prospect.address.toUpperCase());
    const matches = await service.crm.findCompany(context, prospect); assert.equal(matches.length, 1); assert.equal(matches[0].confidence, "exact");
    assert.deepEqual(matches[0].signals, ["phone", "address"]);
  } finally { db.sqlite.close(); }
});
test("newly discovered conversion conflicts can be explicitly repaired without duplicate companies", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const original = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "General", opportunityTitle: "Opportunity" }] })).previews[0];
    await service.convert(context, { confirmed: true, idempotencyKey: "pre-conflict-conversion", items: [{ ...original.mapping, fingerprint: original.fingerprint }] });
    db.sqlite.prepare("INSERT INTO businesses(id,name,normalized_name,owner_email,created_by,created_at,updated_at) VALUES('new-match',?,?,'owner','owner','now','now')").run(prospect.name, prospect.name.toLowerCase());
    await runtime.tick(context.tenantId); assert.equal(db.sqlite.prepare("SELECT status FROM pi_exports").get()?.status, "failed");
    const reviewed = (await service.preview(context, { items: [{ ...original.mapping, companyId: "new-match", reviewed: true }] })).previews[0]; assert.deepEqual(reviewed.conflicts, []);
    const body = { confirmed: true, idempotencyKey: "reviewed-repair-1", items: [{ ...reviewed.mapping, fingerprint: reviewed.fingerprint }] };
    await service.repair(context, body); await runtime.tick(context.tenantId);
    assert.equal(db.sqlite.prepare("SELECT status FROM pi_exports").get()?.status, "completed");
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM businesses").get()?.n, 1);
    assert.equal((await service.repair(context, body)).outcomes[0].status, "completed");
  } finally { db.sqlite.close(); }
});
test("expired evidence marks its score stale even while the listing remains fresh", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    await service.enrich(context, prospect.id, { idempotencyKey: "stale-score-test", providers: ["pagespeed"] }); await runtime.tick(context.tenantId);
    assert.equal((await service.summary(context, prospect.id)).scoreStale, false);
    // Move both persisted retrieval/expiry instants into the past through a
    // controlled clock-independent fixture, preserving the immutable payload.
    db.sqlite.exec("DROP TRIGGER pi_snapshots_immutable"); db.sqlite.exec("UPDATE pi_snapshots SET expires_at='2000-01-01' WHERE provider='pagespeed'");
    const summary = await service.summary(context, prospect.id); assert.equal(summary.stale, false); assert.equal(summary.scoreStale, true); assert.ok(summary.score);
  } finally { db.sqlite.close(); }
});
test("request keys cannot silently add different CRM selections or enrichment providers", async () => {
  const db = database();
  try {
    const { service, prospect } = await discover(db);
    await service.enrich(context, prospect.id, { idempotencyKey: "reuse-key-test", providers: ["pagespeed"] });
    await assert.rejects(service.enrich(context, prospect.id, { idempotencyKey: "reuse-key-test", providers: ["builtwith"] }), /idempotencia/);
    const preview = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "General", opportunityTitle: "First" }] })).previews[0];
    await service.convert(context, { confirmed: true, idempotencyKey: "reuse-convert-test", items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] });
    await assert.rejects(service.convert(context, { confirmed: true, idempotencyKey: "reuse-convert-test", items: [{ ...preview.mapping, opportunityTitle: "Changed", fingerprint: preview.fingerprint }] }), /idempotencia/);
  } finally { db.sqlite.close(); }
});
test("persisted enrichment survives interrupted acknowledgement without repeating the provider", async () => {
  const db = database(), counters: Record<string, number> = {};
  try {
    const { service, runtime, prospect } = await discover(db, fixtures({ counters }));
    const enrichment = await service.enrich(context, prospect.id, { idempotencyKey: "crash-ack-test", providers: ["pagespeed"] }); await runtime.tick(context.tenantId);
    db.sqlite.prepare("UPDATE pi_jobs SET status='running',lease_until=0 WHERE id=?").run(enrichment.jobs[0].id);
    await runtime.tick(context.tenantId); assert.equal(counters.pagespeed, 1);
    assert.equal((await service.job(context, enrichment.jobs[0].id)).status, "completed");
  } finally { db.sqlite.close(); }
});
test("contact retention still runs when every feature is disabled", async () => {
  const db = database();
  try {
    const p = testPolicy(); p.contactAllowed = true; p.contactPolicyReference = "approved";
    db.sqlite.prepare("UPDATE pi_policies SET policy=? WHERE tenant_id='hidaca'").run(JSON.stringify(p));
    const { service, runtime, prospect } = await discover(db);
    await service.enrich(context, prospect.id, { idempotencyKey: "retention-test", providers: ["hunter"] }); await runtime.tick(context.tenantId);
    db.sqlite.exec("UPDATE pi_contact_vault SET expires_at='2000-01-01'");
    await new WorkerRuntime(db.repo, {}, fixtures()).tick(context.tenantId);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_contact_vault").get()?.n, 0);
  } finally { db.sqlite.close(); }
});
test("search retry resets visible progress and audit retry rejects a newer active operation", async () => {
  const db = database();
  try {
    const { service, prospect } = await discover(db);
    const search = db.sqlite.prepare("SELECT id,payload FROM pi_jobs WHERE operation='search'").get()!;
    db.sqlite.exec("UPDATE pi_jobs SET status='failed' WHERE operation='search'; UPDATE pi_searches SET status='failed',error_code='timeout'");
    await service.retry(context, String(search.id));
    const visible = await service.searchResult(context, JSON.parse(String(search.payload)).searchId);
    assert.equal(visible.status, "queued"); assert.equal(visible.error, null);
    const old = await service.enrich(context, prospect.id, { idempotencyKey: "old-audit-retry", providers: ["pagespeed"] }, true);
    const oldAudit = old.jobs.find(j => j.operation === "audit")!;
    db.sqlite.prepare("UPDATE pi_jobs SET status='failed' WHERE id=?").run(oldAudit.id);
    await service.enrich(context, prospect.id, { idempotencyKey: "new-audit-retry", providers: ["pagespeed"] }, true);
    await assert.rejects(service.retry(context, oldAudit.id), (e: unknown) => e instanceof ProspectingError && e.code === "conflict");
  } finally { db.sqlite.close(); }
});
test("replayed applied repair restores its interrupted conversion enqueue", async () => {
  const db = database();
  try {
    const { service, runtime, prospect } = await discover(db);
    const preview = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "General", opportunityTitle: "Recovery" }] })).previews[0];
    await service.convert(context, { confirmed: true, idempotencyKey: "repair-outbox-convert", items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] });
    db.sqlite.exec("DELETE FROM pi_jobs WHERE operation='convert'");
    const body = { confirmed: true, idempotencyKey: "repair-outbox-replay", items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] };
    const enqueue = db.repo.enqueue.bind(db.repo);
    db.repo.enqueue = async () => { throw new ProspectingError("rate_limited"); };
    await assert.rejects(service.repair(context, body));
    db.repo.enqueue = enqueue;
    await service.repair(context, body); await runtime.tick(context.tenantId);
    assert.equal(db.sqlite.prepare("SELECT status FROM pi_exports").get()?.status, "completed");
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_jobs WHERE operation='convert'").get()?.n, 1);
  } finally { db.sqlite.close(); }
});

