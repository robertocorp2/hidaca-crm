import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL("../dist/server/index.js", import.meta.url);
const workerConfigUrl = new URL("../dist/server/wrangler.json", import.meta.url);
const routeManifestUrl = new URL(
  "../dist/.openai/invoice-dry-run-route-manifest.json",
  import.meta.url,
);

test("production worker artifact registers the invoice dry-run route without static feature defaults", async () => {
  const [worker, workerConfig, routeManifest] = await Promise.all([
    readFile(artifactUrl, "utf8"),
    readFile(workerConfigUrl, "utf8"),
    readFile(routeManifestUrl, "utf8"),
  ]);
  const config = JSON.parse(workerConfig);
  const manifest = JSON.parse(routeManifest);

  assert.match(worker, /route:\/api\/imports\/invoices\/dry-run/);
  assert.match(worker, /pattern:\s*"\/api\/imports\/invoices\/dry-run"/);
  assert.equal(
    Object.hasOwn(config.vars ?? {}, "INVOICE_IMPORT_PHASE1_ENABLED"),
    false,
  );
  assert.equal(
    Object.hasOwn(config.vars ?? {}, "INVOICE_PRODUCTION_IMPORT_ENABLED"),
    false,
  );
  assert.deepEqual(manifest, {
    route: "/api/imports/invoices/dry-run",
    method: "POST",
    handler: "app/api/imports/invoices/dry-run/route.ts",
    workerArtifact: "dist/server/index.js",
    workerArtifactSha256: manifest.workerArtifactSha256,
    routeRegistered: true,
    runtimeFeatureFlags: {
      INVOICE_IMPORT_PHASE1_ENABLED: "Sites runtime environment only",
      INVOICE_PRODUCTION_IMPORT_ENABLED: "Sites runtime environment only",
    },
  });
  assert.match(manifest.workerArtifactSha256, /^[a-f0-9]{64}$/);
});
