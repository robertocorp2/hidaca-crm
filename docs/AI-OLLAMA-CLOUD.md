# Ollama Cloud provider

HIDACA routes Ollama Cloud through the existing AI provider router. The adapter supports synchronous chat/text and tool calls. It reports streaming, structured output, vision, and reasoning as unavailable unless a future adapter adds verified support.

Configure these server-side only:

- `AI_ENABLED=true`
- `AI_OLLAMA_ENABLED=true`
- `OLLAMA_API_KEY` as a Worker secret
- `OLLAMA_BASE_URL=https://ollama.com/api`
- `OLLAMA_MODEL=<explicit model>`
- `OLLAMA_TIMEOUT_MS` (default 30000)

`GET /api/ai/models` discovers models from Ollama Cloud without returning the key. Local Ollama URLs are blocked unless `OLLAMA_ALLOW_LOCAL=true` is explicitly set for local development. Provider selection and fallback continue to use HIDACA's existing AI settings, run, usage, audit, tool-call, and approval paths.
