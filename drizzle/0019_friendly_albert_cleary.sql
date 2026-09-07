CREATE TABLE `ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`default_provider` text DEFAULT 'openai' NOT NULL,
	`fallback_enabled` integer DEFAULT false NOT NULL,
	`gateway_enabled` integer DEFAULT false NOT NULL,
	`tool_access` text DEFAULT 'read_only' NOT NULL,
	`destructive_actions` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
