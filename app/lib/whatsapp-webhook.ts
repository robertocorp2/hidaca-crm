import type { D1Database } from "@cloudflare/workers-types";

export const WHATSAPP_WEBHOOK_LEASE_MS = 5 * 60 * 1000;

type WebhookEventStatus = "received" | "processing" | "processed" | "failed";

type WebhookEventRow = {
  processing_status: WebhookEventStatus;
  attempt_count: number;
  lease_until: string | null;
};

const whatsappStatusRank = { received: 0, uncertain: 1, sent: 2, delivered: 3, read: 4, failed: 5 } as const;
const whatsappMessageStatuses = Object.keys(whatsappStatusRank) as Array<keyof typeof whatsappStatusRank>;

type WebhookDeliveryClaim =
  | { status: "claimed"; attemptCount: number }
  | { status: "duplicate"; attemptCount: number }
  | { status: "in_flight"; attemptCount: number };

type WebhookDeliveryOptions = {
  eventHash: string;
  eventType: string;
  now: string;
  leaseMs?: number;
};

function leaseUntil(now: string, leaseMs: number) {
  return new Date(new Date(now).getTime() + leaseMs).toISOString();
}

export async function claimWhatsAppWebhookEvent(
  d1: D1Database,
  { eventHash, eventType, now, leaseMs = WHATSAPP_WEBHOOK_LEASE_MS }: WebhookDeliveryOptions,
): Promise<WebhookDeliveryClaim> {
  await d1
    .prepare(
      `INSERT INTO whatsapp_webhook_events (event_hash,event_type,processing_status,received_at,attempt_count)
       VALUES (?, ?, 'received', ?, 0)
       ON CONFLICT(event_hash) DO NOTHING`,
    )
    .bind(eventHash, eventType, now)
    .run();

  const claimed = await d1
    .prepare(
      `UPDATE whatsapp_webhook_events
       SET processing_status='processing', attempt_count=attempt_count+1,
           last_attempt_at=?, processing_started_at=?, lease_until=?, error=NULL
       WHERE event_hash=?
         AND (
           processing_status IN ('received','failed')
           OR (processing_status='processing' AND (lease_until IS NULL OR lease_until < ?))
         )
       RETURNING attempt_count`,
    )
    .bind(now, now, leaseUntil(now, leaseMs), eventHash, now)
    .first<{ attempt_count: number }>();

  if (claimed) return { status: "claimed", attemptCount: Number(claimed.attempt_count) };

  const current = await d1
    .prepare("SELECT processing_status,attempt_count,lease_until FROM whatsapp_webhook_events WHERE event_hash=?")
    .bind(eventHash)
    .first<WebhookEventRow>();
  if (!current) throw new Error("WHATSAPP_WEBHOOK_EVENT_MISSING");
  if (current.processing_status === "processed") return { status: "duplicate", attemptCount: Number(current.attempt_count) };
  return { status: "in_flight", attemptCount: Number(current.attempt_count) };
}

async function finishWhatsAppWebhookEvent(
  d1: D1Database,
  eventHash: string,
  attemptCount: number,
  values: { processingStatus: "processed" | "failed"; error?: string | null; now: string },
) {
  const result = await d1
    .prepare(
      `UPDATE whatsapp_webhook_events
       SET processing_status=?, error=?, processed_at=?, processing_started_at=NULL, lease_until=NULL
       WHERE event_hash=? AND processing_status='processing' AND attempt_count=?`,
    )
    .bind(values.processingStatus, values.error ?? null, values.processingStatus === "processed" ? values.now : null, eventHash, attemptCount)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function completeWhatsAppWebhookEvent(d1: D1Database, eventHash: string, attemptCount: number, now: string) {
  if (!(await finishWhatsAppWebhookEvent(d1, eventHash, attemptCount, { processingStatus: "processed", now }))) {
    throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
  }
}

export async function failWhatsAppWebhookEvent(d1: D1Database, eventHash: string, attemptCount: number, now: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Error";
  return finishWhatsAppWebhookEvent(d1, eventHash, attemptCount, { processingStatus: "failed", error: message, now });
}

export async function runWhatsAppWebhookDelivery<T>(
  d1: D1Database,
  options: WebhookDeliveryOptions,
  work: () => Promise<T>,
): Promise<
  | { status: "completed"; attemptCount: number; value: T }
  | { status: "duplicate"; attemptCount: number }
  | { status: "in_flight"; attemptCount: number }
> {
  const claim = await claimWhatsAppWebhookEvent(d1, options);
  if (claim.status !== "claimed") return claim;
  try {
    const value = await work();
    await completeWhatsAppWebhookEvent(d1, options.eventHash, claim.attemptCount, options.now);
    return { status: "completed", attemptCount: claim.attemptCount, value };
  } catch (error) {
    await failWhatsAppWebhookEvent(d1, options.eventHash, claim.attemptCount, options.now, error).catch(() => false);
    throw error;
  }
}

export async function persistInboundWhatsAppMessage(
  d1: D1Database,
  input: {
    id: string;
    conversationId: string;
    metaMessageId: string | null;
    type: string;
    body: string;
    caption: string;
    mediaId: string | null;
    mediaKey: string | null;
    contentType: string | null;
    now: string;
  },
) {
  const inserted = await d1
    .prepare(
      `INSERT INTO whatsapp_messages
       (id,conversation_id,meta_message_id,direction,type,body,caption,status,media_id,media_key,content_type,created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'received', ?, ?, ?, ?)
       ON CONFLICT(meta_message_id) DO NOTHING
       RETURNING id`,
    )
    .bind(input.id, input.conversationId, input.metaMessageId, input.type, input.body, input.caption, input.mediaId, input.mediaKey, input.contentType, input.now)
    .first<{ id: string }>();

  // The trigger-backed unread increment only runs for a newly inserted inbound
  // message. These timestamps are safe to replay after a partial attempt.
  await d1
    .prepare("UPDATE whatsapp_conversations SET last_inbound_at=?,last_message_at=?,service_window_expires_at=?,updated_at=? WHERE id=?")
    .bind(input.now, input.now, new Date(new Date(input.now).getTime() + 24 * 60 * 60 * 1000).toISOString(), input.now, input.conversationId)
    .run();
  return Boolean(inserted);
}

export async function updateWhatsAppMessageStatus(d1: D1Database, metaMessageId: string, incoming: string, errors: unknown, now: string) {
  if (!(incoming in whatsappStatusRank)) return false;
  const incomingRank = whatsappStatusRank[incoming as keyof typeof whatsappStatusRank];
  const allowedStatuses = incoming === "failed"
    ? whatsappMessageStatuses
    : whatsappMessageStatuses.filter(status => whatsappStatusRank[status] <= incomingRank);
  const error = Array.isArray(errors) ? JSON.stringify(errors).slice(0, 1000) : null;
  const placeholders = allowedStatuses.map(() => "?").join(",");
  const result = await d1
    .prepare(
      `UPDATE whatsapp_messages
       SET status=?, error_message=?,
           delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
           read_at=CASE WHEN ?='read' THEN COALESCE(read_at,?) ELSE read_at END,
           failed_at=CASE WHEN ?='failed' THEN COALESCE(failed_at,?) ELSE failed_at END
       WHERE meta_message_id=? AND status IN (${placeholders})`,
    )
    .bind(incoming, error, incoming, now, incoming, now, incoming, now, metaMessageId, ...allowedStatuses)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export function whatsappWebhookResponse(status: "completed" | "duplicate" | "in_flight") {
  if (status === "duplicate") return Response.json({ ok: true, duplicate: true });
  if (status === "in_flight") return Response.json({ ok: false, retryable: true }, { status: 500, headers: { "Retry-After": "5" } });
  return Response.json({ ok: true });
}
