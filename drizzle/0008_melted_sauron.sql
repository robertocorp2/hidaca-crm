ALTER TABLE `credit_notes` ADD `import_batch_id` text REFERENCES import_batches(id);--> statement-breakpoint
CREATE INDEX `credit_notes_import_batch_idx` ON `credit_notes` (`import_batch_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `import_batch_id` text REFERENCES import_batches(id);--> statement-breakpoint
CREATE INDEX `invoices_import_batch_idx` ON `invoices` (`import_batch_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `import_batch_id` text REFERENCES import_batches(id);--> statement-breakpoint
CREATE INDEX `payments_import_batch_idx` ON `payments` (`import_batch_id`);