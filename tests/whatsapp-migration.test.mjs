import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("webhook migration makes legacy completion policy explicit and installs atomic unread handling", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE whatsapp_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      meta_message_id TEXT,
      processing_status TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE TABLE whatsapp_conversations (id TEXT PRIMARY KEY, unread_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE whatsapp_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      meta_message_id TEXT,
      direction TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      caption TEXT NOT NULL,
      status TEXT NOT NULL,
      media_id TEXT,
      media_key TEXT,
      content_type TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO whatsapp_webhook_events(event_hash,event_type,processing_status,received_at) VALUES('legacy-partial','batch','processed','2026-09-14T04:00:00.000Z');
    INSERT INTO whatsapp_webhook_events(event_hash,event_type,processing_status,received_at) VALUES('legacy-ignored','batch','ignored','2026-09-14T04:00:00.000Z');
  `);
  const migration = await readFile(new URL("../drizzle/0024_whatsapp_webhook_retry.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) database.exec(statement);

  assert.deepEqual({ ...database.prepare("SELECT processing_status,processed_at,error FROM whatsapp_webhook_events WHERE event_hash='legacy-partial'").get() }, {
    processing_status: "failed",
    processed_at: null,
    error: "Legacy delivery had no durable completion marker",
  });
  assert.deepEqual({ ...database.prepare("SELECT processing_status,processed_at,error FROM whatsapp_webhook_events WHERE event_hash='legacy-ignored'").get() }, {
    processing_status: "processed",
    processed_at: "2026-09-14T04:00:00.000Z",
    error: "Legacy ignored delivery preserved as a no-op",
  });

  database.prepare("INSERT INTO whatsapp_conversations(id,unread_count) VALUES(?,0)").run("conversation-1");
  database.prepare("INSERT INTO whatsapp_messages(id,conversation_id,meta_message_id,direction,type,body,caption,status,created_at) VALUES(?,?,?,'inbound','text','Hola','', 'received', ?)").run("message-1", "conversation-1", "wamid-1", "2026-09-14T04:00:00.000Z");
  assert.equal(database.prepare("SELECT unread_count FROM whatsapp_conversations").get()?.unread_count, 1);
  database.close();
});
