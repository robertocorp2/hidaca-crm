ALTER TABLE `whatsapp_webhook_events` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `processing_started_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `lease_until` text;--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_events_processing_idx` ON `whatsapp_webhook_events` (`processing_status`,`lease_until`);--> statement-breakpoint
UPDATE `whatsapp_webhook_events`
SET processing_status = 'failed', processed_at = NULL,
    error = COALESCE(error, 'Legacy delivery had no durable completion marker')
WHERE processing_status = 'processed' AND processed_at IS NULL;--> statement-breakpoint
UPDATE `whatsapp_webhook_events`
SET processing_status = 'processed', processed_at = COALESCE(processed_at, received_at),
    error = COALESCE(error, 'Legacy ignored delivery preserved as a no-op')
WHERE processing_status = 'ignored';--> statement-breakpoint
CREATE TRIGGER `whatsapp_messages_inbound_unread_after_insert`
AFTER INSERT ON `whatsapp_messages`
WHEN NEW.direction = 'inbound'
BEGIN
  UPDATE `whatsapp_conversations`
  SET unread_count = unread_count + 1
  WHERE id = NEW.conversation_id;
END;
