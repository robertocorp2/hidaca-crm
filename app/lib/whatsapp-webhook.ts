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

export type WhatsAppWebhookClaim = {
  eventHash: string;
  attemptCount: number;
};

export type WhatsAppStatusUpdate = "updated" | "already_applied" | "missing";

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
  const leaseCheckAt = new Date().toISOString();
  const result = await d1
    .prepare(
      `UPDATE whatsapp_webhook_events
       SET processing_status=?, error=?, processed_at=?, processing_started_at=NULL, lease_until=NULL
       WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?`,
    )
    .bind(values.processingStatus, values.error ?? null, values.processingStatus === "processed" ? values.now : null, eventHash, attemptCount, leaseCheckAt)
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
  work: (claim: WhatsAppWebhookClaim) => Promise<T>,
): Promise<
  | { status: "completed"; attemptCount: number; value: T }
  | { status: "duplicate"; attemptCount: number }
  | { status: "in_flight"; attemptCount: number }
> {
  const claim = await claimWhatsAppWebhookEvent(d1, options);
  if (claim.status !== "claimed") return claim;
  const attempt: WhatsAppWebhookClaim = { eventHash: options.eventHash, attemptCount: claim.attemptCount };
  try {
    const value = await work(attempt);
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
    claim?: WhatsAppWebhookClaim;
  },
) {
  const claimCheckAt = new Date().toISOString();
  const claimClause = input.claim ? "WHERE EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : "";
  const inserted = await d1
    .prepare(
      `INSERT INTO whatsapp_messages
       (id,conversation_id,meta_message_id,direction,type,body,caption,status,media_id,media_key,content_type,created_at)
       SELECT ?, ?, ?, 'inbound', ?, ?, ?, 'received', ?, ?, ?, ?
       ${claimClause}
       ON CONFLICT(meta_message_id) DO NOTHING
       RETURNING id`,
    )
    .bind(input.id, input.conversationId, input.metaMessageId, input.type, input.body, input.caption, input.mediaId, input.mediaKey, input.contentType, input.now, ...(input.claim ? [input.claim.eventHash, input.claim.attemptCount, claimCheckAt] : []))
    .first<{ id: string }>();

  // The trigger-backed unread increment only runs for a newly inserted inbound
  // message. These timestamps are safe to replay after a partial attempt.
  await d1
    .prepare(
      `UPDATE whatsapp_conversations
       SET last_inbound_at=CASE WHEN last_inbound_at IS NULL OR last_inbound_at < ? THEN ? ELSE last_inbound_at END,
           last_message_at=CASE WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
           service_window_expires_at=CASE WHEN service_window_expires_at IS NULL OR service_window_expires_at < ? THEN ? ELSE service_window_expires_at END,
           updated_at=CASE WHEN updated_at < ? THEN ? ELSE updated_at END
       WHERE id=? ${input.claim ? "AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : ""}`,
    )
    .bind(input.now, input.now, input.now, input.now, new Date(new Date(input.now).getTime() + 24 * 60 * 60 * 1000).toISOString(), new Date(new Date(input.now).getTime() + 24 * 60 * 60 * 1000).toISOString(), input.now, input.now, input.conversationId, ...(input.claim ? [input.claim.eventHash, input.claim.attemptCount, claimCheckAt] : []))
    .run();
  if (input.claim && !(await webhookClaimIsActive(d1, input.claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
  return Boolean(inserted);
}

export async function webhookClaimIsActive(d1: D1Database, claim: WhatsAppWebhookClaim, now = new Date().toISOString()) {
  const row = await d1
    .prepare("SELECT 1 AS active FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?")
    .bind(claim.eventHash, claim.attemptCount, now)
    .first<{ active: number }>();
  return Boolean(row);
}

export async function renewWhatsAppWebhookClaim(
  d1: D1Database,
  claim: WhatsAppWebhookClaim,
  now: string,
  leaseMs = WHATSAPP_WEBHOOK_LEASE_MS,
) {
  const result = await d1
    .prepare(
      `UPDATE whatsapp_webhook_events
       SET lease_until=?
       WHERE event_hash=? AND processing_status='processing' AND attempt_count=?
         AND (lease_until IS NULL OR lease_until>?)`,
    )
    .bind(leaseUntil(now, leaseMs), claim.eventHash, claim.attemptCount, now)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function campaignStatusRank(status: string) {
  return { skipped: 0, queued: 1, sending: 1, uncertain: 1, sent: 2, delivered: 3, read: 4, failed: 5 }[status as "skipped" | "queued" | "sending" | "uncertain" | "sent" | "delivered" | "read" | "failed"] ?? -1;
}

export async function refreshWhatsAppCampaignSummary(d1: D1Database, campaignId: string, now: string, claim?: WhatsAppWebhookClaim) {
  const claimCheckAt = new Date().toISOString();
  const claimClause = claim ? " AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : "";
  await d1
    .prepare(
      `UPDATE whatsapp_campaigns AS c
       SET status=CASE WHEN c.status='paused' THEN 'paused' WHEN EXISTS (
             SELECT 1 FROM whatsapp_campaign_recipients AS r
             WHERE r.campaign_id=c.id AND (r.status IN ('queued','sending','uncertain') OR (r.status='failed' AND r.meta_message_id IS NULL))
           ) THEN 'running' ELSE 'completed' END,
           processed=(SELECT COUNT(*) FROM whatsapp_campaign_recipients AS r WHERE r.campaign_id=c.id AND NOT (r.status IN ('queued','sending','uncertain') OR (r.status='failed' AND r.meta_message_id IS NULL))),
           sent=(SELECT COUNT(*) FROM whatsapp_campaign_recipients AS r WHERE r.campaign_id=c.id AND r.status IN ('sent','delivered','read')),
           failed=(SELECT COUNT(*) FROM whatsapp_campaign_recipients AS r WHERE r.campaign_id=c.id AND r.status='failed'),
           finished_at=CASE WHEN c.status='paused' THEN c.finished_at WHEN EXISTS (
             SELECT 1 FROM whatsapp_campaign_recipients AS r
             WHERE r.campaign_id=c.id AND (r.status IN ('queued','sending','uncertain') OR (r.status='failed' AND r.meta_message_id IS NULL))
           ) THEN NULL ELSE ? END,
           updated_at=?
       WHERE c.id=?${claimClause}`,
    )
    .bind(now, now, campaignId, ...(claim ? [claim.eventHash, claim.attemptCount, claimCheckAt] : []))
    .run();
  if (claim && !(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
  return d1
    .prepare(
      `SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status IN ('queued','sending','uncertain') OR (status='failed' AND meta_message_id IS NULL) THEN 1 ELSE 0 END),0) AS active,
          COALESCE(SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END),0) AS sent,
          COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed
       FROM whatsapp_campaign_recipients WHERE campaign_id=?`,
    )
    .bind(campaignId)
    .first<{ total: number; active: number; sent: number; failed: number }>()
    .then((summary) => summary ? { total: Number(summary.total), active: Number(summary.active), processed: Number(summary.total) - Number(summary.active), sent: Number(summary.sent), failed: Number(summary.failed) } : null);
}

async function updateWhatsAppMessageStatusResult(
  d1: D1Database,
  metaMessageId: string,
  incoming: string,
  errors: unknown,
  now: string,
  claim?: WhatsAppWebhookClaim,
): Promise<WhatsAppStatusUpdate> {
  if (!(incoming in whatsappStatusRank)) return "already_applied";
  const existingMessage = await d1.prepare("SELECT status FROM whatsapp_messages WHERE meta_message_id=?").bind(metaMessageId).first<{ status: string }>();
  if (!existingMessage) return "missing";
  const incomingRank = whatsappStatusRank[incoming as keyof typeof whatsappStatusRank];
  const allowedStatuses = incoming === "failed"
    ? whatsappMessageStatuses
    : whatsappMessageStatuses.filter(status => whatsappStatusRank[status] <= incomingRank);
  const error = Array.isArray(errors) ? JSON.stringify(errors).slice(0, 1000) : null;
  const placeholders = allowedStatuses.map(() => "?").join(",");
  const claimCheckAt = new Date().toISOString();
  const claimClause = claim ? " AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : "";
  const result = await d1
    .prepare(
      `UPDATE whatsapp_messages
       SET status=?, error_message=?,
           delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
           read_at=CASE WHEN ?='read' THEN COALESCE(read_at,?) ELSE read_at END,
           failed_at=CASE WHEN ?='failed' THEN COALESCE(failed_at,?) ELSE failed_at END
       WHERE meta_message_id=? AND status IN (${placeholders})${claimClause}`,
    )
    .bind(incoming, error, incoming, now, incoming, now, incoming, now, metaMessageId, ...allowedStatuses, ...(claim ? [claim.eventHash, claim.attemptCount, claimCheckAt] : []))
    .run();
  if (claim && !(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
  return Number(result.meta?.changes ?? 0) === 1 ? "updated" : "already_applied";
}

export async function updateWhatsAppDeliveryStatus(
  d1: D1Database,
  metaMessageId: string,
  incoming: string,
  errors: unknown,
  now: string,
  claim?: WhatsAppWebhookClaim,
  deliveryToken?: string,
): Promise<WhatsAppStatusUpdate> {
  const messageResult = await updateWhatsAppMessageStatusResult(d1, metaMessageId, incoming, errors, now, claim);
  if (messageResult !== "missing") return messageResult;

  if (!(incoming in whatsappStatusRank)) return "already_applied";
  const attempt = await d1
    .prepare(deliveryToken
      ? `SELECT a.id,a.delivery_token,a.status AS attempt_status,r.id AS recipient_id,r.delivery_token AS current_delivery_token,r.campaign_id
         FROM whatsapp_campaign_delivery_attempts AS a
         JOIN whatsapp_campaign_recipients AS r ON r.id=a.recipient_id
         WHERE a.meta_message_id=? OR a.delivery_token=?`
      : `SELECT a.id,a.delivery_token,a.status AS attempt_status,r.id AS recipient_id,r.delivery_token AS current_delivery_token,r.campaign_id
         FROM whatsapp_campaign_delivery_attempts AS a
         JOIN whatsapp_campaign_recipients AS r ON r.id=a.recipient_id
         WHERE a.meta_message_id=?`)
    .bind(...(deliveryToken ? [metaMessageId, deliveryToken] : [metaMessageId]))
    .first<{ id: string; delivery_token: string; attempt_status: string; recipient_id: string; current_delivery_token: string | null; campaign_id: string }>();
  if (attempt) {
    if (attempt.delivery_token !== attempt.current_delivery_token) return "already_applied";
    const allStatuses = ["skipped", "queued", "sending", "uncertain", "sent", "delivered", "read", "failed"];
    const incomingRank = whatsappStatusRank[incoming as keyof typeof whatsappStatusRank];
    const allowedStatuses = incoming === "failed" ? allStatuses : allStatuses.filter((status) => campaignStatusRank(status) <= incomingRank);
    const placeholders = allowedStatuses.map(() => "?").join(",");
    const error = Array.isArray(errors) ? JSON.stringify(errors).slice(0, 1000) : null;
    const claimCheckAt = new Date().toISOString();
    const claimClause = claim ? " AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : "";
    const result = await d1
      .prepare(`UPDATE whatsapp_campaign_recipients
                SET status=?, error=?, meta_message_id=CASE WHEN ?<>'' THEN COALESCE(meta_message_id,?) ELSE meta_message_id END
                WHERE id=? AND delivery_token=? AND status IN (${placeholders})${claimClause}`)
      .bind(incoming, error, metaMessageId, metaMessageId, attempt.recipient_id, attempt.delivery_token, ...allowedStatuses, ...(claim ? [claim.eventHash, claim.attemptCount, claimCheckAt] : []))
      .run();
    await d1
      .prepare(`UPDATE whatsapp_campaign_delivery_attempts
                SET status=?, error=?, meta_message_id=CASE WHEN ?<>'' THEN COALESCE(meta_message_id,?) ELSE meta_message_id END, updated_at=?
                WHERE id=? AND status IN (${placeholders})${claimClause}`)
      .bind(incoming, error, metaMessageId, metaMessageId, now, attempt.id, ...allowedStatuses, ...(claim ? [claim.eventHash, claim.attemptCount, claimCheckAt] : []))
      .run();
    const outcome = Number(result.meta?.changes ?? 0) === 1 ? "updated" : "already_applied";
    await refreshWhatsAppCampaignSummary(d1, attempt.campaign_id, now, claim);
    if (claim && !(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
    return outcome;
  }

  const recipient = await d1
    .prepare(deliveryToken ? "SELECT status,campaign_id FROM whatsapp_campaign_recipients WHERE meta_message_id=? OR delivery_token=?" : "SELECT status,campaign_id FROM whatsapp_campaign_recipients WHERE meta_message_id=?")
    .bind(...(deliveryToken ? [metaMessageId, deliveryToken] : [metaMessageId]))
    .first<{ status: string; campaign_id: string }>();
  if (!recipient) return "missing";
  // A live campaign send has no durable provider id until Meta accepts it. Do
  // not let a callback for an older attempt mutate that in-flight row.
  const allStatuses = deliveryToken ? ["skipped", "queued", "sending", "uncertain", "sent", "delivered", "read", "failed"] : ["skipped", "queued", "uncertain", "sent", "delivered", "read", "failed"];
  const incomingRank = whatsappStatusRank[incoming as keyof typeof whatsappStatusRank];
  const allowedStatuses = incoming === "failed" ? allStatuses : allStatuses.filter((status) => campaignStatusRank(status) <= incomingRank);
  const placeholders = allowedStatuses.map(() => "?").join(",");
  const error = Array.isArray(errors) ? JSON.stringify(errors).slice(0, 1000) : null;
  const claimCheckAt = new Date().toISOString();
  const claimClause = claim ? " AND EXISTS (SELECT 1 FROM whatsapp_webhook_events WHERE event_hash=? AND processing_status='processing' AND attempt_count=? AND lease_until>?)" : "";
  const result = await d1
    .prepare(`UPDATE whatsapp_campaign_recipients SET status=?, error=? WHERE ${deliveryToken ? "(meta_message_id=? OR delivery_token=?)" : "meta_message_id=?"} AND status IN (${placeholders})${claimClause}`)
    .bind(incoming, error, ...(deliveryToken ? [metaMessageId, deliveryToken] : [metaMessageId]), ...allowedStatuses, ...(claim ? [claim.eventHash, claim.attemptCount, claimCheckAt] : []))
    .run();
  const outcome = Number(result.meta?.changes ?? 0) === 1 ? "updated" : "already_applied";
  await refreshWhatsAppCampaignSummary(d1, recipient.campaign_id, now, claim);
  if (claim && !(await webhookClaimIsActive(d1, claim))) throw new Error("WHATSAPP_WEBHOOK_STALE_CLAIM");
  return outcome;
}

export async function updateWhatsAppMessageStatus(d1: D1Database, metaMessageId: string, incoming: string, errors: unknown, now: string) {
  return (await updateWhatsAppMessageStatusResult(d1, metaMessageId, incoming, errors, now)) === "updated";
}

export function whatsappWebhookResponse(status: "completed" | "duplicate" | "in_flight") {
  if (status === "duplicate") return Response.json({ ok: true, duplicate: true });
  if (status === "in_flight") return Response.json({ ok: false, retryable: true }, { status: 500, headers: { "Retry-After": "5" } });
  return Response.json({ ok: true });
}
