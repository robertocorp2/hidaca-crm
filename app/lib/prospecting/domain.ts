import { ProspectingError, type BusinessFacts, type Context, type Feature, type Provider, type SearchInput, type TenantPolicy } from "./contracts";

export const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
export const normalizePhone = (value: string) => value.replace(/\D/g, "").replace(/^00/, "");
// Pinned Google Places Table A filters, verified 2026-09-07. General
// contractors are a response-only Table B type; discover them with text query.
export const DISCOVERY_TYPES = ["roofing_contractor", "real_estate_agency", "hardware_store", "restaurant", "car_repair", "electrician", "plumber", "painter", "home_improvement_store", "building_materials_store"] as const;
export function text(value: unknown, max = 200): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProspectingError("invalid_request");
  return value as Record<string, unknown>;
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new ProspectingError("invalid_request", `Valor fuera de rango (${min}–${max}).`);
  return value;
}
export async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// Block IP literals (including alternate IPv4 encodings and IPv6), credentials,
// local names and nonstandard ports. Provider workers never fetch business URLs.
export function publicWebsite(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProspectingError("invalid_request", "Sitio web inválido."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
    !url.hostname.includes(".") || /[\[\]:]/.test(url.hostname) || /^\d+(\.\d+){3}$/.test(url.hostname) ||
    /\.(localhost|local|internal|lan|home|test|invalid|example|onion)$/i.test(url.hostname) || url.hostname.endsWith(".")) {
    throw new ProspectingError("policy_blocked", "El destino debe ser un sitio público.");
  }
  url.hash = "";
  return url.href;
}
export function safeLink(value: string): string { try { return publicWebsite(value); } catch { return ""; } }
export function domainOf(value: string): string { return new URL(publicWebsite(value)).hostname.replace(/^www\./, "").toLowerCase(); }
export async function identityKeys(facts: BusinessFacts): Promise<string[]> {
  const keys: string[] = [];
  if (facts.placeId) keys.push(`v1:google:${facts.placeId}`);
  const address = normalize(facts.address).replace(/[^\p{L}\p{N}]/gu, "");
  const phone = normalizePhone(facts.phone);
  const domain = facts.website ? domainOf(facts.website) : "";
  // A domain alone may identify a franchise, not a branch. Require two signals.
  if (address && domain) keys.push(`v1:domain-address:${await hash([domain, address])}`);
  if (phone.length >= 7 && address) keys.push(`v1:phone-address:${await hash([phone, address])}`);
  if (!keys.length) throw new ProspectingError("invalid_request", "Se requiere un ID de origen o dos señales de identidad.");
  return keys;
}
export function parseSearch(value: unknown): SearchInput {
  const p = object(value);
  if (p.mode !== "text" && p.mode !== "nearby") throw new ProspectingError("invalid_request", "Modo de búsqueda inválido.");
  const query = text(p.query), type = text(p.type, 80), locale = text(p.locale ?? "es", 20);
  if ((p.mode === "text" && !query) || (p.mode === "nearby" && !type) || (type && !(DISCOVERY_TYPES as readonly string[]).includes(type)) || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(locale)) throw new ProspectingError("invalid_request", "Consulta, categoría o idioma inválidos. Para otras actividades utiliza una consulta libre.");
  const pageSize = number(p.pageSize ?? 20, 1, 20);
  if (!Number.isInteger(pageSize)) throw new ProspectingError("invalid_request");
  const pageToken = text(p.pageToken, 4096);
  if (p.mode === "nearby" && (pageToken || p.minRating != null)) throw new ProspectingError("invalid_request", "Nearby no admite paginación ni filtro de valoración.");
  return { mode: p.mode, query, type, latitude: number(p.latitude, -90, 90), longitude: number(p.longitude, -180, 180), radius: number(p.radius, 1, 50000), locale, pageSize, pageToken, minRating: p.minRating == null ? null : number(p.minRating, 0, 5) };
}
export function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = Math.PI / 180, dlat = (b.latitude - a.latitude) * r, dlon = (b.longitude - a.longitude) * r;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dlon / 2) ** 2)));
}
export const defaultPolicy = (): TenantPolicy => ({
  version: "1", enabled: { discovery: false, enrichment: false, scoring: false, audit: false, crm: false },
  providers: { google_places: false, pagespeed: false, builtwith: false, hunter: false },
  contactAllowed: false, contactPolicyReference: "", retentionDays: 30, dailyBudget: 100,
  providerBudgets: { google_places: 100, pagespeed: 100, builtwith: 100, hunter: 100 }, maxQueuedJobs: 300,
  tenantConcurrency: 3, providerConcurrency: 2, maxBatch: 50,
  scoring: { version: "1", minimumCoverage: 0.5, healthWeights: [30, 20, 20, 15, 15], opportunityWeights: [35, 25, 20, 10, 10], targetTypes: [], targetCenter: null },
});
export function validatePolicy(value: unknown): TenantPolicy {
  const p = object(value), base = defaultPolicy();
  const enabled = object(p.enabled), providers = object(p.providers), scoring = object(p.scoring);
  for (const key of Object.keys(base.enabled) as Feature[]) { if (typeof enabled[key] !== "boolean") throw new ProspectingError("invalid_request"); base.enabled[key] = enabled[key]; }
  for (const key of Object.keys(base.providers) as Provider[]) { if (typeof providers[key] !== "boolean") throw new ProspectingError("invalid_request"); base.providers[key] = providers[key]; }
  base.dailyBudget = number(p.dailyBudget, 0, 10000); base.tenantConcurrency = number(p.tenantConcurrency, 1, 10);
  base.providerConcurrency = number(p.providerConcurrency, 1, 5); base.maxBatch = number(p.maxBatch, 1, 50); base.retentionDays = number(p.retentionDays, 1, 90);
  base.maxQueuedJobs = number(p.maxQueuedJobs ?? 300, 1, 1000);
  const providerBudgets = p.providerBudgets == null ? base.providerBudgets : object(p.providerBudgets);
  for (const provider of Object.keys(base.providers) as Provider[]) base.providerBudgets[provider] = number(providerBudgets[provider], 0, 10000);
  for (const n of [base.dailyBudget, base.tenantConcurrency, base.providerConcurrency, base.maxBatch, base.retentionDays, base.maxQueuedJobs, ...Object.values(base.providerBudgets)]) if (!Number.isInteger(n)) throw new ProspectingError("invalid_request");
  base.contactAllowed = p.contactAllowed === true; base.contactPolicyReference = text(p.contactPolicyReference, 500);
  if (base.contactAllowed && !base.contactPolicyReference) throw new ProspectingError("invalid_request", "Registra la política autorizada para datos de contacto.");
  base.scoring.minimumCoverage = number(scoring.minimumCoverage, 0.1, 1);
  for (const field of ["healthWeights", "opportunityWeights"] as const) {
    const weights = scoring[field];
    if (!Array.isArray(weights) || weights.length !== 5) throw new ProspectingError("invalid_request");
    base.scoring[field] = weights.map(n => number(n, 0, 100));
    if (Math.abs(base.scoring[field].reduce((a, b) => a + b, 0) - 100) > 0.001) throw new ProspectingError("invalid_request", "Los pesos deben sumar 100.");
  }
  if (!Array.isArray(scoring.targetTypes) || scoring.targetTypes.length > 50 || scoring.targetTypes.some(t => typeof t !== "string")) throw new ProspectingError("invalid_request");
  base.scoring.targetTypes = scoring.targetTypes.map(t => text(t, 80));
  if (scoring.targetCenter != null) { const c = object(scoring.targetCenter); base.scoring.targetCenter = { latitude: number(c.latitude, -90, 90), longitude: number(c.longitude, -180, 180), radius: number(c.radius, 1, 500000) }; }
  return base;
}
export function authorize(context: Context, write = false, admin = false) {
  if (!context.tenantId || !context.actor) throw new ProspectingError("unauthorized");
  if ((write && context.role === "viewer") || (admin && context.role !== "admin")) throw new ProspectingError("forbidden");
}
export function requireFeature(policy: TenantPolicy, feature: Feature, provider?: Provider) {
  if (!policy.enabled[feature] || (provider && !policy.providers[provider])) throw new ProspectingError("policy_blocked", "Función desactivada por la política de la organización.");
}
export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) throw new ProspectingError("invalid_request", "Se requiere una clave de idempotencia válida.");
  return value;
}
