import assert from "node:assert/strict";
import test from "node:test";
import { createAiProviderRouter, isAiEnabled, providerAvailability } from "../app/lib/ai.js";

const request = {
  messages: [{ role: "user" as const, content: "Resume la actividad." }],
  model: "deepseek-v4-flash",
  idempotencyKey: "test-run",
};

test("provider availability never exposes credentials and respects feature flag", () => {
  const env = { AI_ENABLED: "false", OPENAI_API_KEY: "secret", DEEPSEEK_API_KEY: "deep" };
  assert.equal(isAiEnabled(env), false);
  assert.deepEqual(providerAvailability(env).map(({ provider, configured }) => ({ provider, configured })), [
    { provider: "openai", configured: true },
    { provider: "deepseek", configured: true },
    { provider: "google", configured: false },
    { provider: "ollama-cloud", configured: false },
  ]);
  assert.doesNotMatch(JSON.stringify(providerAvailability(env)), /secret|deep-key/);
});

test("DeepSeek direct adapter normalizes text, tool calls, and usage", async () => {
  let calledUrl = "";
  const router = createAiProviderRouter({ AI_ENABLED: "true", DEEPSEEK_API_KEY: "deep" }, async (input) => {
    calledUrl = String(input);
    return Response.json({ id: "run-1", choices: [{ message: { content: "Listo", tool_calls: [{ id: "tool-1", function: { name: "search_records", arguments: '{"term":"obra"}' } }] } }], usage: { prompt_tokens: 4, completion_tokens: 7 } });
  });
  const result = await router.complete({ ...request, provider: "deepseek" });
  assert.equal(calledUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(result.text, "Listo");
  assert.deepEqual(result.toolCalls[0], { id: "tool-1", name: "search_records", arguments: { term: "obra" } });
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 7 });
});

test("read-only fallback moves from unavailable primary to configured provider", async () => {
  const calls: string[] = [];
  const router = createAiProviderRouter({ AI_ENABLED: "true", AI_DEFAULT_PROVIDER: "openai", AI_FALLBACK_PROVIDERS: "google", GEMINI_API_KEY: "gem-key", AI_GEMINI_MODEL: "gemini-test" }, async (input) => {
    calls.push(String(input));
    return Response.json({ candidates: [{ content: { parts: [{ text: "Respuesta Gemini" }] } }] });
  });
  const result = await router.complete({ ...request, model: undefined, allowFallback: true });
  assert.equal(result.provider, "google");
  assert.equal(result.text, "Respuesta Gemini");
  assert.deepEqual(calls, ["https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=gem-key"]);
});

test("Google adapter normalizes function calls", async () => {
  const router = createAiProviderRouter({ AI_ENABLED: "true", GEMINI_API_KEY: "gem-key" }, async () => Response.json({ candidates: [{ content: { parts: [{ functionCall: { name: "get_record_context", args: { id: "project-1" } } }] } }] }));
  const result = await router.complete({ ...request, provider: "google", model: "gemini-test" });
  assert.equal(result.toolCalls[0].name, "get_record_context");
  assert.deepEqual(result.toolCalls[0].arguments, { id: "project-1" });
});

test("AI remains safe when no provider key is configured", async () => {
  const router = createAiProviderRouter({ AI_ENABLED: "true" });
  await assert.rejects(() => router.complete({ ...request, provider: "openai" }), /AI_OPENAI_NOT_CONFIGURED/);
});
