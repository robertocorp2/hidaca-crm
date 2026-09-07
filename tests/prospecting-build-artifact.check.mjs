import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

test("production artifact includes prospecting routes and migration with runtime-only flags", async () => {
  const worker = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.match(worker, /route:\/app\/prospecting/);
  assert.ok(worker.includes("route:/v1/:path+"));
  assert.ok(worker.includes('pattern: "/v1/:path+"'));
  for (const key of Object.keys(config.vars ?? {})) assert.ok(!key.startsWith("PROSPECTING_"), `Static feature configuration: ${key}`);
  for (const secret of ["GOOGLE_PLACES_API_KEY", "PAGESPEED_API_KEY", "BUILTWITH_API_KEY", "HUNTER_API_KEY"]) assert.ok(!worker.includes(secret), `Web worker must not read ${secret}`);
  await access(new URL("../dist/.openai/drizzle/0015_prospecting_intelligence.sql", import.meta.url));
  await assert.rejects(access(new URL("../dist/.openai/drizzle/rollback", import.meta.url)));
});
