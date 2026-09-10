import assert from "node:assert/strict";
import test from "node:test";
import { createAiProviderRouter, isAiProvider, listOllamaModels, providerAvailability } from "../app/lib/ai";

function response(body: unknown, status = 200, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("Ollama Cloud is registered without exposing the server key", () => {
  assert.equal(isAiProvider("ollama-cloud"), true);
  const status = providerAvailability({ AI_OLLAMA_ENABLED: "true", OLLAMA_API_KEY: "secret-value", OLLAMA_MODEL: "gpt-oss:20b" }).find((item) => item.provider === "ollama-cloud");
  assert.equal(status?.configured, true);
  assert.equal(status?.defaultModel, "gpt-oss:20b");
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
});

test("missing Ollama key prevents model discovery", async () => {
  let called = false;
  await assert.rejects(listOllamaModels({}, async () => { called = true; return response({}); }), /AI_OLLAMA_CLOUD_NOT_CONFIGURED/);
  assert.equal(called, false);
});

test("model discovery uses /api/tags and bearer authentication", async () => {
  let received: Request | undefined;
  const models = await listOllamaModels({ OLLAMA_API_KEY: "secret-value" }, async (input, init) => { received = new Request(input, init); return response({ models: [{ name: "gpt-oss:20b" }] }); });
  assert.equal(new URL(received!.url).pathname, "/api/tags");
  assert.equal(received!.headers.get("authorization"), "Bearer secret-value");
  assert.deepEqual(models[0].capabilities, { chat: true, text: true, streaming: false, toolCalling: true, structuredOutput: false });
});

test("chat normalizes Ollama responses and tool calls", async () => {
  let body = "";
  const router = createAiProviderRouter({ AI_ENABLED: "true", OLLAMA_API_KEY: "secret-value", OLLAMA_MODEL: "gpt-oss:20b" }, async (_input, init) => { body = String(init?.body); return response({ model: "gpt-oss:20b", message: { role: "assistant", content: "Hola", tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: { id: "1" } } }] }, prompt_eval_count: 3, eval_count: 5 }); });
  const result = await router.complete({ provider: "ollama-cloud", messages: [{ role: "user", content: "Hola" }], tools: [{ name: "lookup", description: "lookup", inputSchema: { type: "object" } }], idempotencyKey: "request-1" });
  assert.equal(result.provider, "ollama-cloud");
  assert.equal(result.text, "Hola");
  assert.deepEqual(result.toolCalls[0].arguments, { id: "1" });
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 5 });
  assert.equal(JSON.parse(body).stream, false);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("Ollama failures, streaming, and structured output are bounded", async () => {
  const unauthorized = createAiProviderRouter({ AI_ENABLED: "true", OLLAMA_API_KEY: "key", OLLAMA_MODEL: "model" }, async () => response({ error: "sensitive" }, 401));
  await assert.rejects(unauthorized.complete({ provider: "ollama-cloud", messages: [{ role: "user", content: "x" }], idempotencyKey: "r" }), /AI_PROVIDER_401/);
  const router = createAiProviderRouter({ AI_ENABLED: "true", OLLAMA_API_KEY: "key", OLLAMA_MODEL: "model" }, async () => response({}));
  await assert.rejects(router.complete({ provider: "ollama-cloud", messages: [{ role: "user", content: "x" }], stream: true, idempotencyKey: "r" }), /AI_OLLAMA_STREAMING_UNSUPPORTED/);
  await assert.rejects(router.complete({ provider: "ollama-cloud", messages: [{ role: "user", content: "x" }], responseSchema: { type: "object" }, idempotencyKey: "r" }), /AI_OLLAMA_STRUCTURED_OUTPUT_UNSUPPORTED/);
});

test("Ollama URL policy only permits cloud or explicit local mode", () => {
  const router = createAiProviderRouter({ AI_ENABLED: "true", OLLAMA_API_KEY: "key", OLLAMA_MODEL: "model", OLLAMA_BASE_URL: "https://evil.example/api" });
  assert.doesNotThrow(() => createAiProviderRouter({ OLLAMA_BASE_URL: "http://localhost:11434/api", OLLAMA_ALLOW_LOCAL: "true" }));
  return assert.rejects(router.complete({ provider: "ollama-cloud", messages: [{ role: "user", content: "x" }], idempotencyKey: "r" }), /AI_OLLAMA_BASE_URL_BLOCKED/);
});
