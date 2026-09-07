CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`contact_id` text,
	`project_id` text,
	`type` text DEFAULT 'other' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`line1` text NOT NULL,
	`line2` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`country` text DEFAULT 'República Dominicana' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`source_metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `addresses_business_idx` ON `addresses` (`business_id`,`type`);--> statement-breakpoint
CREATE INDEX `addresses_contact_idx` ON `addresses` (`contact_id`);--> statement-breakpoint
CREATE INDEX `addresses_project_idx` ON `addresses` (`project_id`);--> statement-breakpoint
CREATE TABLE `company_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`rnc` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`brand_division` text DEFAULT '' NOT NULL,
	`sales_representative` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`default_payment_terms` text DEFAULT '' NOT NULL,
	`default_quotation_validity` text DEFAULT '' NOT NULL,
	`default_warranty` text DEFAULT '' NOT NULL,
	`default_observations` text DEFAULT '' NOT NULL,
	`default_policies` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_links` (
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`purpose` text DEFAULT 'attachment' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`document_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_links_entity_idx` ON `document_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `entity_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`field_name` text DEFAULT '' NOT NULL,
	`previous_value` text DEFAULT '' NOT NULL,
	`new_value` text DEFAULT '' NOT NULL,
	`source_document_id` text,
	`actor_email` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_history_entity_idx` ON `entity_history` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entity_history_source_idx` ON `entity_history` (`source_document_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`successful_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `import_batches_status_idx` ON `import_batches` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`import_file_id` text NOT NULL,
	`candidate_type` text NOT NULL,
	`candidate_entity_id` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	FOREIGN KEY (`import_file_id`) REFERENCES `import_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_candidates_file_idx` ON `import_candidates` (`import_file_id`,`candidate_type`,`score`);--> statement-breakpoint
CREATE INDEX `import_candidates_entity_idx` ON `import_candidates` (`candidate_type`,`candidate_entity_id`);--> statement-breakpoint
CREATE TABLE `import_files` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`document_id` text NOT NULL,
	`filename` text NOT NULL,
	`extension` text NOT NULL,
	`source_path` text DEFAULT '' NOT NULL,
	`sha256` text NOT NULL,
	`parser_name` text DEFAULT '' NOT NULL,
	`parser_version` text DEFAULT '' NOT NULL,
	`template_type` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw_extracted_data` text DEFAULT '{}' NOT NULL,
	`normalized_preview` text DEFAULT '{}' NOT NULL,
	`canonical_links` text DEFAULT '{}' NOT NULL,
	`imported_by` text NOT NULL,
	`imported_at` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`accepted_by` text,
	`accepted_at` text,
	`error_message` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_files_batch_idx` ON `import_files` (`batch_id`,`status`);--> statement-breakpoint
CREATE INDEX `import_files_hash_idx` ON `import_files` (`sha256`);--> statement-breakpoint
CREATE INDEX `import_files_status_idx` ON `import_files` (`status`,`imported_at`);--> statement-breakpoint
CREATE INDEX `import_files_template_idx` ON `import_files` (`template_type`);--> statement-breakpoint
CREATE INDEX `import_files_filename_idx` ON `import_files` (`filename`);--> statement-breakpoint
CREATE TABLE `import_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`import_file_id` text NOT NULL,
	`source_field_value_id` text,
	`type` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`source_location` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`import_file_id`) REFERENCES `import_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_field_value_id`) REFERENCES `source_field_values`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_issues_file_idx` ON `import_issues` (`import_file_id`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `import_issues_type_idx` ON `import_issues` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `manufacturing_worksheets` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`source_document_id` text,
	`name` text NOT NULL,
	`worksheet_type` text DEFAULT 'production' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`calculation_status` text DEFAULT 'not_calculated' NOT NULL,
	`source_formula_summary` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `manufacturing_worksheets_revision_idx` ON `manufacturing_worksheets` (`revision_id`);--> statement-breakpoint
CREATE INDEX `manufacturing_worksheets_document_idx` ON `manufacturing_worksheets` (`source_document_id`);--> statement-breakpoint
CREATE INDEX `manufacturing_worksheets_status_idx` ON `manufacturing_worksheets` (`calculation_status`);--> statement-breakpoint
CREATE TABLE `material_components` (
	`id` text PRIMARY KEY NOT NULL,
	`worksheet_id` text NOT NULL,
	`line_item_id` text,
	`component_type` text DEFAULT 'other' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`quantity` real,
	`unit_of_measure` text DEFAULT '' NOT NULL,
	`width_cm` real,
	`height_cm` real,
	`unit_cost` real,
	`total_cost` real,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`source_formula` text DEFAULT '' NOT NULL,
	`formula_result` text DEFAULT '' NOT NULL,
	`formula_status` text DEFAULT 'not_calculated' NOT NULL,
	`value_states` text DEFAULT '{}' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`worksheet_id`) REFERENCES `manufacturing_worksheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_item_id`) REFERENCES `quotation_line_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `material_components_worksheet_idx` ON `material_components` (`worksheet_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `material_components_line_idx` ON `material_components` (`line_item_id`);--> statement-breakpoint
CREATE INDEX `material_components_type_idx` ON `material_components` (`component_type`);--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`line_item_id` text,
	`project_id` text,
	`location` text DEFAULT '' NOT NULL,
	`building` text DEFAULT '' NOT NULL,
	`apartment` text DEFAULT '' NOT NULL,
	`floor` text DEFAULT '' NOT NULL,
	`level` text DEFAULT '' NOT NULL,
	`room` text DEFAULT '' NOT NULL,
	`area_label` text DEFAULT '' NOT NULL,
	`opening_width_cm` real,
	`opening_height_cm` real,
	`finished_width_cm` real,
	`finished_height_cm` real,
	`area_sqm` real,
	`quantity` real,
	`value_states` text DEFAULT '{}' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_item_id`) REFERENCES `quotation_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `measurements_revision_idx` ON `measurements` (`revision_id`);--> statement-breakpoint
CREATE INDEX `measurements_line_item_idx` ON `measurements` (`line_item_id`);--> statement-breakpoint
CREATE INDEX `measurements_project_idx` ON `measurements` (`project_id`);--> statement-breakpoint
CREATE INDEX `measurements_location_idx` ON `measurements` (`location`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`project_id` text,
	`revision_id` text,
	`source_document_id` text,
	`type` text DEFAULT 'partial' NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`payment_date` text,
	`method` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`installment_number` integer,
	`installment_reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`value_states` text DEFAULT '{}' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`source_location` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_business_idx` ON `payments` (`business_id`,`payment_date`);--> statement-breakpoint
CREATE INDEX `payments_project_idx` ON `payments` (`project_id`);--> statement-breakpoint
CREATE INDEX `payments_revision_idx` ON `payments` (`revision_id`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_date_idx` ON `payments` (`payment_date`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_record_id` text,
	`business_id` text NOT NULL,
	`primary_contact_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`service_category` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`owner_email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`legacy_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_legacy_record_unique` ON `projects` (`legacy_record_id`);--> statement-breakpoint
CREATE INDEX `projects_business_idx` ON `projects` (`business_id`);--> statement-breakpoint
CREATE INDEX `projects_contact_idx` ON `projects` (`primary_contact_id`);--> statement-breakpoint
CREATE INDEX `projects_name_idx` ON `projects` (`name`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `projects_updated_idx` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `quotation_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`source_amount` real,
	`calculated_amount` real,
	`rate` real,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`value_state` text DEFAULT 'blank' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quotation_charges_revision_idx` ON `quotation_charges` (`revision_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `quotation_charges_type_idx` ON `quotation_charges` (`type`);--> statement-breakpoint
CREATE TABLE `quotation_financials` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`source_subtotal` real,
	`calculated_subtotal` real,
	`discount_rate` real,
	`discount_amount` real,
	`discount_reason` text DEFAULT '' NOT NULL,
	`source_subtotal_after_discount` real,
	`calculated_subtotal_after_discount` real,
	`source_tax_rate` real,
	`source_tax_amount` real,
	`calculated_tax_amount` real,
	`tax_name` text DEFAULT '' NOT NULL,
	`tax_exempt` integer,
	`source_total` real,
	`calculated_total` real,
	`source_total_dop` real,
	`source_total_usd` real,
	`exchange_rate` real,
	`amount_paid` real,
	`remaining_balance` real,
	`payment_status` text DEFAULT 'unknown' NOT NULL,
	`discrepancy_amount` real,
	`value_states` text DEFAULT '{}' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`validated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotation_financials_revision_unique` ON `quotation_financials` (`revision_id`);--> statement-breakpoint
CREATE INDEX `quotation_financials_status_idx` ON `quotation_financials` (`payment_status`);--> statement-breakpoint
CREATE INDEX `quotation_financials_total_idx` ON `quotation_financials` (`currency`,`source_total`);--> statement-breakpoint
CREATE TABLE `quotation_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`section_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`item_code` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`product` text DEFAULT '' NOT NULL,
	`service` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`quantity` real,
	`unit_of_measure` text DEFAULT '' NOT NULL,
	`meters` real,
	`opening_width_cm` real,
	`opening_height_cm` real,
	`finished_width_cm` real,
	`finished_height_cm` real,
	`area_sqm` real,
	`price_basis` text,
	`unit_price` real,
	`price_per_sqm` real,
	`flat_fee` real,
	`discount_amount` real,
	`tax_amount` real,
	`source_line_total` real,
	`calculated_line_total` real,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`motor_type` text DEFAULT '' NOT NULL,
	`control_type` text DEFAULT '' NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`value_states` text DEFAULT '{}' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `quotation_sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quotation_line_items_revision_idx` ON `quotation_line_items` (`revision_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `quotation_line_items_section_idx` ON `quotation_line_items` (`section_id`);--> statement-breakpoint
CREATE INDEX `quotation_line_items_code_idx` ON `quotation_line_items` (`item_code`);--> statement-breakpoint
CREATE INDEX `quotation_line_items_category_idx` ON `quotation_line_items` (`category`);--> statement-breakpoint
CREATE TABLE `quotation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`quotation_id` text NOT NULL,
	`parent_revision_id` text,
	`identity_key` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`revision_label` text DEFAULT '' NOT NULL,
	`alternative_label` text DEFAULT '' NOT NULL,
	`scope_label` text DEFAULT '' NOT NULL,
	`quotation_date` text,
	`source_date_raw` text DEFAULT '' NOT NULL,
	`validity_until` text,
	`is_current` integer DEFAULT true NOT NULL,
	`customer_facing_notes` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`source_metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotation_revisions_identity_unique` ON `quotation_revisions` (`quotation_id`,`identity_key`);--> statement-breakpoint
CREATE INDEX `quotation_revisions_quote_idx` ON `quotation_revisions` (`quotation_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `quotation_revisions_parent_idx` ON `quotation_revisions` (`parent_revision_id`);--> statement-breakpoint
CREATE INDEX `quotation_revisions_date_idx` ON `quotation_revisions` (`quotation_date`);--> statement-breakpoint
CREATE INDEX `quotation_revisions_current_idx` ON `quotation_revisions` (`quotation_id`,`is_current`);--> statement-breakpoint
CREATE TABLE `quotation_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quotation_sections_revision_idx` ON `quotation_sections` (`revision_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `quotation_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`quotation_validity` text DEFAULT '' NOT NULL,
	`payment_conditions` text DEFAULT '' NOT NULL,
	`warranty` text DEFAULT '' NOT NULL,
	`return_policy` text DEFAULT '' NOT NULL,
	`installation_observations` text DEFAULT '' NOT NULL,
	`maintenance_disclaimer` text DEFAULT '' NOT NULL,
	`unforeseen_parts_disclaimer` text DEFAULT '' NOT NULL,
	`additional_cost_notice` text DEFAULT '' NOT NULL,
	`original_spanish_text` text DEFAULT '' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quotation_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotation_terms_revision_unique` ON `quotation_terms` (`revision_id`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_record_id` text,
	`business_id` text NOT NULL,
	`primary_contact_id` text,
	`project_id` text,
	`opportunity_id` text,
	`quotation_number` text NOT NULL,
	`quotation_year` integer,
	`title` text NOT NULL,
	`quotation_type` text DEFAULT 'other' NOT NULL,
	`service_category` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`owner_email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`legacy_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_legacy_record_unique` ON `quotations` (`legacy_record_id`);--> statement-breakpoint
CREATE INDEX `quotations_number_year_idx` ON `quotations` (`quotation_number`,`quotation_year`);--> statement-breakpoint
CREATE INDEX `quotations_business_idx` ON `quotations` (`business_id`);--> statement-breakpoint
CREATE INDEX `quotations_contact_idx` ON `quotations` (`primary_contact_id`);--> statement-breakpoint
CREATE INDEX `quotations_project_idx` ON `quotations` (`project_id`);--> statement-breakpoint
CREATE INDEX `quotations_opportunity_idx` ON `quotations` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `quotations_status_idx` ON `quotations` (`status`);--> statement-breakpoint
CREATE INDEX `quotations_type_idx` ON `quotations` (`quotation_type`);--> statement-breakpoint
CREATE INDEX `quotations_updated_idx` ON `quotations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `source_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`import_file_id` text NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_page` integer,
	`source_cell` text DEFAULT '' NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`raw_value` text NOT NULL,
	`display_value` text DEFAULT '' NOT NULL,
	`source_formula` text DEFAULT '' NOT NULL,
	`normalized_value` text DEFAULT '' NOT NULL,
	`canonical_entity` text DEFAULT '' NOT NULL,
	`canonical_field` text DEFAULT '' NOT NULL,
	`transformation` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'manual_review' NOT NULL,
	`value_state` text DEFAULT 'value' NOT NULL,
	`mapping_status` text DEFAULT 'unmapped' NOT NULL,
	`corrected_by` text,
	`corrected_at` text,
	FOREIGN KEY (`import_file_id`) REFERENCES `import_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_field_values_file_idx` ON `source_field_values` (`import_file_id`);--> statement-breakpoint
CREATE INDEX `source_field_values_mapping_idx` ON `source_field_values` (`mapping_status`,`confidence`);--> statement-breakpoint
CREATE INDEX `source_field_values_target_idx` ON `source_field_values` (`canonical_entity`,`canonical_field`);--> statement-breakpoint
CREATE INDEX `source_field_values_label_idx` ON `source_field_values` (`source_label`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `customer_type` text DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `rnc` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `normalized_rnc` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `mobile_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `source_metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `businesses_rnc_idx` ON `businesses` (`normalized_rnc`);--> statement-breakpoint
CREATE INDEX `businesses_type_idx` ON `businesses` (`customer_type`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `mobile_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `normalized_mobile_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `source_metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `contacts_mobile_idx` ON `contacts` (`normalized_mobile_phone`);--> statement-breakpoint
ALTER TABLE `documents` ADD `extension` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `document_role` text DEFAULT 'attachment' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `parser_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `parsing_status` text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `imported_at` text;--> statement-breakpoint
CREATE INDEX `documents_record_idx` ON `documents` (`record_id`);--> statement-breakpoint
CREATE INDEX `documents_hash_idx` ON `documents` (`sha256`);--> statement-breakpoint
CREATE INDEX `documents_imported_idx` ON `documents` (`imported_at`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `opportunities_project_idx` ON `opportunities` (`project_id`);