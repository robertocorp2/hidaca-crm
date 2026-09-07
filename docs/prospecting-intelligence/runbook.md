# Prospecting Intelligence operations

The web UI is `/app/prospecting`; authenticated JSON endpoints live under `/v1`. The implementation is disabled by default. Deploying this code does not authorize provider storage, contact enrichment, CRM writes, or production-wide rollout.

## Runtime and installation

The Sites web worker authenticates staff and queues work in the existing D1 database. `worker/prospecting.ts` is a **separate scheduled Cloudflare Worker**, draining at most ten jobs per minute invocation. Both workers must bind `DB` to the same database for a given environment. Staging must use a separate database and worker name. The checked-in zero database ID is a placeholder; do not deploy it unchanged.

1. Install with `npm ci` using Node 22.13 or newer. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build:prospecting`.
2. Apply the additive `drizzle/0015_prospecting_intelligence.sql` and `drizzle/0016_place_id_first_google_context.sql` migrations through the established Sites migration process after the earlier migrations. The build packages upward migrations only. `npm run db:generate` should report no drift.
3. Configure the scheduled worker from `wrangler.prospecting.jsonc` with the environment's actual D1 ID/name. Validate with `wrangler deploy --dry-run --config <environment-config>`. Deploy the web app through its existing Sites workflow and the scheduled worker through Wrangler in an approved rollout window.
4. For local work, use the ignored repository-root `.dev.vars` file. For staging/production, set provider secrets only on the scheduled worker using interactive `wrangler secret put <NAME> --config <environment-config>`. Names: `GOOGLE_PLACES_API_KEY`, `PAGESPEED_API_KEY`, `BUILTWITH_API_KEY`, `HUNTER_API_KEY`. Hunter also requires `PROSPECTING_CONTACT_ENCRYPTION_KEY`: a base64 encoding of 32 cryptographically random bytes. Never add provider secrets to the web worker, browser, checked-in config, shell command arguments, or logs.
5. Generate worker binding types after configuration changes. The checked-in bindings were generated with Wrangler 4.92.0; secret declarations are separately augmented. The application type check uses the installed Workers types rather than an unverified package upgrade.

## Enablement

Each operation requires all three gates: the server-fixed tenant `hidaca` in `PROSPECTING_TENANT_ALLOWLIST`, a runtime flag exactly `"true"`, and the corresponding tenant policy switch. Set matching runtime values on **both** the web and scheduled workers:

| Variable | Purpose |
| --- | --- |
| `PROSPECTING_DISCOVERY_ENABLED` | Google search |
| `PROSPECTING_ENRICHMENT_ENABLED` | Enrichment jobs |
| `PROSPECTING_SCORING_ENABLED` | Score calculation |
| `PROSPECTING_AUDIT_ENABLED` | Evidence-based audits; also needs scoring |
| `PROSPECTING_CRM_ENABLED` | Preview/conversion and each CRM write step |
| `PROSPECTING_DISABLED_PROVIDERS` | Comma-separated kill switches: `google_places,pagespeed,builtwith,hunter` |

Administrators configure stored policy in the UI or `PUT /v1/prospecting-settings`. The API exposes stored and effective policy separately so a stored checkbox cannot conceal a runtime kill switch. Viewers can read; operators/admins can enqueue and convert. Settings, metrics, contact erasure, and dead-letter replay require admin. The worker rechecks the initiating staff account is still active before each operation. Arbitrary tenant headers/JSON do not select another CRM tenant.

## Provider release gates and storage

Google discovery is Place-ID-first. `pi_prospects.place_id`, the identity aliases, and the generated source relationship are durable; `pi_prospects.facts` is reduced to the Place ID and `crm_facts` is reserved for user-owned or derived CRM data. Normalized Google listing fields are held in `pi_place_context` for the provider TTL (currently 24 hours), rehydrated only while fresh, excluded after expiry, and removed by scheduled-worker cleanup or the next Google provider write. Immutable Google evidence rows retain provenance and derived score links without embedding the listing payload. A stale prospect keeps its Place ID and durable scores/audits/enrichment/conversion records, but the UI must refresh Google context before using listing details again. See [the field-level audit](./google-storage-audit.md).

This storage model is an implementation control, not a substitute for the applicable Google agreement. Before enabling live discovery, review [Google's Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), attribution, public terms/privacy requirements, and any applicable EEA conditions. Keep provider-owned raw fields, temporary normalized context, user-owned CRM facts, and derived intelligence separate. Conversion copies are created only after the operator reviews and confirms the CRM preview.

Google requests have explicit field masks. Text Search accepts arbitrary business queries, with circular bias followed by local radius filtering; Nearby Search uses supported Table A types and a circle restriction. `general_contractor` is response-only Table B and is intentionally not sent as a Nearby filter. Pagination preserves search parameters. Source attribution and Maps links remain visible.

PageSpeed inspects a public URL; BuiltWith requests technology evidence; Hunter requests domain contact evidence only when `contactAllowed`, a nonempty `contactPolicyReference`, provider/feature gates, and the encryption key are configured. Confirm each provider plan, permitted use, quotas, and retention terms before sandbox smoke testing. Quota counters are **attempt units, not dollars**: one outbound provider operation reserves one unit against both tenant and provider limits. Provider pricing and SKU charges may differ. Review actual provider dashboards during smoke tests.

Provider URLs are fixed allowlisted API endpoints, with bounded JSON responses and timeouts. Business domains undergo URL and public DNS checks. API redirects are rejected. The worker never directly crawls a business website; a provider's own crawl and redirects are governed by that provider. Raw provider response bodies, credentials, and personal contact details are not logged or returned through product APIs.

Contact details are AES-GCM encrypted with tenant/snapshot authenticated data, retained for at most seven days (or the shorter configured retention), and removable immediately with the admin contact-data endpoint. Expiration cleanup continues while all feature flags are off. Contact counts and verification summaries remain in immutable evidence; individual emails/names are never rendered or automatically copied into CRM. Events expire after `retentionDays`; evidence and export history remain until a separately reviewed retention/migration operation. `retentionDays` does **not** promise deletion of every prospect/source record.

## Scores and evidence

`digital-health-opportunity/1.0.0` is a deterministic rule set, not predicted buying intent. Digital Health defaults to performance 30%, accessibility 20%, SEO 20%, technical trust 15%, technology 15%. Technical trust measures HTTPS and mobile viewport only; conversion paths are unassessed. Technology detects known Adobe Flash weakness; other technology freshness remains unknown rather than receiving an invented positive score.

Opportunity weights are need 35%, configured business/service-area fit 25%, reachability 20%, source retrieval recency 10%, and data confidence 10%. Need is the inverse of supported Digital Health. Reachability uses verified contact evidence, listed phone, or website; source recency is not intent. Missing dimensions remain unknown and lower coverage. Scores below configured minimum coverage are suppressed. Snapshot IDs, formula/config versions, weights, evidence IDs, and calculation time permit reproduction. Expired inputs or changed score configuration mark existing scores stale; history is never rewritten.

## CRM mapping and recovery

The target is this application's native D1 CRM: Company → `businesses`, Contact → `contacts`, Opportunity → `opportunities`, Pipeline → existing `evaluation` stage. A general business contact uses the reviewed name and listing phone; Hunter private emails are not exported. Stable external links match first, followed by normalized domain/phone/address signals. Name-only matches require explicit review. All candidates are tenant-bound; the adapter refuses tenants other than `hidaca` because the legacy CRM itself is single tenant.

Preview and confirm are separate requests. The server rechecks the fingerprint and conflicts before writing. Durable operations run company, contact, opportunity, pipeline in order. Completed steps and deterministic IDs survive retry; successful entities are never deleted as compensation. Failed/partial exports can be re-previewed and submitted through `/prospect-selections/repair` with a new reviewed request key. Repair cannot replace an already completed company/contact/opportunity mapping.

For failed jobs, repair the underlying cause before retrying. Only transient timeout/rate-limit/unavailable failures retry automatically with jitter; final attempts enter dead letter. Admin replay uses the existing job retry endpoint. Failed enrichments create a new immutable evidence attempt. Audit retry updates its failed status to the resulting evidence-linked audit. Expired leases are fenced so another worker can resume; acknowledged evidence prevents duplicate provider calls after interrupted completion. There is no guarantee a provider call cannot repeat if the process dies after the upstream call but before persisting its result; the durable budget reservation accounts for attempts.

Bulk requests deduplicate selection and share the single-prospect path. Maximum batch size is 50, queue capacity defaults to 300, tenant concurrency to 3, provider concurrency to 2. Cancellation stops owned queued/retrying work, preserves in-flight work, and does not cancel jobs shared with another active batch. A replay of the same bulk key resumes its recorded batch.

## Monitoring, rollout, rollback

The admin dashboard and `/v1/prospecting-metrics` expose provider outcomes/latency, daily budgets, queue states, latest evidence freshness, score coverage, and CRM export outcomes. Alerts identify any dead letter/export failure, queue age over 15 minutes, budget use at 80%, provider failures at 20% over at least five events, stale evidence at 50%, and low score coverage. Alerts are displayed in the product; no external notification channel is configured. Worker structured events carry request/trace, tenant, job, prospect, provider, operation, retry, latency, and outcome without secrets.

After synthetic verification, enable one internal staging tenant with a small daily/provider budget. Verify one attributed search, one enrichment per allowed provider, partial failure handling, one audit, and a repeated conversion yielding one CRM set. Inspect provider dashboards and encrypted-contact deletion. Browser desktop/mobile/keyboard checks and live provider sandbox smoke are separate release gates; see release proof for actual status.

Rollback is flag-first: disable CRM on both workers, then enrichment/audit/scoring, then discovery if necessary. Disable individual providers immediately if they fail or exceed expected usage. Allow existing leases to finish or expire, and inspect jobs/exports for partial outcomes. Do not delete snapshots, exports, or CRM records. The down migration is only for empty/local installation testing; it is destructive and not a production rollback procedure. Re-enable only after repairing the cause and replaying a bounded job under an admin account.

## Contract references checked during implementation

- [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText), [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchNearby), [types](https://developers.google.com/maps/documentation/places/web-service/place-types).
- [PageSpeed v5](https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed).
- [BuiltWith Domain API v23](https://api.builtwith.com/domain-api), [error codes](https://api.builtwith.com/errorCodes).
- [Hunter API v2](https://hunter.io/api-documentation/v2).
- [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
