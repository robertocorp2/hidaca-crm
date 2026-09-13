import assert from "node:assert/strict";
import test from "node:test";
import { ProviderAdapter } from "../app/lib/prospecting/providers";
import { ProspectingService } from "../app/lib/prospecting/service";
import { WorkerRuntime } from "../app/lib/prospecting/runtime";
import { context, database, facts, searchInput, switches, testPolicy } from "./prospecting-support";

test("Google-only provider data cannot be forwarded to enrichment adapters", async () => {
  const adapter = new ProviderAdapter("pagespeed", "test-key", async () => { throw new Error("network must not be called"); });
  const result = await adapter.enrich({ ...facts, id: "p", tenantId: "hidaca", identityKey: "v1:google:x", firstSeen: "now", lastSeen: "now" });
  assert.equal(result.status, "policy_blocked");
});

test("CRM conversion keeps Google listing fields out of durable records", async () => {
  const db = database();
  try {
    const service = new ProspectingService(db.repo, switches), runtime = new WorkerRuntime(db.repo, switches, {
      discovery: () => ({ async discoverBusinesses() { return { businesses: [facts], nextPageToken: "", partial: false }; }, async getPlaceDetails() { return facts; } }),
      enrichment: provider => ({ provider, async enrich() { return { data: {}, status: "missing", providerVersion: "test", ttlSeconds: 3600 }; } }),
      contactEncryptionKey: () => "",
    });
    const search = await service.search(context, searchInput); await runtime.tick("hidaca");
    const prospect = (await service.searchResult(context, search.id)).prospects[0].prospect;
    const preview = (await service.preview(context, { items: [{ prospectId: prospect.id, contactName: "Contacto", opportunityTitle: "Evaluación" }] })).previews[0];
    await service.convert(context, { confirmed: true, idempotencyKey: "compliance-conversion", items: [{ ...preview.mapping, fingerprint: preview.fingerprint }] });
    await runtime.tick("hidaca");
    const business = db.sqlite.prepare("SELECT name,phone,address,source_metadata FROM businesses").get() as { name: string; phone: string; address: string; source_metadata: string };
    assert.deepEqual([business.name, business.phone, business.address], ["", "", ""]);
    assert.equal(JSON.parse(business.source_metadata).placeId, facts.placeId);
    const searchText = db.sqlite.prepare("SELECT subtitle FROM search_documents WHERE entity_type='opportunity'").get() as { subtitle: string };
    assert.match(searchText.subtitle, /^Place ID /);
    assert.ok(!JSON.stringify(business).includes(facts.name));
  } finally { db.sqlite.close(); }
});

test("Google snapshot remains provenance-only and expired context is hard-deleted", async () => {
  const db = database();
  try {
    const prospect = await db.repo.canonicalize(context, facts);
    db.sqlite.prepare("INSERT INTO pi_place_context(tenant_id,prospect_id,place_id,context,retrieved_at,expires_at) VALUES(?,?,?,?,?,?)").run(context.tenantId, prospect.id, facts.placeId, JSON.stringify(facts), "now", "2000-01-01");
    const runtime = new WorkerRuntime(db.repo, switches, { discovery: () => ({ async discoverBusinesses() { return { businesses: [], nextPageToken: "", partial: false }; }, async getPlaceDetails() { return facts; } }), enrichment: provider => ({ provider, async enrich() { return { data: {}, status: "missing", providerVersion: "test", ttlSeconds: 60 }; } }), contactEncryptionKey: () => "" });
    await runtime.tick(context.tenantId);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM pi_place_context WHERE expires_at<='2000-01-01'").get()?.n, 0);
  } finally { db.sqlite.close(); }
});
