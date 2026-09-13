/** Provider-independent v1 contracts. All persistence is scoped to a server-resolved tenant. */
export const API_VERSION = "v1" as const;
export const PROVIDERS = ["google_places", "pagespeed", "builtwith", "hunter"] as const;
export type Provider = typeof PROVIDERS[number];
export type Feature = "discovery" | "enrichment" | "scoring" | "audit" | "crm";
export type ErrorCode = "invalid_request" | "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "timeout" | "unavailable" | "policy_blocked" | "budget_exhausted" | "conflict" | "unsupported" | "unknown";
export type EvidenceStatus = "complete" | "partial" | "missing" | "failed" | "policy_blocked";
export type JobStatus = "queued" | "running" | "retrying" | "completed" | "failed" | "dead_letter" | "cancelled";
export type Operation = "search" | "enrich" | "audit" | "convert";
export interface Context { tenantId: string; actor: string; role: "admin" | "operator" | "viewer"; requestId: string }
export class ProspectingError extends Error {
  constructor(public code: ErrorCode, message: string = code, public retryAfter = 0) { super(message); }
}
export const retryable = (code: ErrorCode) => ["timeout", "rate_limited", "unavailable"].includes(code);
export interface SearchInput {
  mode: "text" | "nearby"; query: string; type: string; latitude: number; longitude: number;
  radius: number; locale: string; pageSize: number; pageToken: string; minRating: number | null;
}
export interface BusinessFacts {
  name: string; address: string; latitude: number | null; longitude: number | null;
  phone: string; website: string; domain: string; categories: string[]; placeId: string;
  mapsUrl: string; rating: number | null; reviewCount: number | null;
  attributions: { name: string; uri: string }[];
}
export interface Prospect extends BusinessFacts {
  id: string; tenantId: string; identityKey: string; firstSeen: string; lastSeen: string;
  /** Only populated from independently verified CRM facts, never from the
   * temporary Google listing context. */
  independentWebsite?: string;
}
export interface EvidenceData {
  performance?: number; accessibility?: number; seo?: number; trust?: number; technology?: number;
  metrics?: Record<string, number>; technologies?: { name: string; lastDetected: string | null }[];
  contacts?: { email: string; name: string; verification: string; sources: string[] }[];
  verifiedContacts?: number; contactCount?: number; facts?: BusinessFacts;
  findings?: { ruleId: string; severity: "info" | "warning" | "critical"; text: string; remediation: string }[];
}
export interface Snapshot {
  id: string; tenantId: string; prospectId: string; source: Provider; providerVersion: string; operation: string;
  status: EvidenceStatus; retrievedAt: string; expiresAt: string; data: EvidenceData; error: ErrorCode | null;
  latencyMs: number; costUnits: number; requestId: string;
}
export interface ProviderResult { data: EvidenceData; status: EvidenceStatus; providerVersion: string; ttlSeconds: number }
export interface DiscoveryResult { businesses: BusinessFacts[]; nextPageToken: string; partial: boolean }
export interface DiscoveryPort { discoverBusinesses(input: SearchInput): Promise<DiscoveryResult>; getPlaceDetails(id: string): Promise<BusinessFacts> }
export interface EnrichmentPort { provider: Provider; enrich(prospect: Prospect): Promise<ProviderResult> }
/** Extension boundary for future approved providers. Registration and policy
 * authorization must precede dispatch; their SDK payloads stay in adapters. */
export interface OptionalProviderPort {
  id: string;
  evidenceKinds: readonly ("performance" | "technology" | "contacts" | "trust")[];
  enrich(prospect: Prospect): Promise<ProviderResult>;
}
export interface ContactPort extends EnrichmentPort { verifyContact(email: string): Promise<ProviderResult> }
export interface Job {
  id: string; tenant_id: string; prospect_id: string | null; provider: Provider | "internal" | "hidaca";
  operation: Operation; dedupe_key: string; status: JobStatus; attempts: number; max_attempts: number;
  lease_token: string | null; lease_until: number | null; next_run: number; payload: string;
  result: string | null; error_code: ErrorCode | null; request_id: string; actor: string;
  created_at: string; updated_at: string;
}
export interface Component { value: number | null; weight: number; evidenceIds: string[]; rule: string }
export interface Score { value: number | null; confidence: number; coverage: number; unknown: string[]; components: Record<string, Component> }
export interface ScoreSnapshot {
  id: string; tenantId: string; prospectId: string; scoringVersion: string; configVersion: string;
  calculatedAt: string; digitalHealth: Score; estimatedOpportunity: Score; evidenceIds: string[];
}
export interface ScoringConfig {
  version: string; minimumCoverage: number; healthWeights: number[]; opportunityWeights: number[];
  targetTypes: string[]; targetCenter: { latitude: number; longitude: number; radius: number } | null;
}
export interface TenantPolicy {
  version: string; enabled: Record<Feature, boolean>; providers: Record<Provider, boolean>;
  contactAllowed: boolean; contactPolicyReference: string; retentionDays: number; dailyBudget: number;
  providerBudgets: Record<Provider, number>; maxQueuedJobs: number;
  tenantConcurrency: number; providerConcurrency: number; maxBatch: number; scoring: ScoringConfig;
}
export interface ConversionMapping {
  prospectId: string; companyId: string | null; contactId: string | null; contactName: string;
  opportunityTitle: string; reviewed: boolean;
  /** Values entered or independently verified by the operator. Google listing
   * content must never be copied into durable CRM fields. */
  companyName?: string; companyAddress?: string; companyPhone?: string; companyWebsite?: string;
  contactPhone?: string;
}
export interface CrmMatch { id: string; name: string; signals: string[]; confidence: "exact" | "review" }
export interface ConversionPreview {
  exportState?: { id: string; status: string } | null;
  prospectId: string; company: { name: string; matches: CrmMatch[]; action: "create" | "reuse" | "review" };
  contact: { name: string; matches: CrmMatch[]; action: "create" | "reuse" | "review" };
  opportunity: { title: string; action: "create" | "reuse" }; pipeline: { id: string; stage: string };
  missing: string[]; conflicts: string[]; fingerprint: string; mapping: ConversionMapping;
}
export interface CrmPort {
  findCompany(context: Context, prospect: Prospect): Promise<CrmMatch[]>;
  createCompany(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string): Promise<string>;
  findContact(context: Context, prospect: Prospect, companyId: string | null): Promise<CrmMatch[]>;
  createContact(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string, companyId: string): Promise<string>;
  findOpportunity(context: Context, prospect: Prospect): Promise<string | null>;
  createOpportunity(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string, companyId: string, contactId: string): Promise<string>;
  ensurePipeline(context: Context): Promise<{ id: string; stage: string }>;
  preview(context: Context, prospect: Prospect, mapping: ConversionMapping): Promise<ConversionPreview>;
  convert(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string): Promise<Record<string, string>>;
}
export interface ProspectRepository {
  getProspect(tenantId: string, id: string): Promise<Prospect | null>;
  canonicalize(context: Context, facts: BusinessFacts): Promise<Prospect>;
  snapshots(tenantId: string, prospectId: string): Promise<Snapshot[]>;
  enqueue(context: Context, input: { prospectId?: string; provider: Job["provider"]; operation: Operation; key: string; payload: unknown }): Promise<Job>;
}
