CREATE TABLE `import_batch_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`origin_label` text NOT NULL,
	`source_workbook_name` text DEFAULT '' NOT NULL,
	`expected_rows` integer DEFAULT 0 NOT NULL,
	`expected_links` integer DEFAULT 0 NOT NULL,
	`discovered_rows` integer DEFAULT 0 NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`matched_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`review_rows` integer DEFAULT 0 NOT NULL,
	`failed_rows` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batch_sources_origin_unique` ON `import_batch_sources` (`batch_id`,`origin_label`);--> statement-breakpoint
CREATE INDEX `import_batch_sources_batch_idx` ON `import_batch_sources` (`batch_id`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_file_id` text NOT NULL,
	`worksheet_name` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`row_fingerprint` text NOT NULL,
	`raw_values` text DEFAULT '{}' NOT NULL,
	`normalized_values` text DEFAULT '{}' NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`match_confidence` text DEFAULT 'manual_review' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`source_filename` text DEFAULT '' NOT NULL,
	`source_document_uri` text DEFAULT '' NOT NULL,
	`source_origin` text DEFAULT '' NOT NULL,
	`business_id` text,
	`contact_id` text,
	`project_id` text,
	`quotation_id` text,
	`revision_id` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`accepted_by` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`import_file_id`) REFERENCES `import_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_source_unique` ON `import_rows` (`import_file_id`,`worksheet_name`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `import_rows_file_outcome_idx` ON `import_rows` (`import_file_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `import_rows_fingerprint_idx` ON `import_rows` (`row_fingerprint`);--> statement-breakpoint
CREATE INDEX `import_rows_origin_idx` ON `import_rows` (`source_origin`);--> statement-breakpoint
CREATE INDEX `import_rows_business_idx` ON `import_rows` (`business_id`);--> statement-breakpoint
CREATE INDEX `import_rows_quotation_idx` ON `import_rows` (`quotation_id`);--> statement-breakpoint
CREATE TABLE `project_contacts` (
	`project_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `contact_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_contacts_contact_idx` ON `project_contacts` (`contact_id`);--> statement-breakpoint
CREATE INDEX `project_contacts_primary_idx` ON `project_contacts` (`project_id`,`is_primary`);--> statement-breakpoint
CREATE TABLE `project_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`address_id` text,
	`label` text DEFAULT '' NOT NULL,
	`building` text DEFAULT '' NOT NULL,
	`apartment` text DEFAULT '' NOT NULL,
	`floor` text DEFAULT '' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`room` text DEFAULT '' NOT NULL,
	`balcony` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`address_id`) REFERENCES `addresses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_locations_project_idx` ON `project_locations` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_locations_address_idx` ON `project_locations` (`address_id`);--> statement-breakpoint
CREATE INDEX `project_locations_building_idx` ON `project_locations` (`building`);--> statement-breakpoint
CREATE TABLE `source_references` (
	`id` text PRIMARY KEY NOT NULL,
	`import_row_id` text,
	`revision_id` text,
	`document_id` text,
	`original_filename` text DEFAULT '' NOT NULL,
	`original_uri` text DEFAULT '' NOT NULL,
	`uri_scheme` text DEFAULT 'none' NOT NULL,
	`availability` text DEFAULT 'unresolved' NOT NULL,
	`source_origin` text DEFAULT '' NOT NULL,
	`file_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `source_references_row_idx` ON `source_references` (`import_row_id`);--> statement-breakpoint
CREATE INDEX `source_references_revision_idx` ON `source_references` (`revision_id`);--> statement-breakpoint
CREATE INDEX `source_references_document_idx` ON `source_references` (`document_id`);--> statement-breakpoint
CREATE INDEX `source_references_filename_idx` ON `source_references` (`original_filename`);--> statement-breakpoint
CREATE INDEX `source_references_origin_idx` ON `source_references` (`source_origin`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `source_filename` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `source_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `dry_run` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `total_rows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `matched_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `duplicate_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `unmapped_field_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `summary_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `import_batches_hash_idx` ON `import_batches` (`source_hash`);--> statement-breakpoint
ALTER TABLE `import_candidates` ADD `import_row_id` text REFERENCES import_rows(id);--> statement-breakpoint
CREATE INDEX `import_candidates_row_idx` ON `import_candidates` (`import_row_id`,`candidate_type`,`score`);--> statement-breakpoint
ALTER TABLE `import_issues` ADD `import_row_id` text REFERENCES import_rows(id);--> statement-breakpoint
CREATE INDEX `import_issues_row_idx` ON `import_issues` (`import_row_id`,`status`);--> statement-breakpoint
ALTER TABLE `projects` ADD `project_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `source_metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `projects_type_idx` ON `projects` (`project_type`);--> statement-breakpoint
ALTER TABLE `quotation_revisions` ADD `quotation_month` integer;--> statement-breakpoint
ALTER TABLE `quotation_revisions` ADD `source_month_raw` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotation_revisions` ADD `source_year_raw` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `quotation_revisions_month_idx` ON `quotation_revisions` (`quotation_month`);--> statement-breakpoint
ALTER TABLE `quotations` ADD `normalized_quotation_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotations` ADD `family_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotations` ADD `source_metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `quotations_family_idx` ON `quotations` (`family_key`,`business_id`);--> statement-breakpoint
CREATE INDEX `quotations_normalized_number_idx` ON `quotations` (`normalized_quotation_number`);--> statement-breakpoint
ALTER TABLE `source_field_values` ADD `import_row_id` text REFERENCES import_rows(id);--> statement-breakpoint
ALTER TABLE `source_field_values` ADD `source_row_number` integer;--> statement-breakpoint
CREATE INDEX `source_field_values_row_idx` ON `source_field_values` (`import_row_id`,`source_row_number`);