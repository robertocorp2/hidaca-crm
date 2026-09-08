import {
  AiError,
  type AiChatRequest,
  type AiChatResponse,
  type AiEnvironment,
  type AiModel,
  type AiProviderAdapter,
  type AiProviderStatus,
} from "./contracts";

type Json = Record<string, unknown>;
type Http = typeof fetch;

const DEFAULT_BASE_URL = "https://ollama.com/api";
const CLOUD_HOSTS = new Set(["ollama.com", "www.ollama.com"]);

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function baseUrl(value: string | undefined, allowLocal: boolean): URL {
  let url: URL;
  try {
    url = new URL(value || DEFAULT_BASE_URL);
  } catch {
    throw new AiError("invalid_request", "OLLAMA_BASE_URL no es válida.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && allowLocal)) || (!CLOUD_HOSTS.has(url.hostname) && !(local && allowLocal))) {
    throw new AiError("policy_blocked", "La URL de Ollama no está permitida.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/api";
  if (url.pathname !== "/api") {
    throw new AiError("invalid_request", "OLLAMA_BASE_URL debe apuntar a /api.");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function providerError(status: number, retryAfter = 0): AiError {
  const code = status === 401 ? "unauthorized"
    : status === 403 ? "forbidden"
      : status === 404 ? "not_found"
        : status === 429 ? "rate_limited"
          : status >= 500 ? "unavailable" : "invalid_request";
  return new AiError(code, "El proveedor de IA rechazó la solicitud.", Math.min(3600, Math.max(0, retryAfter)));
}

async function jsonResponse(
  response: Response,
  timeoutSignal: AbortSignal,
): Promise<Json> {
  if (!response.ok) throw providerError(response.status, Number(response.headers.get("retry-after")) || 0);
  if (!/\bjson\b/i.test(response.headers.get("content-type") ?? "")) throw new AiError("unavailable");
  const textBody = await response.text();
  if (timeoutSignal.aborted || textBody.length > 4 * 1024 * 1024) throw new AiError("unavailable");
  try {
    const value = JSON.parse(textBody);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value as Json;
  } catch {
    throw new AiError("unavailable", "La respuesta del proveedor no tiene un formato válido.");
  }
}

export class OllamaCloudAdapter implements AiProviderAdapter {
  readonly id = "ollama-cloud" as const;
  private readonly url: URL;
  private readonly key: string;
  private readonly enabled: boolean;
  private readonly model: string;
  private readonly timeout: number;
  private readonly http: Http;

  constructor(environment: AiEnvironment, http: Http = fetch) {
    this.enabled = environment.AI_OLLAMA_ENABLED !== "false";
    this.key = environment.OLLAMA_API_KEY?.trim() ?? "";
    this.model = environment.OLLAMA_MODEL?.trim() ?? "";
    this.timeout = Math.min(120000, Math.max(1000, Number(environment.OLLAMA_TIMEOUT_MS) || 30000));
    this.url = baseUrl(environment.OLLAMA_BASE_URL, environment.OLLAMA_ALLOW_LOCAL === "true");
    this.http = http;
  }

  status(): AiProviderStatus {
    return {
      id: this.id,
      name: "Ollama Cloud",
      enabled: this.enabled,
      configured: this.enabled && Boolean(this.key),
      baseUrl: this.url.origin + this.url.pathname,
      defaultModel: this.model || null,
      capabilities: {
        chat: true,
        text: true,
        streaming: false,
        toolCalling: true,
        structuredOutput: false,
        vision: false,
        reasoning: false,
      },
      models: this.model
        ? [{ id: this.model, provider: this.id, displayName: this.model, source: "configured", capabilities: { chat: true, text: true, streaming: false, toolCalling: true, structuredOutput: false } }]
        : [],
    };
  }

  async listModels(): Promise<AiModel[]> {
    if (!this.enabled) throw new AiError("policy_blocked");
    if (!this.key) throw new AiError("unauthorized", "OLLAMA_API_KEY no está configurada.");
    const response = await this.request("/tags", { method: "GET" });
    const models = Array.isArray(response.models) ? response.models : [];
    return models.slice(0, 100).flatMap((item) => {
      const value = record(item), id = text(value.name, 200);
      if (!id) return [];
      return [{
        id,
        provider: this.id,
        displayName: id,
        source: "discovered" as const,
        contextSize: integer(record(value.details).context_length),
        capabilities: { chat: true, text: true, streaming: false, toolCalling: true, structuredOutput: false },
      }];
    });
  }

  async chat(request: AiChatRequest, requestId: string): Promise<AiChatResponse> {
    if (!this.enabled) throw new AiError("policy_blocked", "Ollama Cloud está desactivado.");
    if (!this.key) throw new AiError("unauthorized", "OLLAMA_API_KEY no está configurada.");
    const model = request.model?.trim() || this.model;
    if (!model) throw new AiError("invalid_request", "Selecciona un modelo de Ollama Cloud.");
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 100) throw new AiError("invalid_request");
    if (request.tools?.length && request.tools.length > 32) throw new AiError("invalid_request");
    if (request.stream) throw new AiError("unsupported", "El endpoint síncrono no acepta streaming.");
    const started = Date.now();
    const payload = {
      model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}) })),
      stream: false,
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.temperature === undefined ? {} : { options: { temperature: request.temperature } }),
      ...(request.maxTokens === undefined ? {} : { options: { num_predict: request.maxTokens } }),
    };
    const response = await this.request("/chat", { method: "POST", body: JSON.stringify(payload) });
    const message = record(response.message), content = text(message.content, 100000);
    if (!content && !Array.isArray(message.tool_calls)) throw new AiError("unavailable", "Ollama no devolvió un mensaje.");
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.flatMap((call) => {
        const fn = record(record(call).function), name = text(fn.name, 200);
        if (!name) return [];
        const args = record(fn.arguments);
        return [{ name, arguments: args }];
      })
      : undefined;
    const usage = {
      promptTokens: integer(response.prompt_eval_count),
      completionTokens: integer(response.eval_count),
      totalTokens: (integer(response.prompt_eval_count) ?? 0) + (integer(response.eval_count) ?? 0) || undefined,
    };
    return {
      provider: this.id,
      model: text(response.model, 200) || model,
      message: { role: "assistant", content },
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(usage.totalTokens ? { usage } : {}),
      requestId,
      latencyMs: Date.now() - started,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await this.http(this.url.origin + this.url.pathname + path, {
        ...init,
        signal: controller.signal,
        // Cloudflare's fetch runtime can raise a TypeError for `redirect:
        // "error"` on an otherwise valid upstream response. Keep redirects
        // manual and reject them before parsing so the allow-list remains
        // enforced without following provider redirects.
        redirect: "manual",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      if (response.status >= 300 && response.status < 400) throw new AiError("policy_blocked");
      return await jsonResponse(response, controller.signal);
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(controller.signal.aborted ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
