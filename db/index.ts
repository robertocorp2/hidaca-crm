import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.",
    );
  }
  return env.DB;
}

export function getFiles() {
  if (!env.FILES) {
    throw new Error(
      "Cloudflare R2 binding `FILES` is unavailable. Set the `r2` field in .openai/hosting.json to `FILES` or inject the configured bucket binding.",
    );
  }
  return env.FILES;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
