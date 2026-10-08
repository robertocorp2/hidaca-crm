import { pathToFileURL } from "node:url";

const PRODUCTION_HOST = "hidaca-constructora-app.robertocorp2.chatgpt.site";
const LOCAL_TEST_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const VERIFIED_STAGING_HOSTS = new Set();
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
  // Absolute DNS names with trailing dots still identify the same host.
  if (url.hostname.toLowerCase().replace(/\.+$/, "") === PRODUCTION_HOST) {
    throw new DrillFailure("Production is not an allowed target for the rollback staging drill");
  }
  if (url.username || url.password || url.search || url.hash) throw new DrillFailure("The rollback drill base URL cannot contain credentials, query, or fragment data");
  const localTestTarget = url.protocol === "http:" && LOCAL_TEST_HOSTS.has(url.hostname);
  const verifiedStagingTarget = url.protocol === "https:" && VERIFIED_STAGING_HOSTS.has(url.hostname.toLowerCase().replace(/\.+$/, ""));
  if (!localTestTarget && !verifiedStagingTarget) {
    throw new DrillFailure("The rollback drill is local-test-only until a staging hostname is explicitly verified and allowlisted");
  }
  return url;
}

export function validateReconciliation(reconciliation) {
  const r2 = reconciliation?.r2;
  const postSnapshot = reconciliation?.d1?.postSnapshot;
  const requiredPostSnapshot = ["documents", "importFiles", "ecfArtifacts", "ecfInboundMessages", "voiceRecordings", "whatsappMessages", "whatsappWebhookEvents", "whatsappCampaignRecipients", "whatsappCampaignDeliveryAttempts", "prospectingJobs", "auditLog"];
  const maintenanceEntryAudit = reconciliation?.d1?.maintenanceEntryAudit;
  const untrackedInboundMessages = reconciliation?.d1?.untrackedInboundMessages;
  const unresolvedWriters = reconciliation?.d1?.unresolvedWriters;
  const failures = [];
  if (r2?.inventoryComplete !== true) failures.push("R2 inventory is incomplete");
  if (r2?.maintenanceAuthority?.present !== true || r2?.maintenanceAuthority?.mode !== "maintenance") failures.push("R2 maintenance authority is missing or not closed");
  if (!Array.isArray(r2?.missingReferencedObjects) || !Array.isArray(r2?.orphanedObjects) || !Array.isArray(r2?.postSnapshotObjects)) failures.push("R2 reconciliation evidence is incomplete");
  if (!postSnapshot || requiredPostSnapshot.some((name) => !Number.isInteger(postSnapshot[name]?.count) || postSnapshot[name].count !== 0 || !Array.isArray(postSnapshot[name].sample) || postSnapshot[name].sample.length !== 0)) failures.push("D1 post-snapshot evidence is incomplete or contains rows");
  if ((r2?.missingReferencedObjects ?? []).length) failures.push("R2 references are missing");
  if ((r2?.orphanedObjects ?? []).length) failures.push("R2 contains unexpected orphaned objects");
  if ((r2?.postSnapshotObjects ?? []).length) failures.push("R2 contains post-snapshot objects");
  if (!Number.isInteger(untrackedInboundMessages?.count) || untrackedInboundMessages.count !== 0 || !Array.isArray(untrackedInboundMessages.sample) || untrackedInboundMessages.sample.length !== 0) failures.push("ECF inbound messages lack durable R2 references");
  if (!unresolvedWriters || ["whatsappWebhooks", "whatsappCampaigns", "prospectingJobs"].some((name) => !Number.isInteger(unresolvedWriters[name]?.count) || unresolvedWriters[name].count !== 0 || !Array.isArray(unresolvedWriters[name].sample) || unresolvedWriters[name].sample.length !== 0)) failures.push("Webhook, campaign, or background writers remain unresolved");
  // A drill taken before restore can retain its own entry audit. Any extra
  // entry is an unexpected control transition and must keep writes closed.
  if (!maintenanceEntryAudit || !Number.isInteger(maintenanceEntryAudit.count)
    || maintenanceEntryAudit.count < 0 || maintenanceEntryAudit.count > 1
    || maintenanceEntryAudit.sample?.length !== maintenanceEntryAudit.count) {
    failures.push("D1 maintenance-entry audit is missing or unexpected");
  }
  if (failures.length) throw new DrillFailure("Rollback reconciliation is not clean; maintenance remains closed", { failures, reconciliation });
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function requestJson(fetchImpl, baseUrl, pathname, options = {}) {
  const response = await fetchImpl(joinUrl(baseUrl, pathname), {
    ...options,
    // Never forward operator headers or maintenance mutations to another target.
    redirect: "error",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDrill({
  baseUrl,
  snapshotAt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  const target = validateBaseUrl(baseUrl);
  if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt))) throw new DrillFailure("--snapshot-at must be a valid RFC3339 timestamp");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) throw new DrillFailure("--timeout-ms must be between 0 and 60000");
  if (!Number.isFinite(pollMs) || pollMs < 0) throw new DrillFailure("--poll-ms must be zero or greater");

  const evidence = { startedAt: now(), baseUrl: target.origin, snapshotAt: new Date(snapshotAt).toISOString() };
  const initial = await requestJson(fetchImpl, target, "/api/maintenance");
  evidence.initial = initial;
  if (initial.mode !== "open") throw new DrillFailure("Staging is already in maintenance; refusing to take ownership of the barrier", { initial });

  const entered = await requestJson(fetchImpl, target, "/api/maintenance/enter", {
    method: "POST",
    body: JSON.stringify({ reason: "controlled staging rollback drill", timeoutMs }),
  });
  evidence.entered = entered;

  const drainDeadline = Date.now() + timeoutMs;
  let drained = entered;
  while (drained.activeWriterCount !== 0) {
    if (Date.now() >= drainDeadline) throw new DrillFailure("Staging writers did not drain before the drill deadline", { drained });
    await sleep(pollMs);
    drained = await requestJson(fetchImpl, target, "/api/maintenance");
  }
  evidence.drained = drained;

  const reconciliation = await requestJson(fetchImpl, target, `/api/maintenance/reconciliation?snapshotAt=${encodeURIComponent(evidence.snapshotAt)}`);
  evidence.reconciliation = reconciliation;
  validateReconciliation(reconciliation);

  const reopened = await requestJson(fetchImpl, target, "/api/maintenance/reopen", { method: "POST" });
  evidence.reopened = reopened;
  if (reopened.mode !== "open" || Number(reopened.activeWriterCount) !== 0) {
    throw new DrillFailure("Staging did not reopen cleanly after reconciliation", { reopened });
  }
  evidence.finishedAt = now();
  evidence.outcome = "passed";
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("This harness is test-only and does not authenticate operators. Run the real staging drill through an authenticated browser session.");
  process.exitCode = 2;
}
