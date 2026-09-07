ALTER TABLE `import_files` ADD `extracted_object_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_files` ADD `extracted_size` integer DEFAULT 0 NOT NULL;