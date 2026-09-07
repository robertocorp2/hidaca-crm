CREATE TABLE `ai_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`action_type` text NOT NULL,
	`proposed_action` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_approvals_status_idx` ON `ai_approvals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_approvals_requester_idx` ON `ai_approvals` (`requested_by`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`structured` text DEFAULT '{}' NOT NULL,
	`provider` text,
	`model` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_messages_thread_idx` ON `ai_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`transport` text DEFAULT 'direct' NOT NULL,
	`default_model` text DEFAULT '' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`limits` text DEFAULT '{}' NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`last_health_at` text,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_configs_provider_unique` ON `ai_provider_configs` (`provider`);--> statement-breakpoint
CREATE INDEX `ai_provider_configs_enabled_idx` ON `ai_provider_configs` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`actor_email` text NOT NULL,
	`operation` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`transport` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`request_metadata` text DEFAULT '{}' NOT NULL,
	`response_metadata` text DEFAULT '{}' NOT NULL,
	`error_class` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_runs_actor_idx` ON `ai_runs` (`actor_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_status_idx` ON `ai_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_provider_idx` ON `ai_runs` (`provider`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`owner_email` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `ai_threads_owner_idx` ON `ai_threads` (`owner_email`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_threads_entity_idx` ON `ai_threads` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`authorization` text DEFAULT 'approval_required' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_calls_idempotency_unique` ON `ai_tool_calls` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_tool_calls_run_idx` ON `ai_tool_calls` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_events_provider_idx` ON `ai_usage_events` (`provider`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_events_run_idx` ON `ai_usage_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `daily_report_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`document_id` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_report_documents_unique` ON `daily_report_documents` (`report_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `daily_report_documents_report_idx` ON `daily_report_documents` (`report_id`);--> statement-breakpoint
CREATE TABLE `daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`report_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`work_completed` text DEFAULT '' NOT NULL,
	`workers` text DEFAULT '[]' NOT NULL,
	`materials_used` text DEFAULT '[]' NOT NULL,
	`materials_missing` text DEFAULT '[]' NOT NULL,
	`blockers` text DEFAULT '[]' NOT NULL,
	`incidents` text DEFAULT '[]' NOT NULL,
	`client_comments` text DEFAULT '' NOT NULL,
	`next_plan` text DEFAULT '' NOT NULL,
	`original_transcript` text DEFAULT '' NOT NULL,
	`voice_recording_id` text,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voice_recording_id`) REFERENCES `voice_recordings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_reports_project_date_unique` ON `daily_reports` (`project_id`,`report_date`);--> statement-breakpoint
CREATE INDEX `daily_reports_project_status_idx` ON `daily_reports` (`project_id`,`status`,`report_date`);--> statement-breakpoint
CREATE INDEX `daily_reports_voice_idx` ON `daily_reports` (`voice_recording_id`);--> statement-breakpoint
CREATE TABLE `record_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`original_text` text DEFAULT '' NOT NULL,
	`cleaned_text` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`voice_recording_id` text,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`voice_recording_id`) REFERENCES `voice_recordings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `record_notes_entity_idx` ON `record_notes` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `record_notes_voice_idx` ON `record_notes` (`voice_recording_id`);--> statement-breakpoint
CREATE TABLE `voice_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`duration_seconds` real,
	`language` text DEFAULT 'es' NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`retention_until` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `voice_recordings_entity_idx` ON `voice_recordings` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `voice_recordings_status_idx` ON `voice_recordings` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `voice_recordings_retention_idx` ON `voice_recordings` (`retention_until`);--> statement-breakpoint
CREATE TABLE `voice_transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`original_text` text DEFAULT '' NOT NULL,
	`cleaned_text` text DEFAULT '' NOT NULL,
	`structured_payload` text DEFAULT '{}' NOT NULL,
	`confidence` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `voice_recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_transcriptions_recording_unique` ON `voice_transcriptions` (`recording_id`);--> statement-breakpoint
CREATE INDEX `voice_transcriptions_status_idx` ON `voice_transcriptions` (`status`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role`, `module`, `action`, `allowed`) VALUES
  ('admin', 'ai', 'view', 1), ('admin', 'ai', 'create', 1), ('admin', 'ai', 'edit', 1), ('admin', 'ai', 'delete', 1), ('admin', 'ai', 'administer', 1),
  ('operator', 'ai', 'view', 1), ('operator', 'ai', 'create', 1), ('operator', 'ai', 'edit', 1), ('operator', 'ai', 'delete', 0), ('operator', 'ai', 'administer', 0),
  ('viewer', 'ai', 'view', 1), ('viewer', 'ai', 'create', 0), ('viewer', 'ai', 'edit', 0), ('viewer', 'ai', 'delete', 0), ('viewer', 'ai', 'administer', 0);
