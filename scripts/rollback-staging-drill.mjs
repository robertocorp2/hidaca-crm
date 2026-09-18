import { pathToFileURL } from "node:url";

const PRODUCTION_HOST = "hidaca-constructora-app.robertocorp2.chatgpt.site";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 250;

export class DrillFailure extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DrillFailure";
    this.details = details;
  }
}

export function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DrillFailure("--base-url must be an absolute URL");
  }
  const local = new Set(["localhost", "127.0.0.1", "::1"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local.has(url.hostname))) {
    throw new DrillFailure("The rollback drill only allows HTTPS staging URLs or local test servers");
  }
  if (url.hostname.toLowerCase() === PRODUCTION_HOST) {
    throw new DrillFailure("Production is not an allowed target for the rollback staging drill");
  }
  return url;
}

export function validateReconciliation(reconciliation) {
  const r2 = reconciliation?.r2;
  const postSnapshot = reconciliation?.d1?.postSnapshot;
  const postSnapshotRows = Object.values(postSnapshot ?? {});
  const failures = [];
  if (r2?.inventoryComplete !== true) failures.push("R2 inventory is incomplete");
  if ((r2?.missingReferencedObjects ?? []).length) failures.push("R2 references are missing");
  if ((r2?.orphanedObjects ?? []).length) failures.push("R2 contains unexpected orphaned objects");
  if ((r2?.postSnapshotObjects ?? []).length) failures.push("R2 contains post-snapshot objects");
  if (postSnapshotRows.some((entry) => Number(entry?.count ?? 0) !== 0 || (entry?.sample ?? []).length)) {
    failures.push("D1 contains post-snapshot rows");
  }
  if (failures.length) throw new DrillFailure("Rollback reconciliation is not clean; maintenance remains closed", { failures, reconciliation });
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function requestJson(fetchImpl, baseUrl, pathname, options = {}) {
  const response = await fetchImpl(joinUrl(baseUrl, pathname), {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: "Non-JSON response" };
  }
  if (!response.ok) throw new DrillFailure(`${options.method ?? "GET"} ${pathname} failed with HTTP ${response.status}`, { status: response.status, body });
  return body;
}

function authHeaders(authEmail, fullName) {
  return {
    "oai-authenticated-user-email": authEmail,
    ...(fullName ? {
      "oai-authenticated-user-full-name": encodeURIComponent(fullName),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    } : {}),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDrill({
  baseUrl,
  authEmail,
  fullName,
  snapshotAt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  const target = validateBaseUrl(baseUrl);
  if (!authEmail?.trim()) throw new DrillFailure("HIDACA_STAGING_AUTH_EMAIL or --auth-email is required");
  if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt))) throw new DrillFailure("--snapshot-at must be a valid RFC3339 timestamp");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) throw new DrillFailure("--timeout-ms must be between 0 and 60000");
  if (!Number.isFinite(pollMs) || pollMs < 0) throw new DrillFailure("--poll-ms must be zero or greater");

  const headers = authHeaders(authEmail.trim(), fullName?.trim());
  const evidence = { startedAt: now(), baseUrl: target.origin, snapshotAt: new Date(snapshotAt).toISOString() };
  const initial = await requestJson(fetchImpl, target, "/api/maintenance", { headers });
  evidence.initial = initial;
  if (initial.mode !== "open") throw new DrillFailure("Staging is already in maintenance; refusing to take ownership of the barrier", { initial });

  const entered = await requestJson(fetchImpl, target, "/api/maintenance/enter", {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "controlled staging rollback drill", timeoutMs }),
  });
  evidence.entered = entered;

  const drainDeadline = Date.now() + timeoutMs;
  let drained = entered;
  while (drained.activeWriterCount !== 0) {
    if (Date.now() >= drainDeadline) throw new DrillFailure("Staging writers did not drain before the drill deadline", { drained });
    await sleep(pollMs);
    drained = await requestJson(fetchImpl, target, "/api/maintenance", { headers });
  }
  evidence.drained = drained;

  const reconciliation = await requestJson(fetchImpl, target, `/api/maintenance/reconciliation?snapshotAt=${encodeURIComponent(evidence.snapshotAt)}`, { headers });
  evidence.reconciliation = reconciliation;
  validateReconciliation(reconciliation);

  const reopened = await requestJson(fetchImpl, target, "/api/maintenance/reopen", { method: "POST", headers });
  evidence.reopened = reopened;
  if (reopened.mode !== "open" || Number(reopened.activeWriterCount) !== 0) {
    throw new DrillFailure("Staging did not reopen cleanly after reconciliation", { reopened });
  }
  evidence.finishedAt = now();
  evidence.outcome = "passed";
  return evidence;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") return { help: true };
    if (!value.startsWith("--")) throw new DrillFailure(`Unknown argument: ${value}`);
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new DrillFailure(`Missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    "Run the authenticated staging write-barrier and reconciliation drill.",
    "",
    "Required: --base-url, --snapshot-at, and HIDACA_STAGING_AUTH_EMAIL or --auth-email.",
    "The target must be HTTPS staging (or localhost for tests); production is rejected.",
    "",
    "Example:",
    "  node scripts/rollback-staging-drill.mjs --base-url https://staging.example --snapshot-at 2026-09-18T18:00:00Z",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const evidence = await runDrill({
    baseUrl: args["base-url"] ?? process.env.HIDACA_STAGING_URL,
    authEmail: args["auth-email"] ?? process.env.HIDACA_STAGING_AUTH_EMAIL,
    fullName: process.env.HIDACA_STAGING_AUTH_FULL_NAME,
    snapshotAt: args["snapshot-at"],
    timeoutMs: args["timeout-ms"] === undefined ? DEFAULT_TIMEOUT_MS : Number(args["timeout-ms"]),
    pollMs: args["poll-ms"] === undefined ? DEFAULT_POLL_MS : Number(args["poll-ms"]),
  });
  const output = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args.output) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.output, output, "utf8");
  }
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const details = error instanceof DrillFailure ? error.details : {};
    console.error(JSON.stringify({ outcome: "failed", error: error instanceof Error ? error.message : String(error), ...details }, null, 2));
    process.exitCode = 1;
  });
}
