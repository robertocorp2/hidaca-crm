import assert from "node:assert/strict";
import test from "node:test";
import { ProspectingService } from "../app/lib/prospecting/service";
import { WorkerRuntime } from "../app/lib/prospecting/runtime";
import { context, database, facts, searchInput, switches, testPolicy } from "./prospecting-support";
import type { Job } from "../app/lib/prospecting/contracts";

test("bulk admission rejects insufficient provider budget before recording jobs", async () => {
  const db = database();
  try {
    const policy = testPolicy(); policy.providerBudgets.pagespeed = 0;
    db.sqlite.prepare("UPDATE pi_policies SET policy=? WHERE tenant_id='hidaca'").run(JSON.stringify(policy));
    const prospect = await db.repo.canonicalize(context, facts);
    await assert.rejects(new ProspectingService(db.repo, switches).bulk(context, { operation: "audit", prospectIds: [prospect.id], idempotencyKey: "preflight-budget-test" }), /budget_exhausted/);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_jobs").get()?.n, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_bulk").get()?.n, 0);
  } finally { db.sqlite.close(); }
});

test("maximum 50-prospect batch drains within bounded ticks with independent mixed outcomes", async () => {
  const db = database(), started = performance.now();
  try {
    const policy = { ...testPolicy(), dailyBudget: 200 };
    db.sqlite.prepare("UPDATE pi_policies SET policy=? WHERE tenant_id='hidaca'").run(JSON.stringify(policy));
    const service = new ProspectingService(db.repo, switches), calls: Record<string, number> = {};
    const runtime = new WorkerRuntime(db.repo, switches, {
      discovery: () => ({ async discoverBusinesses() { return { businesses: Array.from({ length: 50 }, (_, i) => ({ ...facts, placeId: `batch-${i}`, address: `${i} Test Road`, phone: `1809555${String(i).padStart(4, "0")}` })), nextPageToken: "", partial: false }; }, async getPlaceDetails() { return facts; } }),
      enrichment: provider => ({ provider, async enrich() { calls[provider] = (calls[provider] ?? 0) + 1; return { status: "complete", providerVersion: "load-fixture", ttlSeconds: 3600, data: provider === "pagespeed" ? { performance: 50, accessibility: 50, seo: 50, trust: 50 } : { technologies: [] } }; } }),
      contactEncryptionKey: () => "",
    });
    const search = await service.search(context, searchInput); await runtime.tick(context.tenantId);
    const result = await service.searchResult(context, search.id); assert.equal(result.prospects.length, 50);
    const body = { operation: "audit", idempotencyKey: "maximum-batch-test", prospectIds: result.prospects.map(p => p.prospect.id) };
    const batch = await service.bulk(context, body); assert.equal(batch.total, 200);
    const replay = await service.bulk(context, body); assert.equal(replay.total, 200);
    let ticks = 0;
    while (true) { const count = await runtime.tick(context.tenantId); ticks++; assert.ok(count.processed <= 10); if (!count.processed) break; assert.ok(ticks <= 21); }
    const finished = await service.bulkStatus(context, batch.id);
    assert.equal(finished.total, 200); assert.equal(finished.completed, 150); assert.equal(finished.failed, 50);
    assert.ok(finished.jobs.filter(j => j.status === "failed").every(j => j.error === "policy_blocked"));
    assert.equal(calls.pagespeed, 50); assert.equal(calls.builtwith, 50); assert.equal(calls.hunter, undefined);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_audits").get()?.n, 50);
    console.log(JSON.stringify({ benchmark: "prospecting-max-batch", fixture: "SQLite + synthetic providers", prospects: 50, jobs: 200, ticks, elapsedMs: Math.round(performance.now() - started) }));
  } finally { db.sqlite.close(); }
});
test("concurrent queue pressure cannot exceed tenant capacity", async () => {
  const db = database();
  try {
    const policy = { ...testPolicy(), maxQueuedJobs: 5 };
    db.sqlite.prepare("UPDATE pi_policies SET policy=? WHERE tenant_id='hidaca'").run(JSON.stringify(policy));
    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => db.repo.enqueue(context, { provider: "internal", operation: "audit", key: `pressure-${i}`, payload: {} })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 5);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_jobs").get()?.n, 5);
  } finally { db.sqlite.close(); }
});
test("provider budget cannot be exceeded while tenant budget remains available", async () => {
  const db = database();
  try {
    const policy = testPolicy(); policy.providerBudgets.pagespeed = 1;
    await db.repo.enqueue(context, { provider: "pagespeed", operation: "enrich", key: "provider-cap-1", payload: {} });
    await db.repo.enqueue(context, { provider: "pagespeed", operation: "enrich", key: "provider-cap-2", payload: {} });
    const jobs = (await Promise.all([db.repo.claim(context.tenantId, policy), db.repo.claim(context.tenantId, policy)])).filter((j): j is Job => j !== null);
    assert.equal(jobs.length, 2);
    const reservations = await Promise.allSettled(jobs.map(job => db.repo.reserveBudget(job, policy)));
    assert.equal(reservations.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(db.sqlite.prepare("SELECT used FROM pi_budgets WHERE provider='all'").get()?.used, 1);
  } finally { db.sqlite.close(); }
});
