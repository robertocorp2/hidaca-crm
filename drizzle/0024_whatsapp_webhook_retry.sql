ALTER TABLE `whatsapp_webhook_events` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `processing_started_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `whatsapp_campaign_recipients` ADD `delivery_token` text;--> statement-breakpoint
CREATE TABLE `whatsapp_campaign_delivery_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `recipient_id` text NOT NULL,
  `delivery_token` text NOT NULL,
  `meta_message_id` text,
  `status` text NOT NULL,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`recipient_id`) REFERENCES `whatsapp_campaign_recipients`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_campaign_delivery_attempts_token_unique` ON `whatsapp_campaign_delivery_attempts` (`delivery_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_campaign_delivery_attempts_meta_unique` ON `whatsapp_campaign_delivery_attempts` (`meta_message_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_campaign_delivery_attempts_recipient_idx` ON `whatsapp_campaign_delivery_attempts` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_events_processing_idx` ON `whatsapp_webhook_events` (`processing_status`,`lease_until`);--> statement-breakpoint
-- Legacy recipients have no immutable provider-attempt record. Preserve one
-- explicit unreconciled marker so they cannot be mistaken for fully audited
-- sends during retry/reconciliation.
UPDATE `whatsapp_campaign_recipients`
SET delivery_token = 'legacy:' || id || ':' || CASE WHEN attempts > 0 THEN attempts ELSE 1 END,
    status = CASE WHEN attempts > 0 AND meta_message_id IS NULL THEN 'uncertain' WHEN status = 'sending' THEN 'uncertain' ELSE status END,
    error = CASE WHEN attempts > 0 AND meta_message_id IS NULL THEN COALESCE(error, 'Legacy send requires Meta reconciliation') WHEN status = 'sending' THEN COALESCE(error, 'Legacy send requires Meta reconciliation') ELSE error END,
    locked_at = CASE WHEN attempts > 0 AND meta_message_id IS NULL THEN NULL WHEN status = 'sending' THEN NULL ELSE locked_at END
WHERE delivery_token IS NULL AND (attempts > 0 OR meta_message_id IS NOT NULL OR status = 'sending');--> statement-breakpoint
INSERT INTO `whatsapp_campaign_delivery_attempts`
  (id,recipient_id,delivery_token,meta_message_id,status,error,created_at,updated_at)
SELECT 'legacy-attempt:' || r.id,
       r.id,
       r.delivery_token,
       r.meta_message_id,
       CASE WHEN r.meta_message_id IS NULL THEN 'unreconciled' ELSE r.status END,
       r.error,
       r.created_at,
       r.updated_at
FROM `whatsapp_campaign_recipients` AS r
WHERE r.delivery_token IS NOT NULL AND (r.attempts > 0 OR r.meta_message_id IS NOT NULL OR (r.status = 'uncertain' AND r.error = 'Legacy send requires Meta reconciliation'));--> statement-breakpoint
UPDATE `whatsapp_webhook_events`
SET processing_status = 'failed', processed_at = NULL,
    error = COALESCE(error, 'Legacy delivery had no durable completion marker')
WHERE processing_status = 'processed' AND processed_at IS NULL;--> statement-breakpoint
UPDATE `whatsapp_webhook_events`
SET processing_status = 'processed', processed_at = COALESCE(processed_at, received_at),
    error = COALESCE(error, 'Legacy ignored delivery preserved as a no-op')
WHERE processing_status = 'ignored';--> statement-breakpoint
UPDATE `whatsapp_conversations` AS c
SET unread_count = CASE WHEN unread_count <
    (SELECT COUNT(*)
     FROM `whatsapp_messages` AS m
     WHERE m.conversation_id = c.id
       AND m.direction = 'inbound'
       AND m.created_at > COALESCE((SELECT MAX(r.last_read_at) FROM `whatsapp_conversation_reads` AS r WHERE r.conversation_id = c.id), ''))
  THEN (SELECT COUNT(*)
        FROM `whatsapp_messages` AS m
        WHERE m.conversation_id = c.id
          AND m.direction = 'inbound'
          AND m.created_at > COALESCE((SELECT MAX(r.last_read_at) FROM `whatsapp_conversation_reads` AS r WHERE r.conversation_id = c.id), ''))
  ELSE unread_count END
WHERE EXISTS (
  SELECT 1
  FROM `whatsapp_messages` AS m
  JOIN `whatsapp_webhook_events` AS e ON (e.meta_message_id IS NOT NULL AND e.meta_message_id = m.meta_message_id)
    OR (e.meta_message_id IS NULL AND e.received_at = m.created_at
      AND (SELECT COUNT(*) FROM `whatsapp_webhook_events` AS e2 WHERE e2.processing_status = 'failed' AND e2.meta_message_id IS NULL AND e2.received_at = e.received_at) = 1)
  WHERE m.conversation_id = c.id
    AND m.direction = 'inbound'
    AND e.processing_status = 'failed'
);--> statement-breakpoint
CREATE TRIGGER `whatsapp_messages_inbound_unread_after_insert`
AFTER INSERT ON `whatsapp_messages`
WHEN NEW.direction = 'inbound'
BEGIN
  UPDATE `whatsapp_conversations`
  SET unread_count = unread_count + 1
  WHERE id = NEW.conversation_id;
END;
