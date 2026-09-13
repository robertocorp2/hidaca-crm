import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare } from "miniflare";
import { Repository } from "../app/lib/prospecting/repository";
import { ProspectingService } from "../app/lib/prospecting/service";
import { WorkerRuntime } from "../app/lib/prospecting/runtime";
import { handleApi } from "../app/lib/prospecting/api";
import { context, facts, searchInput, switches, testPolicy } from "./prospecting-support";

test("real D1 runtime migrates and completes authenticated API search, enrichment and repeat conversion", { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"], compatibilityDate: "2026-05-15" });
  try {
    const binding = await mf.getD1Database("DB");
    const folder = new URL("../drizzle/", import.meta.url);
    for (const file of readdirSync(folder).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      const source = readFileSync(new URL(file, folder), "utf8");
      for (const sql of source.split("--> statement-breakpoint")) {
        if (!sql.replace(/--[^\n]*/g, "").trim()) continue;
        await binding.prepare(sql).run();
      }
    }
    const now = new Date().toISOString();
    await binding.prepare("INSERT INTO staff_users(email,name,role,active,created_at,updated_at) VALUES(?,?,'admin',1,?,?)").bind(context.actor, "Test", now, now).run();
    await binding.prepare("INSERT INTO pi_policies(tenant_id,version,policy,actor,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(context.tenantId, "1", JSON.stringify(testPolicy()), context.actor, now, now).run();
    const repo = new Repository(binding), service = new ProspectingService(repo, switches);
    const runtime = new WorkerRuntime(repo, switches, {
      discovery: () => ({ async discoverBusinesses() { return { businesses: [facts, facts], nextPageToken: "", partial: false }; }, async getPlaceDetails() { return facts; } }),
      enrichment: provider => ({ provider, async enrich() { return { data: { performance: 50, accessibility: 70, seo: 80, trust: 90 }, status: "complete", providerVersion: "fixture", ttlSeconds: 3600 }; } }),
      contactEncryptionKey: () => "",
    });
    const send = (path: string, body?: unknown) => handleApi(new Request(`https://crm.example.com/v1/${path}`, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), path.split("/"), context, service);
    const response = await send("prospect-searches", searchInput); assert.equal(response.status, 202);
    const search = await response.json() as { data: { id: string } }; await runtime.tick(context.tenantId);
    const result = await service.searchResult(context, search.data.id); assert.equal(result.status, "completed"); assert.equal(result.prospects.length, 1);
    const id = result.prospects[0].prospect.id;
    await send(`prospects/${id}/enrichment`, { idempotencyKey: "real-d1-enrichment", providers: ["pagespeed"] }); await runtime.tick(context.tenantId);
    const detail = await service.detail(context, id); assert.ok(detail.score?.digitalHealth.value); assert.equal(detail.scoreStale, false);
    const preview = (await service.preview(context, { items: [{ prospectId: id, contactName: "General", opportunityTitle: "D1 proof" }] })).previews[0];
    const convert = { confirmed: true, idempotencyKey: "real-d1-conversion", items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] };
    assert.equal((await send("prospect-selections/convert", convert)).status, 202); await runtime.tick(context.tenantId);
    assert.equal((await send("prospect-selections/convert", convert)).status, 202);
    assert.equal((await binding.prepare("SELECT count(*) n FROM opportunities").first<{ n: number }>())?.n, 1);
    assert.equal((await binding.prepare("SELECT status FROM pi_exports").first<{ status: string }>())?.status, "completed");
  } finally { await mf.dispose(); }
});
