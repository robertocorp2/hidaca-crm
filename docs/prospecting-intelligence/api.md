# Prospecting API v1

All endpoints use existing staff authentication and the server-resolved `hidaca` tenant. JSON requests are limited to 64 KiB. Writes reject a supplied foreign Origin. Responses use `Cache-Control: no-store` and `X-Request-Id`.

Success: `{ "apiVersion": "v1", "requestId": "…", "data": { … } }`.
Failure: `{ "apiVersion": "v1", "requestId": "…", "error": { "code": "conflict", "message": "…", "retryable": false } }`.

Typed errors: `invalid_request` (400), `unauthorized` (401), `forbidden`/`policy_blocked` (403), `not_found` (404), `conflict` (409), `unsupported` (422), `budget_exhausted`/`rate_limited` (429), `timeout` (504), `unavailable` (503), `unknown` (500). Only timeout, rate limit, and unavailable are automatically retryable. A `Retry-After` header is supplied when available. Async writes return 202, including deduplicated acknowledgements; inspect the returned state rather than assuming new work.

| Method/path (under `/v1`) | Request and result |
| --- | --- |
| GET `/prospecting-capabilities` | Effective tenant policy |
| GET/PUT `/prospecting-settings` | Admin: stored/effective policy; PUT replaces validated policy and versions scoring config |
| GET `/prospecting-metrics` | Admin: budgets, outcomes, freshness, coverage, exports, alerts |
| POST `/prospect-searches` | SearchInput below; returns search ID/job ID or fresh cached result |
| GET `/prospect-searches/:id` | Status, normalized prospects, attribution, next page token, jobs |
| GET `/prospects?cursor=&limit=20` | Stable ID cursor; max 50; returns `nextCursor` |
| GET `/prospects?ids=id1,id2` | Up to 50 explicit same-tenant summaries for progress polling |
| GET `/prospects/:id` | Facts, score/history, stale flags, evidence, findings, jobs, CRM operations |
| POST `/prospects/:id/enrichment` | `{idempotencyKey,providers?:["pagespeed","builtwith","hunter"]}` |
| POST `/prospects/:id/audits` | Same input; queues enrichment dependencies plus evidence audit |
| DELETE `/prospects/:id/contact-data` | Admin: erase encrypted contact details; retain nonpersonal evidence history |
| POST `/prospect-selections/preview` | `{items:[{prospectId,companyId?,contactId?,contactName,opportunityTitle,reviewed?}]}`; mappings, matches, conflicts, missing fields, fingerprint |
| POST `/prospect-selections/convert` | `{confirmed:true,idempotencyKey,items:[{...mapping,fingerprint}]}`; durable jobs/outcomes |
| POST `/prospect-selections/repair` | Same form, newly reviewed mapping/key; preserves successful CRM operations |
| POST `/prospect-selections/bulk` | `{operation:"enrich"|"audit",prospectIds:[...],idempotencyKey}`; maximum configured 50 |
| GET `/prospect-selections/:id` | Aggregate counts and independent per-item jobs |
| POST `/prospect-selections/:id/cancel` | Cancels owned work not yet started |
| GET `/jobs/:id` | Public state, attempts, error, nextRun, result |
| POST `/jobs/:id/retry` | Explicit retry after repair; admin required for dead letter |

Example search body (coordinates in degrees; radius in meters):

```json
{
  "mode": "nearby",
  "query": "",
  "type": "roofing_contractor",
  "latitude": 18.4861,
  "longitude": -69.9312,
  "radius": 5000,
  "locale": "es",
  "pageSize": 20,
  "pageToken": "",
  "minRating": null
}
```

Use `mode:"text"` and a nonempty query for arbitrary categories, including general contractors. Nearby types are intentionally bounded to verified supported types. For the next Text Search page, resend the same fields with `nextPageToken` as `pageToken`.

Idempotency keys are body fields, scoped by tenant and operation. Reusing a key with changed input returns conflict. Use one key for retries of the same request and a new key for an intentionally changed request. Search deduplication instead uses its normalized input/freshness key. Job statuses are `queued`, `running`, `retrying`, `completed`, `failed`, `dead_letter`, `cancelled`; evidence statuses are `complete`, `partial`, `missing`, `failed`, `policy_blocked`. Staleness is derived separately and never relabels missing evidence as success.

The authoritative provider-independent TypeScript contract is `app/lib/prospecting/contracts.ts`; endpoint dispatch/HTTP mapping is `app/lib/prospecting/api.ts`. No provider SDK response is a public API schema. Poll active work with backoff (the UI uses 2.5 seconds); do not poll terminal states indefinitely.
