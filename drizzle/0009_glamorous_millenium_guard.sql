ALTER TABLE `payments` ADD `legacy_record_id` text REFERENCES business_records(id);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_legacy_record_unique` ON `payments` (`legacy_record_id`);--> statement-breakpoint
CREATE INDEX `payments_legacy_idx` ON `payments` (`legacy_record_id`);