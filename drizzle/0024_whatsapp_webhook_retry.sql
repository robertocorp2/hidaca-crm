ALTER TABLE `whatsapp_webhook_events` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `processing_started_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `whatsapp_campaign_recipients` ADD `delivery_token` text;--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_events_processing_idx` ON `whatsapp_webhook_events` (`processing_status`,`lease_until`);--> statement-breakpoint
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
