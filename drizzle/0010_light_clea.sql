ALTER TABLE `receivable_snapshots` ADD `reversed_at` text;--> statement-breakpoint
ALTER TABLE `receivable_snapshots` ADD `reversal_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `receivable_snapshots_reversed_idx` ON `receivable_snapshots` (`reversed_at`);