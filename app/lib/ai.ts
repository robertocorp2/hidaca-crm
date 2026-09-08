export type AiProvider = "openai" | "deepseek" | "google";
export type AiTransport = "direct" | "gateway";

export type NormalizedMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type NormalizedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AiRequest = {
  provider?: AiProvider;
  model?: string;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  responseSchema?: Record<string, unknown>;
  stream?: boolean;
  allowFallback?: boolean;
  idempotencyKey: string;
};

export type AiResponse = {
  text: string;
  structured?: unknown;
  toolCalls: NormalizedToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
  provider: AiProvider;
  model: string;
  transport: AiTransport;
  requestId?: string;
};

export type AiEnvironment = {
  AI_ENABLED?: string;
  AI_DEFAULT_PROVIDER?: string;
  AI_DEFAULT_MODEL?: string;
  AI_FALLBACK_PROVIDERS?: string;
  AI_GATEWAY_ENABLED?: string;
  AI_OPENAI_MODEL?: string;
  AI_DEEPSEEK_MODEL?: string;
  AI_GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_NAME?: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const providerNames: readonly AiProvider[] = ["openai", "deepseek", "google"];
const providerKey = (env: AiEnvironment, provider: AiProvider) =>
  provider === "openai" ? env.OPENAI_API_KEY : provider === "deepseek" ? env.DEEPSEEK_API_KEY : env.GEMINI_API_KEY;

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && providerNames.includes(value as AiProvider);
}

export function isAiEnabled(env: AiEnvironment) {
  return env.AI_ENABLED === "true";
}

export function providerAvailability(env: AiEnvironment) {
  const gateway = Boolean(env.CF_AI_GATEWAY_TOKEN && env.CF_ACCOUNT_ID && env.CF_AI_GATEWAY_NAME);
  return providerNames.map((provider) => ({
    provider,
    configured: Boolean(providerKey(env, provider)),
    defaultModel: modelFor(env, provider),
    gatewayAvailable: gateway,
    transport: gateway && env.AI_GATEWAY_ENABLED === "true" ? "gateway" as const : "direct" as const,
  }));
}

function modelFor(env: AiEnvironment, provider: AiProvider) {
  return provider === "openai"
    ? env.AI_OPENAI_MODEL ?? env.AI_DEFAULT_MODEL ?? ""
    : provider === "deepseek"
      ? env.AI_DEEPSEEK_MODEL ?? env.AI_DEFAULT_MODEL ?? ""
      : env.AI_GEMINI_MODEL ?? env.AI_DEFAULT_MODEL ?? "";
}

function providerCandidates(env: AiEnvironment, requested?: AiProvider, allowFallback = false): AiProvider[] {
  const primary = requested ?? (isAiProvider(env.AI_DEFAULT_PROVIDER) ? env.AI_DEFAULT_PROVIDER : undefined) ?? "openai";
  const fallback = allowFallback
    ? (env.AI_FALLBACK_PROVIDERS ?? "").split(",").map((item) => item.trim()).filter(isAiProvider)
    : [];
  return [...new Set([primary, ...fallback])];
}

function transportFor(env: AiEnvironment): AiTransport {
  return env.AI_GATEWAY_ENABLED === "true" && Boolean(env.CF_AI_GATEWAY_TOKEN && env.CF_ACCOUNT_ID && env.CF_AI_GATEWAY_NAME)
    ? "gateway"
    : "direct";
}

function normalizedContent(value: unknown) {
  if (typeof value === "string") return value.slice(0, 16000);
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n").slice(0, 16000);
  return "";
}

function normalizeTools(tools: NormalizedTool[] | undefined) {
  return (tools ?? []).slice(0, 20).map((tool) => ({
    type: "function" as const,
    function: { name: tool.name.slice(0, 128), description: tool.description.slice(0, 1000), parameters: tool.inputSchema },
  }));
}

async function providerError(response: Response) {
  const text = (await response.text()).slice(0, 1000);
  return new Error(`AI_PROVIDER_${response.status}: ${text || response.statusText}`);
}

type JsonRecord = Record<string, unknown>;

function jsonResponse(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

async function directChat(env: AiEnvironment, provider: AiProvider, request: AiRequest, fetcher: Fetcher): Promise<AiResponse> {
  const key = providerKey(env, provider);
  if (!key) throw new Error(`AI_${provider.toUpperCase()}_NOT_CONFIGURED`);
  const model = request.model || modelFor(env, provider);
  if (!model) throw new Error(`AI_${provider.toUpperCase()}_MODEL_NOT_CONFIGURED`);
  if (provider === "google") return directGemini(env, key, model, request, fetcher);
  const response = await fetcher(provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: request.messages.map((message) => ({ role: message.role, content: normalizedContent(message.content) })),
      tools: normalizeTools(request.tools),
      ...(request.responseSchema ? { response_format: { type: "json_object" } } : {}),
      stream: false,
    }),
  });
  if (!response.ok) throw await providerError(response);
  const body = jsonResponse(await response.json());
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = jsonResponse(jsonResponse(choices[0]).message);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((value: unknown) => {
    const call = jsonResponse(value);
    const fn = jsonResponse(call.function);
    return { id: String(call.id ?? crypto.randomUUID()), name: String(fn.name ?? ""), arguments: parseObject(fn.arguments) };
  }).filter((call: NormalizedToolCall) => call.name) : [];
  const usage = jsonResponse(body.usage);
  return {
    text: normalizedContent(message.content),
    structured: request.responseSchema ? parseObject(message.content) : undefined,
    toolCalls,
    usage: { inputTokens: numberOrUndefined(usage.prompt_tokens), outputTokens: numberOrUndefined(usage.completion_tokens) },
    provider,
    model,
    transport: "direct",
    requestId: typeof body.id === "string" ? body.id : undefined,
  };
}

async function directGemini(env: AiEnvironment, key: string, model: string, request: AiRequest, fetcher: Fetcher): Promise<AiResponse> {
  const contents = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: normalizedContent(message.content) }],
  }));
  const system = request.messages.find((message) => message.role === "system");
  const body: Record<string, unknown> = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: normalizedContent(system.content) }] } } : {}),
    ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.slice(0, 20).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }] } : {}),
    ...(request.responseSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema: request.responseSchema } } : {}),
  };
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await providerError(response);
  const root = jsonResponse(await response.json());
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const firstCandidate = jsonResponse(candidates[0]);
  const content = jsonResponse(firstCandidate.content);
  const parts = content.parts;
  const list = Array.isArray(parts) ? parts : [];
  const text = list.map((value: unknown) => jsonResponse(value)).filter((part) => typeof part.text === "string").map((part) => String(part.text)).join("\n");
  const toolCalls = list.map((value: unknown) => jsonResponse(value)).map((part) => ({ part, call: jsonResponse(part.functionCall) })).filter(({ call }) => Boolean(call.name)).map(({ call }) => ({ id: crypto.randomUUID(), name: String(call.name), arguments: parseObject(call.args) }));
  return { text, structured: request.responseSchema ? parseObject(text) : undefined, toolCalls, provider: "google", model, transport: "direct" };
}

async function gatewayChat(env: AiEnvironment, provider: AiProvider, request: AiRequest, fetcher: Fetcher): Promise<AiResponse> {
  if (!env.CF_AI_GATEWAY_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_AI_GATEWAY_NAME) throw new Error("AI_GATEWAY_NOT_CONFIGURED");
  const key = providerKey(env, provider);
  if (!key) throw new Error(`AI_${provider.toUpperCase()}_NOT_CONFIGURED`);
  const model = request.model || modelFor(env, provider);
  if (!model) throw new Error(`AI_${provider.toUpperCase()}_MODEL_NOT_CONFIGURED`);
  const endpoint = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(env.CF_ACCOUNT_ID)}/${encodeURIComponent(env.CF_AI_GATEWAY_NAME)}/compat/chat/completions`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "cf-aig-authorization": `Bearer ${env.CF_AI_GATEWAY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `${provider === "google" ? "google-ai-studio" : provider}/${model}`,
      messages: request.messages,
      tools: normalizeTools(request.tools),
      ...(request.responseSchema ? { response_format: { type: "json_object" } } : {}),
      stream: false,
    }),
  });
  if (!response.ok) throw await providerError(response);
  const body = jsonResponse(await response.json());
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = jsonResponse(jsonResponse(choices[0]).message);
  const usage = jsonResponse(body.usage);
  return {
    text: normalizedContent(message.content),
    structured: request.responseSchema ? parseObject(message.content) : undefined,
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.map((value: unknown) => { const call = jsonResponse(value); const fn = jsonResponse(call.function); return { id: String(call.id ?? crypto.randomUUID()), name: String(fn.name ?? ""), arguments: parseObject(fn.arguments) }; }).filter((call: NormalizedToolCall) => call.name) : [],
    usage: { inputTokens: numberOrUndefined(usage.prompt_tokens), outputTokens: numberOrUndefined(usage.completion_tokens) },
    provider, model, transport: "gateway", requestId: typeof body.id === "string" ? body.id : undefined,
  };
}

export function createAiProviderRouter(env: AiEnvironment, fetcher: Fetcher = fetch) {
  return {
    async complete(request: AiRequest): Promise<AiResponse> {
      if (!isAiEnabled(env)) throw new Error("AI_DISABLED");
      const candidates = providerCandidates(env, request.provider, request.allowFallback === true);
      const errors: string[] = [];
      for (const provider of candidates) {
        try {
          const transport = transportFor(env);
          return transport === "gateway" ? await gatewayChat(env, provider, request, fetcher) : await directChat(env, provider, request, fetcher);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "AI_PROVIDER_FAILED");
          if (!request.allowFallback) break;
        }
      }
      throw new Error(errors.join("; ") || "AI_PROVIDER_UNAVAILABLE");
    },
    async transcribe(input: { audio: ArrayBuffer; contentType: string; language?: string; model?: string }): Promise<{ text: string; provider: AiProvider; model: string }> {
      if (!isAiEnabled(env)) throw new Error("AI_DISABLED");
      const openAiKey = env.OPENAI_API_KEY;
      const model = input.model ?? "gpt-4o-transcribe";
      if (openAiKey) {
        const form = new FormData();
        form.append("file", new Blob([input.audio], { type: input.contentType }), "recording");
        form.append("model", model);
        if (input.language) form.append("language", input.language);
        const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${openAiKey}` }, body: form });
        if (response.ok) {
          const body = jsonResponse(await response.json());
          return { text: normalizedContent(body.text), provider: "openai", model };
        }
      }
      if (env.GEMINI_API_KEY && env.AI_GEMINI_MODEL) {
        const encoded = bytesToBase64(new Uint8Array(input.audio));
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.AI_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Transcribe this audio exactly in its spoken language." }, { inlineData: { mimeType: input.contentType, data: encoded } }] }] }),
        });
        if (response.ok) {
          const body = jsonResponse(await response.json());
          const candidates = Array.isArray(body.candidates) ? body.candidates : [];
          const first = jsonResponse(candidates[0]);
          const content = jsonResponse(first.content);
          const parts = Array.isArray(content.parts) ? content.parts : [];
          const firstPart = jsonResponse(parts[0]);
          return { text: normalizedContent(firstPart.text), provider: "google", model: env.AI_GEMINI_MODEL };
        }
      }
      throw new Error("AI_TRANSCRIPTION_PROVIDER_UNAVAILABLE");
    },
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
