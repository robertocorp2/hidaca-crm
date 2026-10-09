# External maintenance authority

`FILES` contains the authoritative object at `__control/maintenance-state.v1.json`. The application D1 `maintenance_state` row is a local mirror and must never be used as the authority for allowing writes. Worker, API, webhook, e-CF gateway, and scheduled prospecting writes check the R2 object before acquiring or renewing a write lease. Missing, malformed, or unreadable authority blocks writes.

The object schema is:

```json
{"schemaVersion":1,"revision":1,"mode":"maintenance","reason":"initial safe rollout","operatorEmail":"operator@example.com","activatedAt":"2026-10-08T00:00:00.000Z","updatedAt":"2026-10-08T00:00:00.000Z"}
```

Do not initialize this object to `open` as part of application startup or restore. Initialization is an operator-controlled rollout gate. Before deploying a build that requires this object:

1. In the existing application, enter maintenance and verify the old barrier reports zero active writers.
2. While the deployment remains paused, create the object in the same private R2 bucket used by every application, gateway, and scheduled worker. Start with `mode: "maintenance"`; set `revision` to a nonnegative integer and include all schema fields.
3. Verify every deployment configuration binds `FILES` to that same bucket, including `wrangler.prospecting.jsonc`.
4. Deploy the application and all write-capable workers. Missing or invalid state is expected to keep writes blocked.
5. Verify maintenance status, writer gates, and a nonproduction restore drill. Only then use the authenticated maintenance reopen control to explicitly set the authority to `open`.

The application updates an existing object with an R2 ETag conditional write. A failed condition is retried from a fresh read; repeated conflicts or R2 errors fail closed. The application deliberately does not create a missing authority object because doing so could silently reopen maintenance after a restore.

Never run the initialization or reopen steps against production as part of a code validation session. A nonproduction restore drill needs a separate bucket and D1 database, verified deployment bindings, and a documented restore procedure.
