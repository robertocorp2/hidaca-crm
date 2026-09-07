# Prospecting Intelligence architecture

> **Status:** Proposed target-state architecture for review. HIDACA CRM does not yet contain the Prospecting Intelligence implementation, so the rules below describe the system to build rather than current runtime behavior.

## Executive summary

Prospecting Intelligence finds local businesses by type, location, and radius, enriches them progressively, explains their digital weaknesses, scores their fit for sales outreach, and converts selected businesses into CRM records. Google Places is the primary discovery source. PageSpeed, BuiltWith, Hunter, and optional secondary providers are adapters behind one enrichment boundary.

The source of truth is the normalized Prospect record plus immutable provider snapshots, score snapshots, audit results, and CRM export records stored in the application database. External providers are evidence sources, not authoritative application state. The most important rule is: never present a provider-derived value or score without recording its source, retrieval time, freshness, and scoring version.

### System architecture

```text
User / CRM operator
        |
  Web app or API
        |
Prospecting API  ---- Authorization, validation, budgets, idempotency
        |
  Application services
   |       |        |          |
Search  Enrichment  Scoring  CRM export
   |       |        |          |
Postgres + cache + job queue + object storage for raw evidence
        |
Google Places | PageSpeed | BuiltWith | Hunter | optional providers | CRM
```

### Dependency hierarchy

```text
HTTP/UI adapters -> application services -> ports/interfaces -> provider adapters
                                    |-> repositories -> database/cache
                                    |-> job scheduler -> workers
                                    |-> CRM adapter
```

The dependency rule is inward: provider SDKs, HTTP clients, and CRM details may not leak into scoring, deduplication, or product-facing contracts. Services depend on typed ports and normalized data. Workers use the same services as synchronous requests and must be safe to retry.

## Product boundary and invariants

In scope:

- Search businesses by business type, free-text query, location, and radius.
- Show normalized business results and progressive enrichment status.
- Show a business detail page with source evidence, health findings, opportunity rationale, and audit history.
- Calculate transparent Digital Health and Sales Opportunity scores.
- Select one or many prospects, deduplicate them, and create CRM Company, Contact, Opportunity, and Pipeline records through an adapter.
- Run repeatable audits and refresh stale evidence.

Out of scope for the first release:

- Automated outreach or sending email.
- Scraping Google Maps or websites outside approved provider APIs.
- Replacing a CRM as the system of record after export.
- Unreviewed AI-generated claims about a business.

Invariants:

- `INV-1`: A prospect has at most one canonical identity per tenant and normalized business identity key.
- `INV-2`: A score is reproducible from its input snapshot and scoring-version identifier.
- `INV-3`: Missing or failed enrichment never becomes a positive signal; it is shown as unknown and reduces confidence, not silently treated as good.
- `INV-4`: CRM creation is idempotent. Repeating the same conversion request cannot create duplicate records.
- `INV-5`: Secrets and raw provider payloads are never returned to an unprivileged client.
- `INV-6`: User-visible provider data carries `source`, `retrievedAt`, `expiresAt` or freshness policy, and `status`.

## Request and event lifecycle

### Search

1. The API authenticates the user and resolves the tenant.
2. It validates query, location, radius, page size, and tenant budget. Radius is bounded by product policy and provider limits.
3. It normalizes the search key from query, resolved coordinates, radius, filters, locale, and provider version.
4. It returns a cached result when the key is fresh; otherwise it creates a `ProspectSearch` and dispatches discovery.
5. The Google Places adapter uses Text Search for arbitrary queries and Nearby Search for mapped place types and a circular region. Requests use explicit field masks to control cost and response size. Place Details is fetched only for selected or missing fields.
6. Results are normalized, canonicalized, and deduplicated before persistence. Search returns stable prospect IDs, provider status, and enrichment status.
7. A lightweight initial response may contain name, address, coordinates, place ID, category, rating, review count, website, phone, and Maps URL when available. Expensive enrichment is asynchronous.

Search failures are typed. Invalid input fails synchronously. Provider timeouts or quota errors produce a partial search with per-provider status and a retryable job where safe. A failed provider must not erase a prior successful snapshot.

### Enrichment and audit

1. A user requests enrichment, opens a detail view that needs missing fields, or starts an audit.
2. The API creates an idempotent `EnrichmentJob` keyed by prospect, provider, operation, and requested freshness.
3. The worker claims the job, checks tenant and provider budgets, loads the canonical website/domain, and calls adapters in bounded stages: PageSpeed, BuiltWith, Hunter, then optional providers.
4. Each adapter stores a normalized result and a redacted raw response reference in `ProviderSnapshot`. It records request ID, provider version, status, latency, cost units if available, and error class.
5. The scoring service consumes the newest eligible snapshots and writes a `ScoreSnapshot` with component scores, weights, evidence references, unknown fields, confidence, and scoring version.
6. Audit findings are stored as `AuditFinding` records with severity, rule ID, evidence, and remediation text. A later run creates a new audit version; it does not mutate the prior run.
7. The UI receives progress by polling or server-sent events. It must tolerate out-of-order completion and show stale or unavailable data explicitly.

### CRM conversion

1. The user selects a prospect or a bulk selection and requests a conversion preview.
2. The service rechecks authorization, prospect freshness, deduplication, required fields, and CRM connectivity.
3. It returns proposed Company, Contact, Opportunity, and Pipeline mappings plus conflicts requiring review.
4. On confirmation, a `CrmExport` is created with an idempotency key. The worker resolves existing CRM IDs using stable external identifiers and configured matching rules.
5. It creates or updates records in dependency order, records every remote ID and operation, and marks the export `completed`, `partial`, or `failed`.
6. A retry resumes from the last successful operation. Compensation is used only for explicitly supported CRM operations; otherwise the export remains recoverable and visible for repair.

## API boundaries

The public API is versioned under `/v1` and returns typed error codes, request IDs, and provider status. Suggested endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /v1/prospect-searches` | Start or retrieve a search by type/query, location, radius, and filters |
| `GET /v1/prospect-searches/{id}` | Search status, pagination, counts, and provider errors |
| `GET /v1/prospects/{id}` | Detail, sources, scores, audit history, and CRM state |
| `POST /v1/prospects/{id}/enrichment` | Request selected or full enrichment with freshness policy |
| `POST /v1/prospects/{id}/audits` | Start an audit run |
| `POST /v1/prospect-selections/preview` | Deduplicate and preview bulk conversion |
| `POST /v1/prospect-selections/convert` | Enqueue idempotent CRM conversion |
| `GET /v1/jobs/{id}` | Progress and recovery state |

Provider ports should expose normalized methods, for example `discoverBusinesses`, `getPlaceDetails`, `runWebsitePerformanceAudit`, `detectTechnologies`, `findBusinessContacts`, and `verifyContact`. They must not expose provider response objects to the domain layer.

The CRM port must support `findCompany`, `createCompany`, `findContact`, `createContact`, `findOpportunity`, `createOpportunity`, and `ensurePipeline`. A project-specific adapter maps these operations to the selected CRM. If the CRM cannot support a requested operation, the adapter returns a typed `unsupported` result and the conversion remains partial and repairable.

## Data model

All records include `tenantId`, timestamps, and audit metadata. Sensitive fields are encrypted at rest or tokenized where possible.

| Record | Important fields and rules |
|---|---|
| `ProspectSearch` | normalized input, center coordinates, radius, provider, status, counts, cache key, request actor |
| `Prospect` | canonical name, address, coordinates, phone, website/domain, categories, Google place ID, identity key, lifecycle state, first/last seen |
| `ProspectSourceLink` | prospect ID, provider, external ID, source URL, match confidence, first/last seen |
| `ProviderSnapshot` | provider, operation, normalized payload, raw payload reference, status, retrieved/expiry times, latency, cost units, error class |
| `EnrichmentJob` | prospect, provider, operation, dedupe key, attempts, lease, next run, status, trace ID |
| `ScoreSnapshot` | digital health score, sales opportunity score, confidence, component values, weights, evidence IDs, scoring version |
| `AuditRun` / `AuditFinding` | run status, requested scope, rule ID, severity, finding, evidence, remediation, timestamps |
| `DedupCandidate` | prospect pair or prospect/CRM match, matching signals, confidence, resolution, reviewer |
| `CrmExport` / `CrmExportOperation` | idempotency key, mapping, remote IDs, operation order, status, errors, retry metadata |
| `ProviderCredential` | tenant/provider reference, encrypted secret handle, enabled scopes, budget, last validation |

Identity keys are deterministic and versioned. Prefer provider IDs where available. Otherwise combine normalized domain, phone, and address components. Never use business name alone as a unique key. Store aliases and merge history rather than deleting losing records.

## Services and modules

- **Prospecting API:** authentication context, request validation, pagination, response shaping, rate-limit headers, and idempotency checks. It does not call providers directly.
- **Search service:** query normalization, provider selection, search caching, result normalization, and deduplication.
- **Enrichment orchestrator:** job creation, dependency ordering, freshness, retries, budgets, and provider status aggregation.
- **Provider adapters:** one adapter per external API. They own authentication, request shaping, provider error mapping, field masks, and response normalization.
- **Scoring service:** pure calculation over normalized evidence. It owns scoring versions and explanations, not provider calls.
- **Audit service:** deterministic rules, findings, severity, and evidence links. It does not invent facts when evidence is missing.
- **CRM export service:** dedup preview, mapping, idempotent writes, partial recovery, and export history.
- **Repositories:** transaction boundaries and persistence. They do not contain provider or scoring policy.
- **Worker runtime:** leases, retries, dead-letter handling, and graceful shutdown.
- **Operations layer:** metrics, traces, structured logs, feature flags, quotas, and kill switches.

## Scoring architecture

Scores are integer values from 0 to 100 and are recalculated only from normalized snapshots. Every result includes component values, weight, evidence, unknown count, confidence, and `scoringVersion`.

### Digital Health

Initial dimensions and default weights:

| Dimension | Weight | Example evidence |
|---|---:|---|
| Performance | 30% | PageSpeed performance score, Core Web Vitals, mobile result |
| Accessibility | 20% | Lighthouse accessibility result and critical findings |
| SEO discoverability | 20% | Lighthouse SEO, indexability and metadata findings |
| Website trust and conversion | 15% | HTTPS, mobile usability, contact path, broken-link or form findings |
| Technology freshness | 15% | BuiltWith technology age, CMS/runtime signals, unsupported patterns |

Each dimension has explicit rule thresholds and evidence IDs. A missing dimension becomes `unknown`; the aggregate uses available dimensions but lowers confidence and reports coverage. A configurable minimum evidence threshold can suppress the score in early enrichment rather than guessing.

### Sales Opportunity

Initial dimensions and default weights:

| Dimension | Weight | Example evidence |
|---|---:|---|
| Need signal | 35% | Digital Health gaps, stale technology, missing conversion paths |
| Fit | 25% | Business type, geography, service area, tenant targeting rules |
| Reachability | 20% | Website, phone, verified business or generic contact availability |
| Intent and recency | 10% | Recent search appearance, review activity, audit freshness |
| Data confidence | 10% | Identity match and provider coverage |

Sales Opportunity must not claim buying intent. Its label should say “estimated opportunity” and explain the signals. Tenant-specific weights and thresholds are configuration, versioned, and permissioned. Score changes create a new snapshot, not an overwrite.

## Async jobs, caching, and limits

Use a durable queue with at-least-once delivery, visibility leases, exponential backoff with jitter, and a dead-letter queue. Every job has a deterministic dedupe key and a maximum attempt count. Workers renew leases and mark jobs interrupted on shutdown so they can be retried.

Recommended defaults, subject to load testing:

- Search request: 30 requests per tenant per minute, with a configurable daily provider budget.
- Enrichment: per-tenant and per-provider concurrency caps; one active job per prospect/provider/operation.
- Bulk conversion: bounded batches, for example 50 prospects per request and 10 remote writes per worker batch.
- Provider timeout: 10 seconds for search, 20 seconds for enrichment, with provider-specific overrides.
- Retry: only timeouts, 429, and transient 5xx; no retry for invalid credentials, invalid input, or policy denial.

Cache keys include tenant policy, query, coordinates, radius, locale, field-set version, and provider version. Discovery results can be cached for 24 hours by default. Place details, websites, technology data, and contacts use separate freshness windows. A stale-while-revalidate response is allowed only when the response marks the data stale.

## Security and privacy

- Authenticate every request and authorize tenant, role, and action at the service boundary.
- Store provider and CRM credentials in a managed secret store; persist only a reference and metadata.
- Encrypt contact data and raw provider evidence at rest. Redact secrets, access tokens, and unnecessary personal data from logs.
- Treat provider payloads, business websites, reviews, and contact data as untrusted input. Sanitize HTML and URLs before rendering.
- Restrict Hunter or other contact enrichment to configured lawful use, retain provenance and consent/policy metadata, and provide tenant-level deletion and retention controls.
- Apply SSRF protections to website fetches: allow only `http`/`https`, block private/link-local ranges, validate redirects, enforce response-size and content-type limits, and run fetches from an isolated worker network.
- Use idempotency keys and audit logs for exports, merges, credential changes, and bulk actions.
- Apply least privilege to workers. A discovery worker must not read CRM write credentials.

## Observability and failure handling

Every request and job carries `requestId`, `traceId`, `tenantId`, `prospectId` where applicable, provider, operation, and scoring version. Emit metrics for search latency, cache hit rate, result count, enrichment completion, freshness, provider error classes, quota usage, job retries, score coverage, dedup conflicts, CRM export success, and cost units.

Provider errors map to `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `timeout`, `unavailable`, `policy_blocked`, or `unknown`. UI behavior is explicit: retryable errors show retry state; missing data shows unknown; stale data remains visible with a timestamp; one provider failure does not block independent enrichment.

Use circuit breakers for repeated provider failures, a per-provider kill switch, and a tenant kill switch for enrichment or CRM writes. Dead-letter jobs are inspectable and replayable after the root cause is fixed. Database migrations are backward compatible with one deploy of dual-read or dual-write when needed. Rollback disables new workers and feature flags first, preserves snapshots, and never deletes evidence or CRM export history.

## Phased delivery and release gates

| Phase | Scope | Acceptance gate | Rollback or validation |
|---|---|---|---|
| 1. Foundation | Contracts, migrations, identity keys, jobs, budgets, observability | Migrations are reversible, tenant isolation tests pass, duplicate delivery is safe, and no production flag is enabled | Disable all feature flags; verify no existing data or queues are changed |
| 2. Discovery | Google Places search, caching, canonical prospects, result views | Search handles valid, empty, duplicate, quota, and partial responses with source attribution and bounded cost | Disable discovery; preserve stored prospects and replay only failed searches |
| 3. Intelligence | PageSpeed, BuiltWith, Hunter, audits, score snapshots, detail views | Each score is reproducible and evidence-linked; missing data is explicit; one provider failure does not stop others | Disable the affected provider or enrichment flag; keep prior snapshots and stale markers |
| 4. Conversion | Dedup preview, CRM adapter, idempotent Company/Contact/Opportunity/Pipeline writes | Sandbox conversion repeated twice creates one record set, conflicts require review, and partial failures are repairable | Disable CRM writes first; leave export operations and remote IDs for repair, with no automatic deletion |
| 5. Scale and rollout | Bulk actions, load proof, alerts, tenant allowlist, runbooks | Maximum batch, queue backpressure, security, cost, and end-to-end tests pass in a controlled tenant | Reduce concurrency or disable bulk/enrichment; drain workers and replay dead letters after repair |

Each phase must produce automated evidence for its gate before the next phase is enabled. A rollout proceeds from synthetic fixtures to provider sandboxes, then to an internal tenant, then to an allowlist. Provider contracts, quotas, prices, and privacy requirements are revalidated at each release because they can change independently of the application.

## Verification strategy

- Unit tests cover normalization, identity keys, dedup signals, score formulas, unknown handling, freshness, retry classification, and idempotency keys.
- Contract tests use recorded or synthetic provider fixtures and assert field-mask, pagination, authentication, and error mappings without real provider spend.
- Integration tests cover database transactions, queue leases, cache behavior, stale refresh, audit versioning, and CRM export recovery.
- End-to-end tests cover search, progressive enrichment, detail/audit views, bulk preview, duplicate resolution, and repeat conversion.
- Security tests cover tenant isolation, secret redaction, SSRF blocking, HTML sanitization, authorization, replayed requests, and deletion/retention behavior.
- Load tests cover concurrent searches, enrichment fan-out, cache stampede prevention, queue backpressure, and bounded bulk conversion.
- Manual validation confirms provider attribution, score explanations, partial failures, stale states, and CRM conflict handling.

## Source map and evidence

This is a proposed architecture and has no repository implementation to verify. The provider contracts should be checked during implementation against the current official documentation:

- [Google Places API (New) overview](https://developers.google.com/maps/documentation/places/web-service/op-overview)
- [Google Places field masks](https://developers.google.com/maps/documentation/places/web-service/choose-fields)
- [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText)
- [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)
- [BuiltWith API](https://api.builtwith.com/)
- [Hunter API](https://hunter.io/api-documentation/)

Before implementation is approved, replace this section with links to the repository's migrations, service modules, provider contract tests, and deployment configuration. Any provider field, price, quota, or policy that is not pinned in code/configuration is an evidence gap and must be validated in the relevant adapter task.
