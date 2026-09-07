# Prospecting Intelligence release proof

Implementation: branch `codex/prospecting-intelligence`, based on `docs/prospecting-intelligence-plan`. Status: implemented and synthetically verified behind disabled flags; **browser and live-provider release verification remain open**. Nothing has been deployed or enabled in production.

## Acceptance evidence

| Plan task | Implementation | Verification |
| --- | --- | --- |
| 1. Contracts/persistence | `contracts.ts`, `domain.ts`, `repository.ts`, migration 0015, Drizzle schema/snapshot | Deterministic identity, duplicate canonicalization, tenant foreign keys, immutable evidence/scores, empty-install down migration; schema generation reports no drift |
| 2. Jobs/budgets | D1 queue, fenced leases, backoff, circuits, atomic budget reservations, structured events | Concurrent enqueue, lease expiry/renewal, final-attempt reconciliation, timeout/429/credential fixtures, provider and tenant caps, interrupted acknowledgement |
| 3. Discovery | Google Places Text/Nearby adapters and cached search service | Explicit masks, pagination, radius, partial/empty results, typed errors, cached identity, tenant isolation; live sandbox attribution check still open |
| 4. Enrichment | PageSpeed, BuiltWith, Hunter, optional-provider port, separate worker | Current-schema fixtures, public DNS/URL checks, redirects denied, bounded JSON, timeout, partial provider failure, AES-GCM tenant binding and erasure |
| 5. Scoring | Pure versioned Digital Health/Opportunity rules | Reproducibility, unknowns, low coverage suppression, configuration, range properties, stale evidence; trust/technology limits explicitly documented |
| 6. UI/API | Spanish search/results/detail/evidence/audits/settings and authenticated `/v1` route | API authorization/state tests, type check, production route artifact checks; browser layout, keyboard, and interaction proof pending |
| 7. CRM | Native HIDACA port, preview, fingerprint, durable company/contact/opportunity/pipeline operations | Repeated conversion creates one CRM set, normalized dedup, partial recovery, reviewed mapping repair, repaired outbox replay, tenant isolation |
| 8. Bulk | Selection, bounded enrichment/audit, per-item outcomes, cancellation | Maximum 50 prospects/200 jobs, mixed outcomes, concurrent queue capacity, duplicate requests, cancellation and budget fixtures |
| 9. Release controls | Admin metrics/alerts, provider/runtime gates, allowlist, runbook | Full automated suite, real workerd D1 workflow, worker dry run; live-provider cost/retention and browser gates remain open |

All source paths in the table except schema/migration live under `app/lib/prospecting`; UI lives under `app/app/prospecting`, scheduled entrypoint under `worker/prospecting.ts`. See [API](./api.md) and [runbook](./runbook.md).

## Reproduce

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run db:generate
npm run build:prospecting
```

`npm test` runs all repository unit/integration tests, the production vinext build, and route/migration artifact checks. `npm run test:prospecting` isolates the feature's domain, provider, integration, load, and Miniflare D1 suites. The D1 suite uses the real workerd D1 binding with all migrations and synthetic provider ports; it is not merely a SQLite mock.

The maximum-batch synthetic measurement processed 50 prospects and 200 independent jobs in bounded ten-job ticks (21 ticks including the final empty check), with 150 complete and 50 explicitly policy-blocked outcomes. Local SQLite/fixture processing was approximately 0.86 seconds in the measured run. This excludes provider/network latency and is not a production throughput claim. The standalone dry-run bundle measured approximately 101 KiB uncompressed/24 KiB gzip.

Independent review identified and prompted regression fixes for formatted legacy CRM matches, export mapping repair, exhausted abandoned search state, stale scores, repair enqueue interruption, search retry progress, and conflicting old audit retry. Failed audit recovery also has a regression. The final independent code review approved the changes after the 28 integration/load checks passed. The final full automated run passed 132 tests. Type checking, lint, production build, and both artifact checks passed. Wrangler startup profiling also completed locally; it does not establish production startup latency. Release approval remains contingent on the gates below.

## Open release gates

1. **Browser verification:** Chrome DevTools MCP required by the applied `browser-verify` skill was unavailable. Permission to use available browser tools/Playwright was requested; no browser result is claimed. Required checks: desktop/mobile, keyboard bulk selection, empty/loading/partial/stale/denied/failed states, evidence links, retry progress, and console/network errors.
2. **Live sandbox providers:** No provider credentials or paid calls were used. Confirm applicable storage/use rights first, configure staging-only secrets and a small budget, then run the documented search â†’ enrichment â†’ audit â†’ repeated conversion smoke test while inspecting provider cost dashboards.
3. **Google storage policy:** Immutable normalized Google listing persistence is an explicit deployment constraint. A cache TTL does not establish permitted storage. Do not enable live discovery without permission under the applicable agreement or a revised storage design.

Production-wide enablement remains outside the plan's implementation scope. Rollback is flag-first and preserves evidence/CRM history. Destructive down migration is tested only against an empty local installation.
