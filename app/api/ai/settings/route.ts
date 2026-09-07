import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { aiProviderConfigs, aiRuns, aiSettings, aiUsageEvents } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";
import { createAiProviderRouter, isAiEnabled, isAiProvider, providerAvailability } from "../../../lib/ai";

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {};
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}

async function readSettings() {
  const db = getDb();
  const [settings, configs, runs, usage] = await Promise.all([
    db.select().from(aiSettings).where(eq(aiSettings.id, "global")).limit(1),
    db.select().from(aiProviderConfigs),
    db.select({ provider: aiRuns.provider, status: aiRuns.status, completedAt: aiRuns.completedAt }).from(aiRuns).orderBy(desc(aiRuns.createdAt)).limit(500),
    db.select({ provider: aiUsageEvents.provider, estimatedCost: aiUsageEvents.estimatedCost }).from(aiUsageEvents).limit(1000),
  ]);
  const current = settings[0] ?? { id: "global", enabled: false, defaultProvider: "openai", fallbackEnabled: false, gatewayEnabled: false, toolAccess: "read_only", destructiveActions: false, updatedBy: "", createdAt: "", updatedAt: "" };
  const configMap = new Map(configs.map((config) => [config.provider, config]));
  const providerState: Array<Record<string, unknown>> = providerAvailability(env).map((item) => {
    const config = configMap.get(item.provider);
    const limits = parseJsonObject(config?.limits);
    const successful = runs.find((run) => run.provider === item.provider && run.status === "succeeded");
    const estimatedCost = usage.filter((event) => event.provider === item.provider).reduce((total, event) => total + (event.estimatedCost ?? 0), 0);
    return { ...item, enabled: Boolean(config?.enabled), connectionStatus: item.configured ? (config?.healthStatus ?? "unknown") : "not_configured", chatModel: String(limits.chatModel ?? item.defaultModel), draftingModel: String(limits.draftingModel ?? item.defaultModel), transcriptionModel: String(limits.transcriptionModel ?? ""), usageCount: runs.filter((run) => run.provider === item.provider).length, estimatedCost, lastSuccessfulRequest: successful?.completedAt ?? null };
  });
  const gatewayConfigured = Boolean(env.CF_AI_GATEWAY_TOKEN && env.CF_ACCOUNT_ID && env.CF_AI_GATEWAY_NAME);
  providerState.push({ provider: "gateway", configured: gatewayConfigured, defaultModel: "", gatewayAvailable: gatewayConfigured, transport: "gateway", enabled: Boolean(current.gatewayEnabled), connectionStatus: gatewayConfigured ? "configured" : "not_configured", chatModel: "", draftingModel: "", transcriptionModel: "", usageCount: 0, estimatedCost: 0, lastSuccessfulRequest: null });
  return { settings: { enabled: Boolean(current.enabled), effectiveEnabled: Boolean(current.enabled) && isAiEnabled(env), defaultProvider: current.defaultProvider, fallbackEnabled: Boolean(current.fallbackEnabled), gatewayEnabled: Boolean(current.gatewayEnabled), toolAccess: current.toolAccess, destructiveActions: Boolean(current.destructiveActions) }, providers: providerState };
}

export async function GET() {
  const auth = await authorizeApi({ module: "ai", action: "administer" });
  if (!auth.ok) return auth.response;
  return Response.json(await readSettings(), { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "ai", action: "administer" });
  if (!auth.ok) return auth.response;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  if (payload.action === "test") {
    if (!isAiProvider(payload.provider)) return Response.json({ error: "Proveedor IA inválido." }, { status: 400 });
    const provider = payload.provider;
    if (!providerAvailability(env).find((item) => item.provider === provider)?.configured) return Response.json({ provider, status: "not_configured" });
    if (!isAiEnabled(env)) return Response.json({ provider, status: "blocked_by_feature_flag" });
    try {
      const result = await createAiProviderRouter(env).complete({ provider, model: typeof payload.model === "string" ? payload.model.slice(0, 120) : undefined, messages: [{ role: "user", content: "Responde solamente: HIDACA_OK" }], allowFallback: false, idempotencyKey: crypto.randomUUID() });
      return Response.json({ provider, status: "connected", model: result.model });
    } catch { return Response.json({ provider, status: "error" }, { status: 502 }); }
  }
  const settings = objectValue(payload.settings);
  const defaultProvider = isAiProvider(settings.defaultProvider) ? settings.defaultProvider : "openai";
  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(aiSettings).values({ id: "global", enabled: Boolean(settings.enabled), defaultProvider, fallbackEnabled: Boolean(settings.fallbackEnabled), gatewayEnabled: Boolean(settings.gatewayEnabled), toolAccess: "read_only", destructiveActions: false, updatedBy: auth.user.email, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: aiSettings.id, set: { enabled: Boolean(settings.enabled), defaultProvider, fallbackEnabled: Boolean(settings.fallbackEnabled), gatewayEnabled: Boolean(settings.gatewayEnabled), updatedBy: auth.user.email, updatedAt: now } });
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  for (const value of providers) {
    const item = objectValue(value);
    if (!isAiProvider(item.provider)) continue;
    const provider = item.provider;
    const model = (key: string) => typeof item[key] === "string" ? String(item[key]).slice(0, 120) : "";
    const limits = JSON.stringify({ chatModel: model("chatModel"), draftingModel: model("draftingModel"), transcriptionModel: model("transcriptionModel") });
    await db.insert(aiProviderConfigs).values({ id: crypto.randomUUID(), provider, enabled: Boolean(item.enabled), transport: "direct", defaultModel: model("defaultModel") || model("chatModel"), capabilities: "[]", limits, healthStatus: "unknown", lastHealthAt: null, updatedBy: auth.user.email, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: aiProviderConfigs.provider, set: { enabled: Boolean(item.enabled), defaultModel: model("defaultModel") || model("chatModel"), limits, updatedBy: auth.user.email, updatedAt: now } });
  }
  return Response.json(await readSettings());
}
