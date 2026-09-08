CREATE TABLE `ecf_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`ecf_document_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ecf_document_id`) REFERENCES `ecf_documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_artifacts_version_unique` ON `ecf_artifacts` (`ecf_document_id`,`kind`,`version`);--> statement-breakpoint
CREATE INDEX `ecf_artifacts_document_idx` ON `ecf_artifacts` (`ecf_document_id`);--> statement-breakpoint
CREATE TABLE `ecf_debit_note_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`debit_note_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`item_code` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`quantity` real,
	`unit_of_measure` text DEFAULT '' NOT NULL,
	`unit_price` real,
	`line_subtotal` real,
	`tax_amount` real,
	`line_total` real,
	`tax_configuration_id` text,
	FOREIGN KEY (`debit_note_id`) REFERENCES `ecf_debit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tax_configuration_id`) REFERENCES `tax_configurations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_debit_note_lines_number_unique` ON `ecf_debit_note_lines` (`debit_note_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `ecf_debit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`number_raw` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`issue_date` text,
	`subtotal_amount` real,
	`tax_amount` real,
	`total_amount` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ecf_debit_notes_invoice_idx` ON `ecf_debit_notes` (`invoice_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ecf_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_invoice_id` text NOT NULL,
	`source_credit_note_id` text,
	`source_debit_note_id` text,
	`parent_ecf_id` text DEFAULT '' NOT NULL,
	`issuer_profile_id` text NOT NULL,
	`environment` text NOT NULL,
	`ecf_type` text NOT NULL,
	`encf` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`fiscal_snapshot_json` text DEFAULT '{}' NOT NULL,
	`fiscal_snapshot_hash` text DEFAULT '' NOT NULL,
	`schema_version` text DEFAULT '1.0' NOT NULL,
	`track_id` text DEFAULT '' NOT NULL,
	`security_code` text DEFAULT '' NOT NULL,
	`qr_data` text DEFAULT '' NOT NULL,
	`signing_certificate_fingerprint` text DEFAULT '' NOT NULL,
	`signed_at` text,
	`submitted_at` text,
	`last_status_check_at` text,
	`validation_summary` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`issuer_profile_id`) REFERENCES `ecf_issuer_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_documents_encf_unique` ON `ecf_documents` (`environment`,`issuer_profile_id`,`encf`);--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_documents_source_type_active_unique` ON `ecf_documents` (`source_invoice_id`,`environment`,`ecf_type`,`parent_ecf_id`);--> statement-breakpoint
CREATE INDEX `ecf_documents_source_invoice_idx` ON `ecf_documents` (`source_invoice_id`);--> statement-breakpoint
CREATE INDEX `ecf_documents_status_idx` ON `ecf_documents` (`status`);--> statement-breakpoint
CREATE INDEX `ecf_documents_track_id_idx` ON `ecf_documents` (`track_id`);--> statement-breakpoint
CREATE TABLE `ecf_inbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`operation` text NOT NULL,
	`issuer_rnc` text DEFAULT '' NOT NULL,
	`encf` text DEFAULT '' NOT NULL,
	`message_artifact_id` text,
	`response_artifact_id` text,
	`outcome` text DEFAULT 'received' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_artifact_id`) REFERENCES `ecf_artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_artifact_id`) REFERENCES `ecf_artifacts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ecf_inbound_messages_encf_idx` ON `ecf_inbound_messages` (`environment`,`encf`);--> statement-breakpoint
CREATE TABLE `ecf_issuer_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`legal_name` text DEFAULT '' NOT NULL,
	`rnc` text NOT NULL,
	`commercial_name` text DEFAULT '' NOT NULL,
	`fiscal_address` text DEFAULT '' NOT NULL,
	`province_code` text DEFAULT '' NOT NULL,
	`municipality_code` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`software_name` text DEFAULT 'HIDACA Constructora' NOT NULL,
	`software_version` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_issuer_profiles_environment_rnc_unique` ON `ecf_issuer_profiles` (`environment`,`rnc`);--> statement-breakpoint
CREATE INDEX `ecf_issuer_profiles_enabled_idx` ON `ecf_issuer_profiles` (`enabled`);--> statement-breakpoint
CREATE TABLE `ecf_party_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`identity_type` text DEFAULT 'RNC' NOT NULL,
	`identity_value` text DEFAULT '' NOT NULL,
	`fiscal_address` text DEFAULT '' NOT NULL,
	`province_code` text DEFAULT '' NOT NULL,
	`municipality_code` text DEFAULT '' NOT NULL,
	`receiver_type` text DEFAULT '' NOT NULL,
	`electronic_email` text DEFAULT '' NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_party_profiles_business_unique` ON `ecf_party_profiles` (`business_id`);--> statement-breakpoint
CREATE INDEX `ecf_party_profiles_identity_idx` ON `ecf_party_profiles` (`identity_value`);--> statement-breakpoint
CREATE TABLE `ecf_sequence_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_range_id` text NOT NULL,
	`ecf_document_id` text,
	`encf` text NOT NULL,
	`allocated_at` text NOT NULL,
	FOREIGN KEY (`sequence_range_id`) REFERENCES `ecf_sequence_ranges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ecf_document_id`) REFERENCES `ecf_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_sequence_allocations_encf_unique` ON `ecf_sequence_allocations` (`encf`);--> statement-breakpoint
CREATE INDEX `ecf_sequence_allocations_range_idx` ON `ecf_sequence_allocations` (`sequence_range_id`,`allocated_at`);--> statement-breakpoint
CREATE TABLE `ecf_sequence_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer_profile_id` text NOT NULL,
	`environment` text NOT NULL,
	`ecf_type` text NOT NULL,
	`prefix` text DEFAULT 'E' NOT NULL,
	`start_number` integer NOT NULL,
	`end_number` integer NOT NULL,
	`next_number` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`issuer_profile_id`) REFERENCES `ecf_issuer_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ecf_sequence_ranges_bounds_check" CHECK("ecf_sequence_ranges"."start_number" <= "ecf_sequence_ranges"."next_number" AND "ecf_sequence_ranges"."next_number" <= "ecf_sequence_ranges"."end_number" + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_sequence_ranges_identity_unique` ON `ecf_sequence_ranges` (`issuer_profile_id`,`environment`,`ecf_type`,`prefix`);--> statement-breakpoint
CREATE INDEX `ecf_sequence_ranges_active_idx` ON `ecf_sequence_ranges` (`active`);--> statement-breakpoint
CREATE TABLE `ecf_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`ecf_document_id` text NOT NULL,
	`from_status` text DEFAULT '' NOT NULL,
	`to_status` text NOT NULL,
	`dgii_status` text DEFAULT '' NOT NULL,
	`dgii_code` text DEFAULT '' NOT NULL,
	`actor_email` text NOT NULL,
	`attempt_id` text,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ecf_document_id`) REFERENCES `ecf_documents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `ecf_submission_attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ecf_status_history_document_idx` ON `ecf_status_history` (`ecf_document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ecf_submission_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ecf_document_id` text NOT NULL,
	`operation` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_artifact_id` text,
	`response_artifact_id` text,
	`http_status` integer,
	`track_id` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`redacted_error` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`ecf_document_id`) REFERENCES `ecf_documents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_artifact_id`) REFERENCES `ecf_artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_artifact_id`) REFERENCES `ecf_artifacts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ecf_submission_attempts_idempotency_unique` ON `ecf_submission_attempts` (`ecf_document_id`,`operation`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ecf_submission_attempts_document_idx` ON `ecf_submission_attempts` (`ecf_document_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ecf_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`ecf_document_id` text NOT NULL,
	`phase` text NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`message` text NOT NULL,
	`schema_version` text DEFAULT '1.0' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ecf_document_id`) REFERENCES `ecf_documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ecf_validations_document_idx` ON `ecf_validations` (`ecf_document_id`,`severity`);--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role, module, action, allowed) VALUES
('admin', 'facturas', 'ecf_generate', 1),
('admin', 'facturas', 'ecf_sign', 1),
('admin', 'facturas', 'ecf_submit', 1),
('admin', 'facturas', 'ecf_retry', 1),
('admin', 'facturas', 'ecf_adjust', 1),
('admin', 'facturas', 'ecf_cancel', 1),
('admin', 'facturas', 'ecf_xml', 1),
('admin', 'facturas', 'ecf_logs', 1),
('admin', 'facturas', 'ecf_configure', 1),
('operator', 'facturas', 'ecf_generate', 1),
('operator', 'facturas', 'ecf_sign', 0),
('operator', 'facturas', 'ecf_submit', 0),
('operator', 'facturas', 'ecf_retry', 1),
('operator', 'facturas', 'ecf_adjust', 1),
('operator', 'facturas', 'ecf_cancel', 0),
('operator', 'facturas', 'ecf_xml', 1),
('operator', 'facturas', 'ecf_logs', 0),
('operator', 'facturas', 'ecf_configure', 0),
('viewer', 'facturas', 'ecf_generate', 0),
('viewer', 'facturas', 'ecf_sign', 0),
('viewer', 'facturas', 'ecf_submit', 0),
('viewer', 'facturas', 'ecf_retry', 0),
('viewer', 'facturas', 'ecf_adjust', 0),
('viewer', 'facturas', 'ecf_cancel', 0),
('viewer', 'facturas', 'ecf_xml', 0),
('viewer', 'facturas', 'ecf_logs', 0),
('viewer', 'facturas', 'ecf_configure', 0);
