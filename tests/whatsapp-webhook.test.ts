import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import { persistInboundWhatsAppMessage, runWhatsAppWebhookDelivery, updateWhatsAppMessageStatus, whatsappWebhookResponse } from "../app/lib/whatsapp-webhook";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(`
    CREATE TABLE whatsapp_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      processing_started_at TEXT,
      lease_until TEXT
    );
    CREATE TABLE whatsapp_conversations (
      id TEXT PRIMARY KEY,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_inbound_at TEXT,
      last_message_at TEXT,
      service_window_expires_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE whatsapp_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES whatsapp_conversations(id),
      meta_message_id TEXT UNIQUE,
      direction TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      caption TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      media_id TEXT,
      media_key TEXT,
      content_type TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      failed_at TEXT
    );
    CREATE TRIGGER whatsapp_messages_inbound_unread_after_insert
    AFTER INSERT ON whatsapp_messages
    WHEN NEW.direction = 'inbound'
    BEGIN
      UPDATE whatsapp_conversations SET unread_count = unread_count + 1 WHERE id = NEW.conversation_id;
    END;
  `);

  const meta = () => ({ duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 });
  function prepare(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    return {
      bind(...params: unknown[]) { return prepare(sql, params as SQLInputValue[]); },
      async first<T>(column?: string): Promise<T | null> { const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined; return row ? (column ? row[column] : row) as T : null; },
      async all<T>(): Promise<D1Result<T>> { return { success: true, results: sqlite.prepare(sql).all(...values) as T[], meta: meta() }; },
      async run<T>(): Promise<D1Result<T>> { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { ...meta(), changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      async raw<T extends unknown[]>(): Promise<T[]> { return sqlite.prepare(sql).all(...values).map(row => Object.values(row) as T); },
    } as D1PreparedStatement;
  }
  return { sqlite, d1: { prepare } as D1Database };
}

const options = { eventHash: "event-1", eventType: "batch", now: "2026-09-14T04:00:00.000Z", leaseMs: 60_000 };

test("successful webhook delivery is terminal and a duplicate is a no-op", async () => {
  const { sqlite, d1 } = database();
  let calls = 0;
  const first = await runWhatsAppWebhookDelivery(d1, options, async () => { calls++; });
  const duplicate = await runWhatsAppWebhookDelivery(d1, { ...options, now: "2026-09-14T04:00:01.000Z" }, async () => { calls++; });
  assert.equal(first.status, "completed");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(calls, 1);
  assert.deepEqual({ ...sqlite.prepare("SELECT processing_status,attempt_count,processed_at,error FROM whatsapp_webhook_events").get() }, { processing_status: "processed", attempt_count: 1, processed_at: options.now, error: null });
  sqlite.close();
});

test("a failed delivery is retryable and records its attempt/error", async () => {
  const { sqlite, d1 } = database();
  await assert.rejects(runWhatsAppWebhookDelivery(d1, options, async () => { throw new Error("downstream unavailable"); }));
  const failed = sqlite.prepare("SELECT processing_status,attempt_count,error,processed_at FROM whatsapp_webhook_events").get();
  assert.deepEqual({ ...failed }, { processing_status: "failed", attempt_count: 1, error: "downstream unavailable", processed_at: null });
  const retry = await runWhatsAppWebhookDelivery(d1, { ...options, now: "2026-09-14T04:00:02.000Z" }, async () => "replayed");
  assert.deepEqual(retry, { status: "completed", attemptCount: 2, value: "replayed" });
  assert.equal(sqlite.prepare("SELECT processing_status,attempt_count FROM whatsapp_webhook_events").get()?.processing_status, "processed");
  sqlite.close();
});

test("an abandoned processing lease can be reclaimed", async () => {
  const { sqlite, d1 } = database();
  sqlite.prepare("INSERT INTO whatsapp_webhook_events(event_hash,event_type,processing_status,received_at,attempt_count,lease_until) VALUES(?,?,?,?,?,?)").run(options.eventHash, options.eventType, "processing", options.now, 1, "2026-09-14T03:59:00.000Z");
  const result = await runWhatsAppWebhookDelivery(d1, options, async () => "recovered");
  assert.deepEqual(result, { status: "completed", attemptCount: 2, value: "recovered" });
  sqlite.close();
});

test("concurrent deliveries expose one in-flight retry and run side effects once", async () => {
  const { sqlite, d1 } = database();
  let calls = 0;
  const results = await Promise.all([
    runWhatsAppWebhookDelivery(d1, options, async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); }),
    runWhatsAppWebhookDelivery(d1, options, async () => { calls++; }),
  ]);
  assert.equal(calls, 1);
  assert.ok(results.some(result => result.status === "completed"));
  assert.ok(results.some(result => result.status === "in_flight"));
  sqlite.close();
});

test("duplicate inbound message persistence does not double-count unread messages", async () => {
  const { sqlite, d1 } = database();
  sqlite.prepare("INSERT INTO whatsapp_conversations(id,updated_at) VALUES(?,?)").run("conversation-1", options.now);
  const input = { id: "message-1", conversationId: "conversation-1", metaMessageId: "wamid-1", type: "text", body: "Hola", caption: "", mediaId: null, mediaKey: null, contentType: null, now: options.now };
  assert.equal(await persistInboundWhatsAppMessage(d1, input), true);
  assert.equal(await persistInboundWhatsAppMessage(d1, { ...input, id: "message-2", now: "2026-09-14T04:00:01.000Z" }), false);
  assert.equal(sqlite.prepare("SELECT unread_count FROM whatsapp_conversations").get()?.unread_count, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM whatsapp_messages").get()?.count, 1);
  sqlite.close();
});

test("status webhooks advance atomically and never regress a failed message", async () => {
  const { sqlite, d1 } = database();
  sqlite.prepare("INSERT INTO whatsapp_conversations(id,updated_at) VALUES(?,?)").run("conversation-1", options.now);
  sqlite.prepare("INSERT INTO whatsapp_messages(id,conversation_id,meta_message_id,direction,type,body,caption,status,created_at) VALUES(?,?,?,'outbound','text','','','sent',?)").run("message-1", "conversation-1", "wamid-status", options.now);
  assert.equal(await updateWhatsAppMessageStatus(d1, "wamid-status", "delivered", null, options.now), true);
  assert.equal(await updateWhatsAppMessageStatus(d1, "wamid-status", "failed", [{ code: "timeout" }], "2026-09-14T04:00:01.000Z"), true);
  assert.equal(await updateWhatsAppMessageStatus(d1, "wamid-status", "delivered", null, "2026-09-14T04:00:02.000Z"), false);
  assert.deepEqual({ ...sqlite.prepare("SELECT status,delivered_at,failed_at FROM whatsapp_messages").get() }, { status: "failed", delivered_at: options.now, failed_at: "2026-09-14T04:00:01.000Z" });
  sqlite.close();
});

test("provider response mapping keeps duplicates acknowledged and active work retryable", async () => {
  const duplicate = whatsappWebhookResponse("duplicate");
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
  const inFlight = whatsappWebhookResponse("in_flight");
  assert.equal(inFlight.status, 500);
  assert.equal(inFlight.headers.get("Retry-After"), "5");
  assert.deepEqual(await inFlight.json(), { ok: false, retryable: true });
});
