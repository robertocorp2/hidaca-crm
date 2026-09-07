CREATE TABLE `collection_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`business_id` text NOT NULL,
	`contact_id` text,
	`activity_type` text DEFAULT 'note' NOT NULL,
	`occurred_at` text NOT NULL,
	`next_action_at` text,
	`owner_email` text NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`promised_amount` real,
	`promised_date` text,
	`notes` text DEFAULT '' NOT NULL,
	`source_document_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collection_activities_type_check" CHECK("collection_activities"."activity_type" in ('call', 'email', 'visit', 'promise_to_pay', 'dispute', 'note', 'other'))
);
--> statement-breakpoint
CREATE INDEX `collection_activities_invoice_idx` ON `collection_activities` (`invoice_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `collection_activities_owner_next_idx` ON `collection_activities` (`owner_email`,`next_action_at`);--> statement-breakpoint
CREATE INDEX `collection_activities_type_idx` ON `collection_activities` (`activity_type`);--> statement-breakpoint
CREATE INDEX `collection_activities_business_idx` ON `collection_activities` (`business_id`);--> statement-breakpoint
CREATE TABLE `credit_note_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount` real NOT NULL,
	`application_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`reversal_of_id` text,
	`source_document_id` text,
	`import_batch_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `credit_note_applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "credit_note_applications_amount_check" CHECK("credit_note_applications"."amount" > 0),
	CONSTRAINT "credit_note_applications_status_check" CHECK("credit_note_applications"."status" in ('draft', 'applied', 'reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_applications_identity_unique` ON `credit_note_applications` (`credit_note_id`,`invoice_id`,`amount`,`application_date`,`import_batch_id`);--> statement-breakpoint
CREATE INDEX `credit_note_applications_note_idx` ON `credit_note_applications` (`credit_note_id`,`status`);--> statement-breakpoint
CREATE INDEX `credit_note_applications_invoice_idx` ON `credit_note_applications` (`invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `credit_note_applications_batch_idx` ON `credit_note_applications` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `credit_note_applications_reversal_idx` ON `credit_note_applications` (`reversal_of_id`);--> statement-breakpoint
CREATE TABLE `credit_note_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_service_id` text,
	`item_code` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`quantity` real,
	`width_cm` real,
	`height_cm` real,
	`area_sqm` real,
	`unit_of_measure` text DEFAULT '' NOT NULL,
	`unit_price` real,
	`line_subtotal` real,
	`discount_amount` real,
	`tax_amount` real,
	`line_total` real,
	`tax_configuration_id` text,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`source_formula` text DEFAULT '' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`value_states` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_service_id`) REFERENCES `products_services`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tax_configuration_id`) REFERENCES `tax_configurations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_note_lines_line_number_check" CHECK("credit_note_lines"."line_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_lines_note_number_unique` ON `credit_note_lines` (`credit_note_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `credit_note_lines_note_idx` ON `credit_note_lines` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_note_lines_product_idx` ON `credit_note_lines` (`product_service_id`);--> statement-breakpoint
CREATE INDEX `credit_note_lines_tax_idx` ON `credit_note_lines` (`tax_configuration_id`);--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`source_document_id` text,
	`credit_note_number_raw` text NOT NULL,
	`credit_note_number_normalized` text NOT NULL,
	`ncf_raw` text DEFAULT '' NOT NULL,
	`ncf_normalized` text DEFAULT '' NOT NULL,
	`issue_date` text,
	`issue_date_raw` text DEFAULT '' NOT NULL,
	`issue_year` integer,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`subtotal_amount` real,
	`tax_amount` real,
	`total_amount` real,
	`status` text DEFAULT 'unknown' NOT NULL,
	`source_authority` text DEFAULT 'issued_document' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_notes_status_check" CHECK("credit_notes"."status" in ('issued', 'applied', 'void', 'unknown')),
	CONSTRAINT "credit_notes_source_authority_check" CHECK("credit_notes"."source_authority" in ('issued_document', 'matrix', 'manual_resolution'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_notes_ncf_unique` ON `credit_notes` (`ncf_normalized`) WHERE "credit_notes"."ncf_normalized" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `credit_notes_identity_unique` ON `credit_notes` (`business_id`,`issue_year`,`credit_note_number_normalized`,`ncf_normalized`);--> statement-breakpoint
CREATE INDEX `credit_notes_business_date_idx` ON `credit_notes` (`business_id`,`issue_date`);--> statement-breakpoint
CREATE INDEX `credit_notes_status_idx` ON `credit_notes` (`status`);--> statement-breakpoint
CREATE INDEX `credit_notes_document_idx` ON `credit_notes` (`source_document_id`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_service_id` text,
	`item_code` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`quantity` real,
	`width_cm` real,
	`height_cm` real,
	`area_sqm` real,
	`unit_of_measure` text DEFAULT '' NOT NULL,
	`unit_price` real,
	`line_subtotal` real,
	`discount_amount` real,
	`tax_amount` real,
	`line_total` real,
	`tax_configuration_id` text,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_range` text DEFAULT '' NOT NULL,
	`source_formula` text DEFAULT '' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`value_states` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_service_id`) REFERENCES `products_services`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tax_configuration_id`) REFERENCES `tax_configurations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoice_lines_line_number_check" CHECK("invoice_lines"."line_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_lines_invoice_number_unique` ON `invoice_lines` (`invoice_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_lines_product_idx` ON `invoice_lines` (`product_service_id`);--> statement-breakpoint
CREATE INDEX `invoice_lines_tax_idx` ON `invoice_lines` (`tax_configuration_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_record_id` text,
	`business_id` text NOT NULL,
	`contact_id` text,
	`project_id` text,
	`quotation_id` text,
	`source_document_id` text,
	`invoice_number_raw` text NOT NULL,
	`invoice_number_normalized` text NOT NULL,
	`issue_date` text,
	`issue_date_raw` text DEFAULT '' NOT NULL,
	`issue_year` integer,
	`due_date` text,
	`due_date_raw` text DEFAULT '' NOT NULL,
	`ncf_raw` text DEFAULT '' NOT NULL,
	`ncf_normalized` text DEFAULT '' NOT NULL,
	`ncf_type` text DEFAULT '' NOT NULL,
	`document_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`replaced_invoice_id` text,
	`cancellation_reason` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`payment_terms_raw` text DEFAULT '' NOT NULL,
	`purchase_order_number` text DEFAULT '' NOT NULL,
	`sales_representative` text DEFAULT '' NOT NULL,
	`subtotal_amount` real,
	`discount_amount` real,
	`taxable_amount` real,
	`exempt_amount` real,
	`tax_amount` real,
	`total_amount` real,
	`paid_amount_snapshot` real,
	`balance_amount_snapshot` real,
	`snapshot_as_of` text,
	`source_authority` text DEFAULT 'issued_document' NOT NULL,
	`source_values` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`legacy_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`replaced_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoices_document_version_check" CHECK("invoices"."document_version" >= 1),
	CONSTRAINT "invoices_status_check" CHECK("invoices"."status" in ('draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled', 'replaced', 'credited', 'unknown')),
	CONSTRAINT "invoices_source_authority_check" CHECK("invoices"."source_authority" in ('issued_document', 'matrix', 'manual_resolution'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_legacy_record_unique` ON `invoices` (`legacy_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_ncf_unique` ON `invoices` (`ncf_normalized`) WHERE "invoices"."ncf_normalized" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_identity_unique` ON `invoices` (`business_id`,`issue_year`,`invoice_number_normalized`,`ncf_normalized`,`document_version`);--> statement-breakpoint
CREATE INDEX `invoices_business_date_idx` ON `invoices` (`business_id`,`issue_date`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `invoices_due_date_idx` ON `invoices` (`due_date`);--> statement-breakpoint
CREATE INDEX `invoices_project_idx` ON `invoices` (`project_id`);--> statement-breakpoint
CREATE INDEX `invoices_quotation_idx` ON `invoices` (`quotation_id`);--> statement-breakpoint
CREATE INDEX `invoices_document_idx` ON `invoices` (`source_document_id`);--> statement-breakpoint
CREATE INDEX `invoices_replaced_idx` ON `invoices` (`replaced_invoice_id`);--> statement-breakpoint
CREATE INDEX `invoices_legacy_idx` ON `invoices` (`legacy_record_id`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'DOP' NOT NULL,
	`allocation_date` text,
	`source_document_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`reversal_of_id` text,
	`import_batch_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `payment_allocations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_allocations_amount_check" CHECK("payment_allocations"."amount" > 0),
	CONSTRAINT "payment_allocations_status_check" CHECK("payment_allocations"."status" in ('draft', 'applied', 'reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_allocations_identity_unique` ON `payment_allocations` (`payment_id`,`invoice_id`,`amount`,`allocation_date`,`import_batch_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_payment_idx` ON `payment_allocations` (`payment_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_allocations_invoice_idx` ON `payment_allocations` (`invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_allocations_batch_idx` ON `payment_allocations` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_reversal_idx` ON `payment_allocations` (`reversal_of_id`);--> statement-breakpoint
CREATE TABLE `products_services` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`default_unit` text DEFAULT '' NOT NULL,
	`default_tax_configuration_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`default_tax_configuration_id`) REFERENCES `tax_configurations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_services_kind_check" CHECK("products_services"."kind" in ('product', 'service', 'labor', 'fee', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_services_code_unique` ON `products_services` (`code`) WHERE "products_services"."code" <> '';--> statement-breakpoint
CREATE INDEX `products_services_name_idx` ON `products_services` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `products_services_kind_idx` ON `products_services` (`kind`);--> statement-breakpoint
CREATE INDEX `products_services_tax_idx` ON `products_services` (`default_tax_configuration_id`);--> statement-breakpoint
CREATE INDEX `products_services_active_idx` ON `products_services` (`active`);--> statement-breakpoint
CREATE TABLE `receivable_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`as_of` text NOT NULL,
	`source_document_id` text,
	`import_batch_id` text,
	`invoice_total` real,
	`paid_amount` real,
	`balance_amount` real,
	`status_raw` text DEFAULT '' NOT NULL,
	`status_normalized` text DEFAULT 'unknown' NOT NULL,
	`source_sheet` text DEFAULT '' NOT NULL,
	`source_row_number` integer,
	`raw_values` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receivable_snapshots_status_check" CHECK("receivable_snapshots"."status_normalized" in ('unpaid', 'partial', 'paid', 'overdue', 'cancelled', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receivable_snapshots_source_unique` ON `receivable_snapshots` (`invoice_id`,`as_of`,`source_document_id`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `receivable_snapshots_invoice_idx` ON `receivable_snapshots` (`invoice_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `receivable_snapshots_batch_idx` ON `receivable_snapshots` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `receivable_snapshots_status_idx` ON `receivable_snapshots` (`status_normalized`);--> statement-breakpoint
CREATE TABLE `tax_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`tax_kind` text NOT NULL,
	`rate` real NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`applies_to` text NOT NULL,
	`calculation_basis` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tax_configurations_rate_check" CHECK("tax_configurations"."rate" >= 0),
	CONSTRAINT "tax_configurations_applies_to_check" CHECK("tax_configurations"."applies_to" in ('line', 'invoice', 'fee'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_configurations_code_effective_unique` ON `tax_configurations` (`code`,`effective_from`);--> statement-breakpoint
CREATE INDEX `tax_configurations_kind_idx` ON `tax_configurations` (`tax_kind`);--> statement-breakpoint
CREATE INDEX `tax_configurations_effective_idx` ON `tax_configurations` (`effective_from`,`effective_to`);--> statement-breakpoint
CREATE INDEX `tax_configurations_active_idx` ON `tax_configurations` (`active`);--> statement-breakpoint
ALTER TABLE `import_files` ADD `document_kind` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_files` ADD `source_modified_at` text;--> statement-breakpoint
ALTER TABLE `import_files` ADD `download_status` text DEFAULT 'downloaded' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_files` ADD `delta_status` text DEFAULT 'unchanged' NOT NULL;--> statement-breakpoint
CREATE INDEX `import_files_document_kind_idx` ON `import_files` (`document_kind`);--> statement-breakpoint
ALTER TABLE `import_rows` ADD `identity_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_rows` ADD `document_kind` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE INDEX `import_rows_identity_idx` ON `import_rows` (`identity_fingerprint`);--> statement-breakpoint
CREATE INDEX `import_rows_document_kind_idx` ON `import_rows` (`document_kind`);--> statement-breakpoint
ALTER TABLE `payments` ADD `transaction_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `payer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `bank_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `account_last4` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `evidence_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `void_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `payments_evidence_status_idx` ON `payments` (`evidence_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_transaction_unique` ON `payments` (`business_id`,`transaction_reference`,`payment_date`,`amount`) WHERE "payments"."transaction_reference" <> '';