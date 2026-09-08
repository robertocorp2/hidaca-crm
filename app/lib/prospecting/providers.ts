import { ProspectingError, type BusinessFacts, type ContactPort, type DiscoveryPort, type DiscoveryResult, type EnrichmentPort, type EvidenceData, type Prospect, type Provider, type ProviderResult, type SearchInput } from "./contracts";
import { distance, domainOf, publicWebsite, safeLink, text } from "./domain";

type Json = Record<string, unknown>;
const record = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const metric = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const score = (v: unknown): number | undefined => { const n = metric(v); return n !== undefined && n >= 0 && n <= 1 ? Math.round(n * 100) : undefined; };
export type Http = typeof fetch;
export function providerError(status: number, retryAfter = 0) {
  return new ProspectingError(status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : status >= 500 ? "unavailable" : "invalid_request", undefined, Math.min(3600, Math.max(0, retryAfter)));
}
/** Only these fixed API origins may receive credentials or outbound requests. */
const allowedHosts = new Set(["places.googleapis.com", "www.googleapis.com", "api.builtwith.com", "api.hunter.io", "cloudflare-dns.com"]);
export async function providerJson(url: string, init: RequestInit = {}, http: Http = fetch, timeout = 20000): Promise<Json> {
  if (!allowedHosts.has(new URL(url).hostname) || new URL(url).protocol !== "https:") throw new ProspectingError("policy_blocked");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    // Cloudflare's fetch runtime can throw for explicit redirect modes on an
    // otherwise valid provider response. These endpoints are fixed allow-listed
    // origins; reject any redirect response if one is returned.
    const response = await http(url, { ...init, signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new ProspectingError("policy_blocked");
    if (!response.ok || response.status === 202) throw providerError(response.status === 202 ? 503 : response.status, Number(response.headers.get("retry-after")) || 0);
    if (!/\b(json|dns-json)\b/i.test(response.headers.get("content-type") ?? "")) throw new ProspectingError("unavailable");
    if (!response.body) throw new ProspectingError("unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new ProspectingError("unavailable", "Respuesta demasiado grande."); } chunks.push(part.value); }
    const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = JSON.parse(new TextDecoder().decode(buffer));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProspectingError("unavailable");
    return parsed;
  } catch (error) {
    if (error instanceof ProspectingError) throw error;
    // Never persist upstream exception messages, request URLs or response bodies.
    throw new ProspectingError(controller.signal.aborted ? "timeout" : "unavailable");
  } finally { clearTimeout(timer); }
}
const placeFields = ["id", "displayName", "formattedAddress", "location", "internationalPhoneNumber", "websiteUri", "types", "googleMapsUri", "rating", "userRatingCount", "attributions"];
export const PLACES_SEARCH_FIELDS = placeFields.map(f => `places.${f}`).join(",");
export const PLACES_DETAILS_FIELDS = placeFields.join(",");
export function mapPlace(value: unknown): BusinessFacts {
  const p = record(value), location = record(p.location), website = safeLink(text(p.websiteUri, 2048));
  if (!text(p.id) || !text(record(p.displayName).text)) throw new ProspectingError("unavailable");
  return {
    name: text(record(p.displayName).text), placeId: text(p.id), address: text(p.formattedAddress, 500),
    latitude: metric(location.latitude) ?? null, longitude: metric(location.longitude) ?? null,
    phone: text(p.internationalPhoneNumber, 80), website, domain: website ? domainOf(website) : "",
    categories: array(p.types).filter((x): x is string => typeof x === "string").slice(0, 30), mapsUrl: safeLink(text(p.googleMapsUri, 2048)),
    rating: metric(p.rating) ?? null, reviewCount: metric(p.userRatingCount) ?? null,
    attributions: array(p.attributions).slice(0, 20).map(x => ({ name: text(record(x).provider), uri: safeLink(text(record(x).providerUri, 2048)) })),
  };
}
export class GooglePlaces implements DiscoveryPort {
  constructor(private key: string, private http: Http = fetch) {}
  private headers(mask: string) { if (!this.key) throw new ProspectingError("unauthorized"); return { "Content-Type": "application/json", "X-Goog-Api-Key": this.key, "X-Goog-FieldMask": mask }; }
  async discoverBusinesses(input: SearchInput): Promise<DiscoveryResult> {
    const circle = { center: { latitude: input.latitude, longitude: input.longitude }, radius: input.radius };
    const body = input.mode === "nearby"
      ? { includedTypes: [input.type], maxResultCount: input.pageSize, languageCode: input.locale, locationRestriction: { circle } }
      : { textQuery: input.query, pageSize: input.pageSize, languageCode: input.locale, locationBias: { circle },
        ...(input.type ? { includedType: input.type, strictTypeFiltering: true } : {}), ...(input.pageToken ? { pageToken: input.pageToken } : {}), ...(input.minRating !== null ? { minRating: input.minRating } : {}) };
    const data = await providerJson(`https://places.googleapis.com/v1/places:${input.mode === "nearby" ? "searchNearby" : "searchText"}`, { method: "POST", headers: this.headers(PLACES_SEARCH_FIELDS + (input.mode === "text" ? ",nextPageToken" : "")), body: JSON.stringify(body) }, this.http, 10000);
    if (data.places !== undefined && !Array.isArray(data.places)) throw new ProspectingError("unavailable");
    const businesses: BusinessFacts[] = []; let partial = false;
    for (const place of array(data.places).slice(0, 20)) {
      try {
        const business = mapPlace(place);
        // Text Search only supports a circular bias. Enforce the product's
        // requested radius after normalization instead of mislabelling it.
        if (business.latitude === null || business.longitude === null) { partial = true; continue; }
        if (distance(input, { latitude: business.latitude, longitude: business.longitude }) <= input.radius) businesses.push(business);
      } catch { partial = true; }
    }
    return { businesses, nextPageToken: text(data.nextPageToken, 4096), partial };
  }
  async getPlaceDetails(id: string): Promise<BusinessFacts> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new ProspectingError("invalid_request");
    return mapPlace(await providerJson(`https://places.googleapis.com/v1/places/${id}`, { headers: this.headers(PLACES_DETAILS_FIELDS) }, this.http, 10000));
  }
}
function globallyRoutable(address: string): boolean {
  if (address.includes(":")) return /^(2[0-9a-f]{3}|3[0-9a-f]{3}):/i.test(address) && !/^2001:(db8|0|10|20):/i.test(address) && !/^2002:/i.test(address);
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && [0, 168].includes(p[1])) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && [18, 19, 51].includes(p[1])) || (p[0] === 203 && p[1] === 0 && p[2] === 113));
}
export async function validatePublicDns(website: string, http: Http = fetch) {
  const domain = domainOf(website);
  let addresses = 0;
  for (const type of ["A", "AAAA"]) {
    const data = await providerJson(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, { headers: { Accept: "application/dns-json" } }, http, 5000);
    if (data.Status !== 0) throw new ProspectingError("policy_blocked", "No se pudo validar DNS público.");
    for (const a of array(data.Answer).map(record)) if (a.type === 1 || a.type === 28) { addresses++; if (!globallyRoutable(text(a.data))) throw new ProspectingError("policy_blocked"); }
  }
  if (!addresses) throw new ProspectingError("policy_blocked");
}
export function mapPageSpeed(data: Json): EvidenceData {
  const lighthouse = record(data.lighthouseResult), categories = record(lighthouse.categories), audits = record(lighthouse.audits);
  if (!Object.keys(lighthouse).length || lighthouse.runtimeError) throw new ProspectingError("unavailable");
  if (lighthouse.finalUrl) publicWebsite(text(lighthouse.finalUrl, 2048));
  const metrics: Record<string, number> = {};
  for (const key of ["largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time"]) { const n = metric(record(audits[key]).numericValue); if (n !== undefined) metrics[key] = n; }
  const https = score(record(audits["is-on-https"]).score), viewport = score(record(audits.viewport).score);
  const findings: NonNullable<EvidenceData["findings"]> = [];
  for (const [key, remedy] of [["is-on-https", "Configurar HTTPS y eliminar contenido mixto."], ["viewport", "Configurar una ventana adaptable a dispositivos móviles."], ["is-crawlable", "Revisar las restricciones de indexación."], ["document-title", "Agregar un título descriptivo por página."]] as const) {
    if (record(audits[key]).score === 0) findings.push({ ruleId: `lighthouse:${key}`, severity: "warning", text: text(record(audits[key]).title, 300) || key, remediation: remedy });
  }
  return { performance: score(record(categories.performance).score), accessibility: score(record(categories.accessibility).score), seo: score(record(categories.seo).score),
    // This limited technical trust dimension requires both checks. No claims
    // about conversion forms or contact paths are made without evidence.
    trust: https === undefined || viewport === undefined ? undefined : Math.round((https + viewport) / 2), metrics, findings };
}
export function mapBuiltWith(data: Json): EvidenceData {
  if (array(data.Errors).length) {
    const code = Number(record(array(data.Errors)[0]).Code);
    throw new ProspectingError(code === -2 ? "unauthorized" : code === -3 ? "budget_exhausted" : code === -4 ? "not_found" : code === -5 ? "forbidden" : [-6, -99].includes(code) ? "unavailable" : code === -7 ? "rate_limited" : "invalid_request");
  }
  if (!Array.isArray(data.Results)) throw new ProspectingError("unavailable");
  const technologies = array(data.Results).flatMap(r => array(record(record(r).Result).Paths)).flatMap(p => array(record(p).Technologies)).slice(0, 300).map(t => {
    const r = record(t), timestamp = typeof r.LastDetected === "string" ? Date.parse(r.LastDetected) : metric(r.LastDetected);
    return { name: text(r.Name), lastDetected: timestamp !== undefined && Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : null };
  }).filter(t => t.name);
  const flash = technologies.some(t => /^(Adobe Flash|Flash)$/i.test(t.name));
  return { technologies, ...(flash ? { technology: 0, findings: [{ ruleId: "technology:flash-v1", severity: "warning" as const, text: "El proveedor detectó Adobe Flash.", remediation: "Confirmar si sigue en uso y sustituir contenido dependiente de Flash." }] } : {}) };
}
export function mapHunter(data: Json): EvidenceData {
  const body = record(data.data);
  if (!Array.isArray(body.emails)) throw new ProspectingError("unavailable");
  const contacts = array(body.emails).slice(0, 10).map(v => {
    const c = record(v);
    return { email: text(c.value, 254).toLowerCase(), name: [text(c.first_name), text(c.last_name)].filter(Boolean).join(" "), verification: text(record(c.verification).status, 40) || "unknown", sources: array(c.sources).slice(0, 20).map(s => safeLink(text(record(s).uri, 2048))).filter(Boolean) };
  }).filter(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email));
  return { contacts, contactCount: contacts.length, verifiedContacts: contacts.filter(c => c.verification === "valid").length };
}
export class ProviderAdapter implements EnrichmentPort {
  constructor(public provider: Exclude<Provider, "google_places" | "hunter">, private key: string, private http: Http = fetch) {}
  async enrich(prospect: Prospect): Promise<ProviderResult> {
    if (!prospect.website) return { data: {}, status: "missing", providerVersion: "v1", ttlSeconds: 86400 };
    const website = publicWebsite(prospect.website);
    if (!this.key) throw new ProspectingError("unauthorized");
    await validatePublicDns(website, this.http);
    if (this.provider === "pagespeed") {
      const query = new URLSearchParams({ url: website, key: this.key, strategy: "mobile" });
      for (const category of ["performance", "accessibility", "seo", "best-practices"]) query.append("category", category);
      const data = mapPageSpeed(await providerJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`, {}, this.http));
      return { data, status: [data.performance, data.accessibility, data.seo].every(v => v !== undefined) ? "complete" : "partial", providerVersion: "v5-mobile", ttlSeconds: 86400 };
    }
    const query = new URLSearchParams({ KEY: this.key, LOOKUP: domainOf(website), NOMETA: "yes", NOATTR: "yes", NOPII: "yes", LIVEONLY: "yes" });
    const data = mapBuiltWith(await providerJson(`https://api.builtwith.com/v23/api.json?${query}`, {}, this.http));
    return { data, status: data.technologies?.length ? "complete" : "missing", providerVersion: "v23", ttlSeconds: 604800 };
  }
}
export class HunterAdapter implements ContactPort {
  provider = "hunter" as const;
  constructor(private key: string, private http: Http = fetch) {}
  async enrich(prospect: Prospect): Promise<ProviderResult> {
    if (!prospect.website) return { data: {}, status: "missing", providerVersion: "v2", ttlSeconds: 86400 };
    if (!this.key) throw new ProspectingError("unauthorized");
    await validatePublicDns(prospect.website, this.http);
    const query = new URLSearchParams({ domain: domainOf(prospect.website), api_key: this.key, limit: "10" });
    const data = mapHunter(await providerJson(`https://api.hunter.io/v2/domain-search?${query}`, {}, this.http));
    return { data, status: data.contactCount ? "complete" : "missing", providerVersion: "v2", ttlSeconds: 604800 };
  }
  async verifyContact(email: string): Promise<ProviderResult> {
    if (!this.key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProspectingError("invalid_request");
    const query = new URLSearchParams({ email, api_key: this.key });
    const data = record((await providerJson(`https://api.hunter.io/v2/email-verifier?${query}`, {}, this.http)).data);
    return { data: { contacts: [{ email, name: "", verification: text(data.status, 40) || "unknown", sources: [] }], verifiedContacts: data.status === "valid" ? 1 : 0, contactCount: 1 }, status: "complete", providerVersion: "v2", ttlSeconds: 604800 };
  }
}
export async function sealContacts(data: unknown, keyBase64: string, associatedData: string): Promise<string> {
  if (!keyBase64) throw new ProspectingError("policy_blocked", "Falta la clave de cifrado de contactos.");
  try {
    const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    if (keyBytes.length !== 32) throw new Error("key");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(associatedData) }, key, new TextEncoder().encode(JSON.stringify(data))));
    return JSON.stringify({ v: 1, iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...ciphertext)) });
  } catch { throw new ProspectingError("policy_blocked", "Clave de cifrado inválida."); }
}
