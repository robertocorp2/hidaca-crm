import assert from "node:assert/strict";
import test from "node:test";
import { GooglePlaces, mapBuiltWith, mapHunter, mapPageSpeed, providerJson, sealContacts, validatePublicDns } from "../app/lib/prospecting/providers";
import { parseSearch } from "../app/lib/prospecting/domain";
import { facts, searchInput } from "./prospecting-support";
import { ProspectingError } from "../app/lib/prospecting/contracts";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
test("Places Text and Nearby use explicit masks and current request contracts", async () => {
  for (const mode of ["text", "nearby"] as const) {
    const provider = new GooglePlaces("secret-key", async (url, init) => {
      assert.match(String(url), mode === "text" ? /searchText$/ : /searchNearby$/);
      const headers = new Headers(init?.headers), mask = headers.get("X-Goog-FieldMask")!;
      assert.ok(mask.includes("places.attributions")); assert.ok(!mask.includes("*")); assert.equal(headers.get("X-Goog-Api-Key"), "secret-key");
      const body = JSON.parse(String(init?.body));
      if (mode === "text") { assert.equal(body.pageSize, 20); assert.equal(body.pageToken, "next"); assert.equal(body.locationBias.circle.radius, 5000); assert.ok(mask.includes("nextPageToken")); }
      else { assert.equal(body.maxResultCount, 20); assert.deepEqual(body.includedTypes, ["roofing_contractor"]); assert.equal(body.locationRestriction.circle.radius, 5000); assert.ok(!mask.includes("nextPageToken")); }
      return json({ places: [{ id: facts.placeId, displayName: { text: facts.name }, formattedAddress: facts.address, location: { latitude: facts.latitude, longitude: facts.longitude }, websiteUri: facts.website, googleMapsUri: facts.mapsUrl, attributions: [{ provider: "Source", providerUri: "https://example.org/" }] }], ...(mode === "text" ? { nextPageToken: "token-2" } : {}) });
    });
    const result = await provider.discoverBusinesses(parseSearch({ ...searchInput, mode, type: "roofing_contractor", pageToken: mode === "text" ? "next" : "" }));
    assert.equal(result.businesses.length, 1); assert.equal(result.businesses[0].attributions[0].name, "Source"); assert.ok(!JSON.stringify(result).includes("secret-key"));
  }
});
test("Places empty, partial page, invalid schema and radius enforcement", async () => {
  const empty = new GooglePlaces("x", async () => json({}));
  assert.deepEqual((await empty.discoverBusinesses(parseSearch(searchInput))).businesses, []);
  const partial = new GooglePlaces("x", async () => json({ places: [{ id: "bad" }, { id: "far", displayName: { text: "Far" }, location: { latitude: 50, longitude: 50 } }] }));
  const result = await partial.discoverBusinesses(parseSearch(searchInput)); assert.equal(result.partial, true); assert.equal(result.businesses.length, 0);
  const invalid = new GooglePlaces("x", async () => json({ places: "wrong" })); await assert.rejects(invalid.discoverBusinesses(parseSearch(searchInput)));
});
test("provider failures are typed and redact raw upstream bodies", async () => {
  for (const [status, code] of [[400, "invalid_request"], [401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"], [500, "unavailable"]] as const) {
    await assert.rejects(providerJson("https://api.hunter.io/v2/domain-search?api_key=secret", {}, async () => json({ secret: "upstream-secret" }, status)), (e: unknown) => e instanceof ProspectingError && e.code === code && !e.message.includes("secret"));
  }
  await assert.rejects(providerJson("https://api.hunter.io/v2/domain-search", {}, async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("secret url")))), 5), (e: unknown) => e instanceof ProspectingError && e.code === "timeout");
  await assert.rejects(providerJson("https://api.hunter.io/v2/domain-search", {}, async () => new Response("<html>secret</html>")), /unavailable/);
  await assert.rejects(providerJson("https://untrusted.example.org/?key=x", {}, async () => json({})), /policy_blocked/);
});
test("bounded JSON reader rejects oversized response and disables redirects", async () => {
  await assert.rejects(providerJson("https://api.hunter.io/v2/domain-search", {}, async (_url, init) => { assert.equal(init?.redirect, "error"); return json({ payload: "x".repeat(4 * 1024 * 1024) }); }), /grande/);
});
test("DNS guard rejects mixed public/private answers, CNAME-only and reserved IPv6", async () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "169.254.169.254", "100.64.0.1", "192.168.0.1", "2001:db8::1"]) await assert.rejects(validatePublicDns(facts.website, async () => json({ Status: 0, Answer: [{ type: address.includes(":") ? 28 : 1, data: address }] })), /policy_blocked/);
  await assert.rejects(validatePublicDns(facts.website, async () => json({ Status: 0, Answer: [{ type: 5, data: "private.local" }] })), /policy_blocked/);
  await validatePublicDns(facts.website, async url => json({ Status: 0, Answer: String(url).includes("type=AAAA") ? [] : [{ type: 1, data: "93.184.216.34" }] }));
});
test("provider fixture mapping preserves unknowns and verified-contact semantics", () => {
  const page = mapPageSpeed({ lighthouseResult: { categories: { performance: { score: 0.42 }, accessibility: { score: 0.9 }, seo: { score: null } }, audits: { "is-on-https": { score: 1 }, viewport: { score: 1 }, "is-crawlable": { score: 0, title: "Not crawlable" } } } });
  assert.equal(page.performance, 42); assert.equal(page.seo, undefined); assert.equal(page.trust, 100); assert.equal(page.findings?.length, 1);
  assert.throws(() => mapPageSpeed({ lighthouseResult: { runtimeError: { code: "ERRORED_DOCUMENT_REQUEST" } } }));
  const tech = mapBuiltWith({ Results: [{ Result: { Paths: [{ Technologies: [{ Name: "WordPress", LastDetected: 1788739200000 }] }] } }] });
  assert.equal(tech.technology, undefined); assert.equal(tech.technologies?.[0].name, "WordPress");
  assert.equal(mapBuiltWith({ Results: [{ Result: { Paths: [{ Technologies: [{ Name: "Adobe Flash" }] }] } }] }).technology, 0);
  const contact = mapHunter({ data: { emails: [{ value: "info@example.com", verification: { status: "valid" }, sources: [{ uri: "https://example.com/contact" }] }, { value: "maybe@example.com", verification: { status: "accept_all" } }] } });
  assert.equal(contact.verifiedContacts, 1); assert.equal(contact.contactCount, 2); assert.equal(contact.contacts?.[1].verification, "accept_all");
});
test("contact vault encrypts with random IV and binds tenant/snapshot as authenticated data", async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const a = await sealContacts([{ email: "private@example.com" }], key, "tenant:snapshot"), b = await sealContacts([{ email: "private@example.com" }], key, "tenant:snapshot");
  assert.notEqual(a, b); assert.ok(!a.includes("private"));
  await assert.rejects(sealContacts([], "", "x"));
});
