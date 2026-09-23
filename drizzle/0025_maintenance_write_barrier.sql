CREATE TABLE `maintenance_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `mode` text NOT NULL CHECK (`mode` IN ('open', 'maintenance')),
  `generation` integer NOT NULL DEFAULT 0,
  `reason` text NOT NULL DEFAULT '',
  `operator_email` text NOT NULL DEFAULT '',
  `activated_at` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `maintenance_state` (`id`, `mode`, `generation`, `reason`, `operator_email`, `activated_at`, `updated_at`)
VALUES (1, 'open', 0, '', '', NULL, CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE `write_leases` (
  `id` text PRIMARY KEY NOT NULL,
  `generation` integer NOT NULL,
  `writer_kind` text NOT NULL,
  `request_id` text NOT NULL,
  `started_at` text NOT NULL,
  `renewed_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `outcome` text
);
--> statement-breakpoint
CREATE INDEX `write_leases_generation_idx` ON `write_leases` (`generation`);
--> statement-breakpoint
CREATE INDEX `write_leases_expiry_idx` ON `write_leases` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `write_leases_writer_kind_idx` ON `write_leases` (`writer_kind`);
