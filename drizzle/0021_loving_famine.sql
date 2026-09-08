CREATE TABLE `ai_daily_brief_items` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`item_key` text NOT NULL,
	`section` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`priority_score` integer DEFAULT 0 NOT NULL,
	`suggested_action` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`dismissed_by` text,
	`dismissed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `ai_daily_briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_daily_brief_items_key_unique` ON `ai_daily_brief_items` (`brief_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `ai_daily_brief_items_brief_idx` ON `ai_daily_brief_items` (`brief_id`,`status`,`priority_score`);--> statement-breakpoint
CREATE INDEX `ai_daily_brief_items_entity_idx` ON `ai_daily_brief_items` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `ai_daily_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`brief_date` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`facts_json` text DEFAULT '{}' NOT NULL,
	`provider` text DEFAULT 'deterministic' NOT NULL,
	`model` text DEFAULT 'rules-v1' NOT NULL,
	`ai_run_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_daily_briefs_owner_date_unique` ON `ai_daily_briefs` (`owner_email`,`brief_date`);--> statement-breakpoint
CREATE INDEX `ai_daily_briefs_owner_idx` ON `ai_daily_briefs` (`owner_email`,`updated_at`);--> statement-breakpoint
ALTER TABLE `ai_approvals` ADD `idempotency_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_approvals` ADD `execution_result` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_approvals_idempotency_unique` ON `ai_approvals` (`idempotency_key`) WHERE "ai_approvals"."idempotency_key" <> '';