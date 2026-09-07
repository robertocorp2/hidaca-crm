import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("record context and Daily Brief routes are authenticated and bounded", async () => {
  const [context, brief, chat] = await Promise.all([
    readFile("app/api/ai/context/route.ts", "utf8"),
    readFile("app/api/ai/daily-brief/route.ts", "utf8"),
    readFile("app/api/ai/chat/route.ts", "utf8"),
  ]);
  assert.match(context, /authorizeApi\(\{ module: "ai", action: "view" \}\)/);
  assert.match(context, /status: 400/);
  assert.match(brief, /ai\.daily_brief\.dismiss/);
  assert.match(chat, /untrusted/);
});

test("approval workflow remains typed, revalidated, idempotent, and audited", async () => {
  const [proposal, approval, activity, client] = await Promise.all([
    readFile("app/api/ai/actions/propose/route.ts", "utf8"),
    readFile("app/api/ai/approvals/route.ts", "utf8"),
    readFile("app/lib/activity-service.ts", "utf8"),
    readFile("app/app/record-ai-panel.tsx", "utf8"),
  ]);
  assert.match(proposal, /slice\(0, 10\)/);
  assert.match(approval, /validateProposedAiAction/);
  assert.match(approval, /ai-activity-\$\{approval\.id\}/);
  assert.match(approval, /ai\.approval\.executed/);
  assert.match(activity, /INSERT OR IGNORE INTO activities/);
  assert.ok(client.includes("/api/ai/actions/propose"));
  assert.doesNotMatch(client, /OPENAI_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY/);
});
