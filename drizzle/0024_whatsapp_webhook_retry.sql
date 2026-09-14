ALTER TABLE `whatsapp_webhook_events` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `processing_started_at` text;--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_events` ADD `lease_until` text;--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_events_processing_idx` ON `whatsapp_webhook_events` (`processing_status`,`lease_until`);--> statement-breakpoint
CREATE TRIGGER `whatsapp_messages_inbound_unread_after_insert`
AFTER INSERT ON `whatsapp_messages`
WHEN NEW.direction = 'inbound'
BEGIN
  UPDATE `whatsapp_conversations`
  SET unread_count = unread_count + 1
  WHERE id = NEW.conversation_id;
END;
