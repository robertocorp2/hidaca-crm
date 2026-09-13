import assert from "node:assert/strict";
import test from "node:test";
import { defaultPolicy, identityKeys, parseSearch, publicWebsite, validatePolicy } from "../app/lib/prospecting/domain";
import { calculateScores, eligibleSnapshots } from "../app/lib/prospecting/scoring";
import { effectivePolicy } from "../app/lib/prospecting/service";
import { context, facts, searchInput, switches, testPolicy } from "./prospecting-support";
import type { Prospect, Snapshot } from "../app/lib/prospecting/contracts";
const at = "2026-09-07T12:00:00.000Z";
const prospect: Prospect = { ...facts, id: "p1", tenantId: context.tenantId, identityKey: "v1:google:p1", firstSeen: at, lastSeen: at };
function evidence(source: Snapshot["source"], data: Snapshot["data"]): Snapshot { return { id: source, tenantId: context.tenantId, prospectId: "p1", source, providerVersion: "1", operation: "enrich", status: "complete", retrievedAt: at, expiresAt: "2026-09-08T12:00:00.000Z", data, error: null, latencyMs: 10, costUnits: 1, requestId: "r" }; }
test("identity normalization is versioned and never uses name alone", async () => {
  assert.deepEqual(await identityKeys(facts), await identityKeys({ ...facts, name: "Another display name", website: "https://www.example.com/path", address: "AV. PRINCIPAL 42, SANTO DOMINGO", phone: "+1 (809) 555-0101" }));
  await assert.rejects(identityKeys({ ...facts, placeId: "", website: "", domain: "", phone: "", address: "" }), /identidad/);
  assert.notDeepEqual(await identityKeys(facts), await identityKeys({ ...facts, placeId: "different", address: "Different branch" }));
});
test("search validates radii, coordinates, pagination, locale and filters", () => {
  assert.equal(parseSearch(searchInput).radius, 5000);
  for (const input of [{ radius: 50001 }, { radius: -1 }, { latitude: NaN }, { longitude: 181 }, { locale: "x<script>" }, { pageSize: 2.5 }, { mode: "nearby", type: "restaurant", pageToken: "token" }, { mode: "nearby", type: "restaurant", minRating: 4 }]) assert.throws(() => parseSearch({ ...searchInput, ...input }));
});
test("URL guard blocks private names, IP encodings, credentials, ports and unsafe protocols", () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "http://127.1", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://169.254.169.254", "http://metadata.internal", "https://example.com:8080", "https://example.com."]) assert.throws(() => publicWebsite(url), url);
  assert.equal(publicWebsite("https://example.com/path#fragment"), "https://example.com/path");
});
test("all features fail closed and require both allowlist and operator switches", () => {
  assert.ok(Object.values(defaultPolicy().enabled).every(v => !v));
  assert.ok(Object.values(effectivePolicy(testPolicy(), "hidaca", {}).enabled).every(v => !v));
  assert.ok(Object.values(effectivePolicy(testPolicy(), "unlisted", switches).enabled).every(v => !v));
  assert.equal(effectivePolicy(testPolicy(), "hidaca", { ...switches, PROSPECTING_DISABLED_PROVIDERS: "hunter" }).providers.hunter, false);
});
test("policy rejects invalid weight sets, unlimited batches and missing contact policy", () => {
  assert.throws(() => validatePolicy({ ...testPolicy(), maxBatch: 51 }));
  assert.throws(() => validatePolicy({ ...testPolicy(), contactAllowed: true }));
  assert.throws(() => validatePolicy({ ...testPolicy(), scoring: { ...testPolicy().scoring, healthWeights: [100, 100, 0, 0, 0] } }));
});
test("scores are reproducible, evidence-linked and suppress unknown dimensions", async () => {
  const snapshots = [evidence("pagespeed", { performance: 20, accessibility: 80, seo: 60, trust: 100 }), evidence("google_places", { facts })];
  const one = await calculateScores(prospect, snapshots, testPolicy().scoring, at);
  const two = await calculateScores(prospect, [...snapshots].reverse(), testPolicy().scoring, at);
  assert.deepEqual(one, two); assert.equal(one.digitalHealth.value, 58); assert.equal(one.digitalHealth.confidence, 85);
  assert.deepEqual(one.digitalHealth.unknown, ["technology"]); assert.deepEqual(one.evidenceIds, ["google_places", "pagespeed"]);
  const none = await calculateScores(prospect, [], testPolicy().scoring, at);
  assert.equal(none.digitalHealth.value, null); assert.equal(none.estimatedOpportunity.value, null); assert.equal(none.digitalHealth.confidence, 0);
  const changed = await calculateScores(prospect, snapshots, { ...testPolicy().scoring, version: "2" }, at);
  assert.notEqual(one.id, changed.id);
});
test("failed refresh never overwrites successful evidence and stale evidence is excluded", () => {
  const good = evidence("pagespeed", { performance: 50 });
  assert.deepEqual(eligibleSnapshots([good, { ...good, id: "bad", status: "failed", retrievedAt: "2026-09-07T12:00:01.000Z" }], "2026-09-07T12:00:02.000Z"), [good]);
  assert.deepEqual(eligibleSnapshots([good], "2026-09-09T00:00:00.000Z"), []);
});
test("scores stay in range for all boundaries, coverage levels and invalid numeric signals", async () => {
  for (const value of [-100, 0, 49, 50, 89, 90, 100, 1000, NaN]) {
    const result = await calculateScores(prospect, [evidence("pagespeed", { performance: value, accessibility: value, seo: value, trust: value })], testPolicy().scoring, at);
    for (const s of [result.digitalHealth, result.estimatedOpportunity]) { assert.ok(s.value === null || (s.value >= 0 && s.value <= 100)); assert.ok(s.confidence >= 0 && s.confidence <= 100); }
  }
});
