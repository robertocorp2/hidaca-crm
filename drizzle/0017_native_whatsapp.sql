CREATE TABLE `whatsapp_campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`contact_id` text,
	`lead_id` text,
	`phone` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`meta_message_id` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `whatsapp_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_campaign_recipients_phone_unique` ON `whatsapp_campaign_recipients` (`campaign_id`,`phone`);--> statement-breakpoint
CREATE INDEX `whatsapp_campaign_recipients_queue_idx` ON `whatsapp_campaign_recipients` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `whatsapp_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`template_id` text NOT NULL,
	`template_name` text NOT NULL,
	`template_language` text NOT NULL,
	`audience_filter` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `whatsapp_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `whatsapp_conversation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `whatsapp_conversation_events_idx` ON `whatsapp_conversation_events` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `whatsapp_conversation_reads` (
	`conversation_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`last_read_message_id` text,
	`last_read_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `whatsapp_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number_id` text NOT NULL,
	`wa_id` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`profile_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_user_id` integer,
	`business_id` text,
	`contact_id` text,
	`lead_id` text,
	`opportunity_id` text,
	`service_window_expires_at` text,
	`last_inbound_at` text,
	`last_message_at` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`match_state` text DEFAULT 'unmatched' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_conversations_phone_wa_unique` ON `whatsapp_conversations` (`phone_number_id`,`wa_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_conversations_status_idx` ON `whatsapp_conversations` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_conversations_assigned_idx` ON `whatsapp_conversations` (`assigned_user_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`meta_message_id` text,
	`direction` text NOT NULL,
	`type` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error_code` text,
	`error_message` text,
	`media_id` text,
	`media_key` text,
	`content_type` text,
	`file_name` text,
	`size` integer,
	`template_name` text,
	`template_language` text,
	`reply_to_id` text,
	`sent_by` text,
	`campaign_recipient_id` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	`delivered_at` text,
	`read_at` text,
	`failed_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_messages_meta_unique` ON `whatsapp_messages` (`meta_message_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_conversation_idx` ON `whatsapp_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_status_idx` ON `whatsapp_messages` (`status`);--> statement-breakpoint
CREATE TABLE `whatsapp_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`meta_id` text,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`category` text DEFAULT 'UTILITY' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`quality` text,
	`components` text DEFAULT '[]' NOT NULL,
	`synced_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_templates_name_language_unique` ON `whatsapp_templates` (`name`,`language`);--> statement-breakpoint
CREATE INDEX `whatsapp_templates_status_idx` ON `whatsapp_templates` (`status`);--> statement-breakpoint
CREATE TABLE `whatsapp_webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_hash` text NOT NULL,
	`event_type` text NOT NULL,
	`meta_message_id` text,
	`processing_status` text NOT NULL,
	`error` text,
	`received_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_webhook_events_hash_unique` ON `whatsapp_webhook_events` (`event_hash`);--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_events_received_idx` ON `whatsapp_webhook_events` (`received_at`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `whatsapp_consent` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `whatsapp_consent_at` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `whatsapp_consent_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `whatsapp_consent` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `whatsapp_consent_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `whatsapp_consent_source` text DEFAULT '' NOT NULL;