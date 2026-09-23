# Rollback write barrier and reconciliation

**Status:** Implemented in P1 #10 branch; production rollout remains a separate operator decision.

## Summary

HIDACA's rollback runbook currently relies on redeploying an older Sites
version to stop writes. That does not quiesce already-running requests,
anonymous WhatsApp deliveries, scheduled workers, or R2 uploads. A database
restore can therefore race with writes that are not represented by the
restored D1 snapshot.

The implementation is a D1-backed, fail-closed maintenance barrier with a
short-lived operator lease. Every mutation and external-write entry path checks
the same barrier before its first side effect and renews the lease around long
operations. An admin status endpoint reports active leases. The rollback
runbook captures a snapshot, enters maintenance, waits for a bounded drain,
restores only after the drain proof is recorded, reconciles D1 and R2, and
reopens traffic only after the reconciliation gates pass.

## Context and scope

The application uses a shared D1 database (`DB`) and private R2 bucket
(`FILES`). Most authenticated mutations are Next-style route handlers under
`app/api`; WhatsApp webhooks are an anonymous provider callback; the ECF
gateway and prospecting worker are independent write paths. Documents,
imports, AI voice, WhatsApp media, and ECF artifacts write R2 as well as D1.

This design covers the shared barrier contract, operator visibility, route and
worker integration, rollback ordering, and D1/R2 reconciliation. It does not
perform a production rollback, redesign Cloudflare deployment, or define data
retention policy.

The current HIDACA deployment is single-tenant, so the barrier is scoped to the
shared D1/R2 environment. Existing admin authorization controls all operator
endpoints. The Sites Worker is the universal browser/API mutation entry point;
the ECF gateway and prospecting cron are separately leased because they run as
independent Workers.

## Goals

- Reject new mutations and webhook deliveries once maintenance begins.
- Prevent in-flight writers from starting another D1 or R2 side effect after
  their lease expires or maintenance is activated.
- Let operators prove that active writer leases and queued retry work have
  drained before a restore.
- Identify orphaned R2 objects, missing objects, and D1 rows written after
  the selected snapshot.
- Provide an executable staging drill with concurrent browser, webhook,
  scheduled, and blob operations.
- Keep read-only health, reconciliation, and operator status available while
  business writes are blocked.

## Non-goals

- Automatically restoring production data.
- Deleting or garbage-collecting R2 objects during reconciliation.
- Treating a deployment rollback as a substitute for the barrier.
- Making arbitrary third-party provider requests transactional with D1.

## Constraints

- D1 is the source of truth for barrier state; an environment variable alone
  cannot be changed atomically across Sites, webhook, and worker runtimes.
- R2 has no transaction with D1. Reconciliation must be explicit and
  evidence-producing rather than pretending the stores are atomic.
- A barrier check is a gate, not a lock. Long operations need a renewable
  lease and must check it before each externally visible side effect.
- Existing clients should receive a stable `503` response with
  `Retry-After` during maintenance; provider webhooks must retain a retryable
  failure response rather than acknowledge the event.
- The first implementation must be additive and independently deployable;
  rollback SQL remains excluded from the Sites migration bundle.

## Proposed design

### Barrier state and leases

Add an additive D1 migration with two small tables:

- `maintenance_state`: singleton row containing `mode` (`open` or
  `maintenance`), generation, reason, operator, activated/updated timestamps,
  and optional restore bookmark.
- `write_leases`: lease id, barrier generation, writer kind, request/job id,
  started/renewed/expired timestamps, and terminal outcome.

`app/lib/write-barrier.ts` owns the contract. `assertWritesOpen` reads the
state and returns a typed `MAINTENANCE_MODE` error. `acquireWriteLease` uses a
single D1 conditional insert/update to bind a writer to the current
generation. `renewWriteLease` is required before every D1/R2 side effect in a
long operation. `releaseWriteLease` is best effort, while the drain query
counts only unexpired leases so a crashed request cannot block recovery
forever.

The state transition to maintenance increments the generation. This fences
leases acquired before the transition even if they have not yet reached their
TTL. The barrier fails closed if the state row cannot be read. Read-only
routes, the operator status endpoint, and reconciliation queries do not need a
write lease.

### Entry-point integration

The Sites Worker entry point wraps every `POST`, `PUT`, `PATCH`, and `DELETE`
request before dispatching to the individual route handlers. This covers all
70 current mutation handlers, `/v1` mutations, and the browser-facing
WhatsApp webhook. The wrapper acquires a lease before parsing or writing the
request and releases it in `finally`.

Explicit integrations are required for paths that are not ordinary browser
mutations:

- `app/api/whatsapp/webhook/route.ts` checks the barrier before claiming an
  event and returns retryable `503` when closed.
- WhatsApp campaign dispatch and status callbacks use the same lease around
  provider calls and D1 updates.
- `worker/ecf-gateway.ts` checks before R2 and D1 writes.
- The prospecting scheduled worker checks before each claimed job and renews
  around provider and CRM writes.
- AI voice, document, ECF artifact, import, invoice-replacement, and WhatsApp
  media paths inherit the request lease. The ECF gateway explicitly renews its
  lease before the R2 put and before the corresponding D1 mutation; the shared
  helper renews long-lived leases while a request or scheduled tick remains in
  progress.

The response contract is `503 Service Unavailable`, JSON error code
`MAINTENANCE_MODE`, and `Retry-After: 60` for browser/API callers. The
WhatsApp callback uses the provider's retryable non-2xx semantics and never
marks a delivery processed while the barrier is closed.

### Operator lifecycle

Add admin-only endpoints (or an equivalent authenticated operator command) for

1. `GET /api/maintenance`: state, generation, reason, activation time,
   active lease count grouped by writer kind, oldest lease, and queued retry
   counts.
2. `POST /api/maintenance/enter`: atomically activate maintenance and return
   the generation and drain deadline.
3. `POST /api/maintenance/reopen`: admin-only generation advance back to
   `open`; the runbook requires the operator to retain and review the
   reconciliation response before calling it.

Entering maintenance is idempotent. The status response and reconciliation
report do not expose secrets or business payloads. The reopen endpoint does not
pretend to make an external reconciliation artifact transactional; the
runbook's abort gates remain mandatory.

The drain command polls until active leases are zero or a configured timeout
(recommended five minutes) expires. On timeout it returns the blocking lease
ids/kinds, leaves maintenance active, and instructs the operator to abort the
restore. It never force-deletes leases.

### Reconciliation contract

Before reopening, retain the read-only JSON response from
`/api/maintenance/reconciliation` with the target snapshot timestamp, barrier
generation, source commit/version, and query results. The endpoint does not
write a pretend-transactional evidence record; the runbook treats the saved
response and R2 manifest hash as the operator evidence. Checks produce counts
plus bounded example keys.

D1 checks include:

- rows in each side-effect table whose `created_at`/`updated_at` is after the
  snapshot cutoff;
- webhook/campaign/import jobs still `processing` or `sending`;
- foreign-key and required-reference violations;
- duplicate idempotency keys and delivery tokens.

R2 checks include:

- D1 document/voice/ECF/WhatsApp media keys missing from R2;
- R2 keys with no corresponding D1 row (orphan candidates);
- object metadata/content-type mismatches where recorded;
- objects whose last-modified time is after the snapshot cutoff.

The R2 scan is paginated and produces a SHA-256 manifest hash. Candidate
orphans are quarantined in the report, never deleted automatically. If R2
listing is not available in the runtime, the operator must run the equivalent
read-only bucket inventory command and attach its manifest; reopening is blocked
without that evidence.

## Rollback sequence

1. Announce the window and record the current Sites version, commit, D1
   bookmark, R2 manifest start time, and operator.
2. Enter maintenance through the authoritative endpoint; record the returned
   generation and reason.
3. Stop new scheduled invocations and provider retry traffic where the
   provider supports it, while retaining the webhook endpoint so it returns
   retryable responses.
4. Poll the drain status until all leases are expired/released and queued
   writers are zero. If the timeout expires, abort; do not restore.
5. Verify the drain evidence, intended restore timestamp/bookmark, and exact
   application version. Only then run the approved D1 restore.
6. Deploy or select the known-good application version with maintenance still
   active.
7. Run D1 and R2 reconciliation. Abort reopening on missing references,
   post-snapshot writes, unresolved in-flight jobs, missing objects, or an
   unreviewed orphan candidate.
8. Retain the reconciliation JSON and manifest hash with the maintenance
   record, then reopen traffic.
9. Replay bounded provider/webhook/job retries and verify idempotency without
   deleting or rewriting evidence.

## Alternatives considered

- **Environment-variable flag:** easy to deploy but not atomic across runtimes,
  cannot prove drain, and cannot fence already-running requests.
- **Redeploy previous Sites version only:** current behavior; leaves webhook,
  scheduled, and in-flight/R2 writers active.
- **Cloudflare Worker middleware only:** does not cover direct D1/R2 worker
  calls or provide durable operator evidence.
- **Global D1 transaction around the entire request:** D1 cannot hold a
  transaction across provider calls or R2, and long transactions would be
  operationally unsafe.

## Tradeoffs

The D1 read and lease write add small latency to every mutation, and the
operator workflow becomes more explicit. In exchange, the system has a
durable generation fence and evidence that can be audited. R2 remains
eventually reconciled rather than transactionally consistent, so reopening is
conservative and may require manual review of bounded orphan candidates.

## Cross-cutting concerns

- **Security:** maintenance controls require the existing admin permission;
  webhook maintenance state is readable only through the signed provider
  path's behavior, not via a public status endpoint. Validate reason and
  timeout inputs and audit every transition.
- **Reliability:** all leases have TTLs; renewals are conditional on the
  generation; failure to renew stops further side effects.
- **Observability:** log barrier generation, writer kind, lease id, and
  outcome, never request bodies, tokens, or secrets. Alert on drain timeout
  and repeated maintenance rejections.
- **Performance:** keep status queries indexed by state/generation/expiry and
  bound reconciliation examples; paginate R2 listing.
- **Privacy:** reconciliation reports contain object keys and ids only, not
  document contents or provider credentials.

## Rollout and migration

1. Add tables and helper in a backward-compatible migration; default state is
   `open`. **Done in `0025_maintenance_write_barrier`.**
2. Add test coverage for fail-closed reads, generation fencing, lease renewal,
   idempotent enter/reopen, all entry-point classes, response semantics, and
   reconciliation findings. **Done in `tests/write-barrier.test.ts` and the
   Worker dry runs.**
3. Run the controlled concurrent drill in staging before any production
   restore. The repository test provides the deterministic local drill; the
   real staging run remains an operational release gate.
4. Capture drill evidence: browser mutation, webhook, scheduled job, D1
   write, R2 upload, drain timeout/abort, successful reconciliation, and
   bounded replay.
5. No production rollback or restore is part of this issue.

## Resolved implementation decisions

- The current single-tenant HIDACA deployment uses one barrier per shared
  D1/R2 environment.
- Existing admin authorization owns enter/reopen; no new permission module is
  needed for this operational control.
- The Sites Worker, ECF gateway, and prospecting cron are the deployed write
  entry-point classes covered by this change.
- R2 exposes paginated listing through the binding, so the reconciliation
  endpoint produces its own bounded inventory and SHA-256 manifest. A missing
  or truncated inventory remains an abort condition.

## Decision

Adopt the D1-backed generation-fenced barrier, renewable leases, explicit drain
proof, and evidence-gated D1/R2 reconciliation. The implementation is ready
for independent review; production staging evidence and any restore remain
outside this code change.
