# Prospecting Intelligence implementation plan

> **Status:** Implementation delivered behind disabled flags. [Release proof](./release-proof.md) maps all nine tasks to source and tests and records the remaining browser/live-provider release gates. The acceptance criteria below remain the delivery contract.

## Delivery rules

Each task below is one focused implementation result and should produce one reviewable change. Tasks are ordered by dependency. Keep provider-specific code behind the ports defined in the architecture. Preserve the invariants `INV-1` through `INV-6`, especially evidence provenance, reproducible scores, and idempotent CRM conversion.

The plan assumes the project already has authentication, tenant context, a relational database, a durable job mechanism, and a CRM integration point. If one is missing, add it inside the task that first needs it and document the repository-specific choice in that task's agent notes.

## Milestone 1: Shared contracts and safe foundations

### 1. Define the prospecting contracts and persistence model

#### What are we building?

Create the versioned API types, domain records, migrations, repository interfaces, provider ports, job states, and feature flags needed by the feature. The result is a compilable foundation that can store a prospect, its source evidence, enrichment jobs, score snapshots, audits, dedup decisions, and CRM export operations without exposing provider-specific payloads.

#### Why?

All later work needs one shared vocabulary and stable identity rules. Establishing it first prevents separate agents from inventing incompatible records or silently treating missing data as a positive result.

#### Done when

- Migrations create the records and indexes described in the architecture, including tenant scoping and immutable snapshot relationships.
- Identity-key creation is deterministic, versioned, and covered by tests; name alone cannot identify a prospect.
- API schemas define typed status and error values, pagination, idempotency keys, and provider attribution.
- Repository and provider interfaces compile without importing external provider SDK types.
- Feature flags exist for discovery, enrichment, scoring, audit, and CRM writes, defaulting to off in production.

#### How to check

Run the repository formatter, type checker, migration up/down check, and unit tests. Inspect generated schema/API output. Add a test that submits the same identity twice and gets one canonical prospect.

#### Agent notes

- Depends on: None.
- Source: [architecture.md](./architecture.md), sections “API boundaries,” “Data model,” and “Invariants.”
- Use backward-compatible migrations. Raw provider payloads must be stored by reference or encrypted according to existing storage conventions. Do not add CRM-specific columns to the core Prospect table.

#### Out of scope

- Calling real providers.
- Building search screens or CRM write behavior.
- Choosing a specific CRM vendor when the project has not selected one.

### 2. Add job execution, budgets, and observability primitives

#### What are we building?

Implement the reusable worker runtime for prospecting jobs: leases, dedupe keys, retry classification, backoff, dead-letter state, shutdown recovery, tenant/provider concurrency limits, and traceable structured events. Add the feature metrics and provider budget counters needed to operate the pipeline safely.

#### Why?

Enrichment fans out across paid and rate-limited services. A durable, observable job boundary prevents duplicate work, runaway spend, and invisible partial failure.

#### Done when

- A job can be enqueued once, claimed with a lease, retried only for approved transient failures, and moved to dead letter after the configured attempt limit.
- Replayed delivery of the same dedupe key creates one active job and does not repeat a completed operation unless freshness requires it.
- Shutdown releases or expires leases so unfinished work resumes safely.
- Tenant and provider concurrency plus daily budget checks are enforced before an external call.
- Metrics and traces include request ID, tenant ID, prospect ID, provider, operation, retry count, and outcome without secrets.

#### How to check

Run worker unit and integration tests. Kill a worker during a leased job and confirm the job is recoverable. Submit duplicate jobs concurrently and verify one execution. Exercise timeout, 429, 4xx, 5xx, credential, and policy-blocked fixtures.

#### Agent notes

- Depends on: Define the prospecting contracts and persistence model.
- Source: [architecture.md](./architecture.md), sections “Async jobs, caching, and limits” and “Observability and failure handling.”
- Keep provider calls outside database transactions. Use jittered backoff and circuit-breaker state. Budget denial is a visible non-retryable outcome until a new budget window or operator action.

#### Out of scope

- Provider-specific request logic.
- Scoring formulas.
- CRM compensation workflows.

## Milestone 2: Discovery and enrichment

### 3. Implement Google Places discovery and canonical business results

#### What are we building?

Implement the Google Places adapter and search service for business type, free-text query, location, radius, filters, pagination, caching, and normalized results. Add canonicalization and deduplication before search results are returned or stored.

#### Why?

Discovery is the entry point for every prospecting workflow. It must produce stable, useful business records while controlling Places cost and handling partial provider results.

#### Done when

- Text Search supports arbitrary business queries and Nearby Search supports mapped types with a circular location restriction.
- Requests use explicit production field masks and never use an unrestricted wildcard field set.
- Search validates radius, coordinates, locale, page size, and tenant budget before calling Google.
- Repeated searches within the freshness window use the normalized cache key and return stable prospect IDs.
- Results with the same place ID or equivalent identity key merge into one prospect and preserve source links.
- Provider quota, timeout, invalid-input, and partial-page outcomes are visible through typed status and metrics.

#### How to check

Run adapter contract tests against fixtures for Text Search, Nearby Search, pagination, empty results, field-mask errors, and quota errors. Run integration tests for cache hits, duplicate places, radius validation, and tenant isolation. Manually verify a sandbox search returns source attribution and no API key.

#### Agent notes

- Depends on: Add job execution, budgets, and observability primitives; Define the prospecting contracts and persistence model.
- Source: [architecture.md](./architecture.md), “Search,” “API boundaries,” and “Caching.” Validate current Places request/response fields against the official documentation before pinning them.
- Keep Google place IDs and Maps URLs as source metadata. Do not make Google the application source of truth after normalization.

#### Out of scope

- PageSpeed, BuiltWith, Hunter, or contact enrichment.
- CRM conversion.
- Website crawling beyond the provider-supported fields.

### 4. Implement progressive enrichment adapters and orchestration

#### What are we building?

Add PageSpeed, BuiltWith, and Hunter adapters plus an optional-provider interface, then connect them to the enrichment orchestrator. The system should enrich a selected prospect in stages, record each result as a provenance-bearing snapshot, and continue when one provider is unavailable.

#### Why?

The feature’s value comes from turning a business listing into usable evidence. Progressive enrichment keeps initial search fast and makes provider cost, freshness, and failure visible.

#### Done when

- PageSpeed produces normalized performance, accessibility, and SEO evidence for a validated public website.
- BuiltWith produces normalized technology evidence with provider timestamp and lookup status.
- Hunter produces contact/domain evidence only when policy and tenant settings allow it, with verification status and provenance.
- Missing website, invalid domain, provider quota, provider timeout, and policy denial produce explicit snapshot states and do not erase prior good data.
- One provider failure does not block independent providers, and a repeated enrichment request is deduplicated by prospect/provider/operation/freshness.
- Credentials are read only by the relevant worker path and never enter logs, API responses, or snapshots.

#### How to check

Run unit tests for URL normalization, redirect/SSRF guards, response mapping, freshness, retry classification, and redaction. Run adapter contract tests with success, empty, invalid, quota, and timeout fixtures. Run an integration test where PageSpeed fails but BuiltWith completes.

#### Agent notes

- Depends on: Implement Google Places discovery and canonical business results; Add job execution, budgets, and observability primitives.
- Source: [architecture.md](./architecture.md), “Enrichment and audit,” “Security and privacy,” and “Provider adapters.” Recheck current provider authentication and limits when implementing.
- Website fetches must block private/link-local targets, enforce response-size/content-type limits, and validate redirects. Treat all returned text and HTML as untrusted.

#### Out of scope

- Score calculation.
- CRM contact creation.
- Unbounded crawling or scraping.

## Milestone 3: Explainable intelligence and workflows

### 5. Build versioned Digital Health and Sales Opportunity scoring

#### What are we building?

Implement pure scoring functions that consume normalized snapshots and produce immutable score snapshots with component values, weights, evidence IDs, unknown fields, confidence, and scoring version. Add tenant configuration for permitted weights and thresholds.

#### Why?

Sales users need to know both which businesses are promising and why. Versioned, evidence-linked scores make the recommendation inspectable, testable, and safe to revise.

#### Done when

- Digital Health calculates the documented performance, accessibility, SEO, trust/conversion, and technology components.
- Sales Opportunity calculates need, fit, reachability, intent/recency, and data-confidence components without claiming buying intent.
- Missing dimensions are unknown, reduce confidence, and never become a positive score.
- Every score stores formula version, weights, source evidence, coverage, and calculation timestamp.
- A fixed fixture produces the same score across runs, and changing the scoring version creates a new snapshot rather than mutating history.

#### How to check

Run table-driven unit tests for threshold boundaries, missing evidence, conflicting snapshots, low coverage, custom weights, and version changes. Run a property test that scores remain in 0 to 100. Verify the API explanation lists the exact evidence used.

#### Agent notes

- Depends on: Implement progressive enrichment adapters and orchestration.
- Source: [architecture.md](./architecture.md), “Scoring architecture” and invariants `INV-2` and `INV-3`.
- Keep formulas in domain code or versioned configuration, not provider adapters. Do not infer intent from reviews or contact presence.

#### Out of scope

- Machine-learning ranking.
- Automated outreach copy.
- Rewriting previous score snapshots.

### 6. Deliver business detail, audit, and enrichment-progress views

#### What are we building?

Expose the search results, detail view, score explanation, source evidence, audit findings, job progress, stale states, and retry actions through the product API and UI. Users should be able to select a prospect, request enrichment, run an audit, and understand what is known or unavailable.

#### Why?

Transparent evidence is the product experience. Users must be able to validate a prospect before spending CRM capacity or contacting a business.

#### Done when

- Search results show identity, location, basic business facts, scores when available, freshness, enrichment status, and source attribution.
- Detail view separates provider facts, score components, audit findings, and CRM state.
- Partial, stale, failed, and in-progress states are explicit and actionable.
- User actions are authorized by tenant and role, and retry actions are idempotent.
- Sensitive provider data is redacted according to tenant policy and never rendered as raw HTML.

#### How to check

Run API integration and browser tests for empty, loading, partial, stale, denied, and failed states. Verify keyboard/accessibility behavior for tables and bulk selection. Manually compare a detail view with stored evidence and confirm every score explanation links to a source snapshot.

#### Agent notes

- Depends on: Build versioned Digital Health and Sales Opportunity scoring; Implement progressive enrichment adapters and orchestration; Implement Google Places discovery and canonical business results.
- Source: [architecture.md](./architecture.md), “Request and event lifecycle,” “API boundaries,” and “Security and privacy.”
- Use polling or server-sent events consistently with existing project conventions. Do not make the UI wait for all enrichment.

#### Out of scope

- CRM writes.
- Prospect ranking beyond the documented scores.
- Unreviewed AI summaries.

## Milestone 4: CRM conversion and bulk operations

### 7. Implement deduplication preview and idempotent CRM conversion

#### What are we building?

Implement the CRM port and project-specific adapter, then add conversion preview and confirmed conversion for Company, Contact, Opportunity, and Pipeline records. Resolve existing records before creating anything and persist every operation for retry and repair.

#### Why?

The feature only creates sales value when a qualified prospect can move into the CRM without duplicates or ambiguous ownership.

#### Done when

- Preview displays proposed mappings, existing CRM matches, conflicts, missing required fields, and the action for each record.
- Matching uses stable external IDs first, then configured domain/phone/address signals; name-only matches require review.
- Confirmed conversion is idempotent by tenant and request key and records all remote IDs.
- Company, Contact, Opportunity, and Pipeline operations run in dependency order and support partial recovery.
- Provider or CRM failures leave a visible export state with retryable operations and do not duplicate successful writes.

#### How to check

Run CRM contract tests with existing and missing records, conflicts, rate limits, partial failures, duplicate requests, and unsupported operations. Run an end-to-end conversion twice and verify one set of CRM records. Test tenant isolation and secret redaction in export logs.

#### Agent notes

- Depends on: Deliver business detail, audit, and enrichment-progress views; Define the prospecting contracts and persistence model; Add job execution, budgets, and observability primitives.
- Source: [architecture.md](./architecture.md), “CRM conversion,” “API boundaries,” and invariants `INV-1` and `INV-4`.
- Keep CRM-specific field mapping in the adapter/configuration. Never store CRM tokens in Prospect or ProviderSnapshot. If the CRM lacks pipelines or opportunities, return a typed unsupported result and keep the export repairable.

#### Out of scope

- Sending outreach.
- Automatic merging of ambiguous CRM records.
- Deleting CRM records during rollback.

### 8. Add bulk selection, batch enrichment, and audit workflows

#### What are we building?

Add bulk selection across search results, bulk enrichment/audit requests, dedup review, conversion preview, and bounded batch execution. The workflow must show progress and preserve per-prospect outcomes instead of collapsing a mixed batch into one status.

#### Why?

Prospecting is useful at list scale. Bulk actions must be faster than one-by-one work without bypassing budgets, authorization, deduplication, or evidence rules.

#### Done when

- Bulk actions enforce tenant limits, maximum batch size, provider budgets, and role permissions before enqueueing.
- Each prospect receives an independent job and final outcome, with aggregate progress and retry controls.
- Deduplication runs before CRM conversion and surfaces ambiguous matches for review.
- Repeating a bulk request does not create duplicate jobs or CRM records.
- Cancellation stops not-yet-started work and leaves in-flight work recoverable.

#### How to check

Run batch tests for all-success, mixed provider failures, duplicate selection, budget exhaustion, cancellation, retry, and partial CRM export. Load-test the configured maximum batch size and verify queue backpressure and UI progress.

#### Agent notes

- Depends on: Implement deduplication preview and idempotent CRM conversion; Deliver business detail, audit, and enrichment-progress views; Add job execution, budgets, and observability primitives.
- Source: [architecture.md](./architecture.md), “Async jobs, caching, and limits” and “CRM conversion.”
- Use a stable bulk operation ID and per-item idempotency key. Never bypass the single-prospect conversion path.

#### Out of scope

- Unlimited exports.
- Background outreach or campaign enrollment.
- Manual merge automation without review.

## Milestone 5: Proof, rollout, and rollback

### 9. Add security, reliability, and end-to-end release proof

#### What are we building?

Complete the feature with security tests, provider contract fixtures, end-to-end workflows, load tests, dashboards, alerts, runbooks, and staged rollout controls. Validate the feature against real sandbox credentials only after synthetic tests pass.

#### Why?

This feature crosses paid third-party APIs, personal contact data, website fetches, and CRM writes. Release proof must show that failure is contained and reversible.

#### Done when

- Tenant isolation, role checks, secret redaction, SSRF blocking, HTML sanitization, retention/deletion, and replay protection have automated coverage.
- Contract fixtures cover current provider schemas, field masks, pagination, quotas, and auth failures.
- End-to-end tests prove search to enrichment to score to audit to conversion, including partial failure and repeat conversion.
- Dashboards and alerts exist for provider failure rate, quota/budget use, queue age, enrichment freshness, score coverage, export failures, and dead-letter jobs.
- Feature flags support internal-only enablement, tenant allowlists, provider kill switches, and immediate disabling of CRM writes.

#### How to check

Run the full unit, integration, security, browser, contract, and load suites. Run a sandbox smoke test with cost/budget monitoring. Validate rollback by disabling flags, draining workers, replaying a dead-letter job after repair, and confirming snapshots and export history remain intact.

#### Agent notes

- Depends on: All prior tasks.
- Source: [architecture.md](./architecture.md), “Security and privacy,” “Observability and failure handling,” and “Verification strategy.”
- Rollback is flag-first: disable CRM writes, then enrichment, then discovery if necessary. Do not delete evidence or attempt destructive CRM cleanup automatically.

#### Out of scope

- Production-wide enablement without an operator-approved rollout window.
- Provider contract assumptions that are not verified against current documentation.
- Performance claims beyond measured test results.

## Decisions that must remain explicit

- The target CRM and its exact Company, Contact, Opportunity, and Pipeline fields are project-specific. Implement the adapter contract first and pin the mapping before enabling CRM writes.
- Tenant retention period, allowed contact-enrichment use, and score customization permissions require product and compliance confirmation. Use conservative defaults and keep these settings configurable.
- Provider quotas, prices, field availability, and policy requirements must be checked at implementation time and captured in adapter tests and configuration, not hard-coded from this plan.
