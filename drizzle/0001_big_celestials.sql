CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`owner_email` text NOT NULL,
	`attendees` text DEFAULT '[]' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`related_type` text,
	`related_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `activities_start_idx` ON `activities` (`start_at`);--> statement-breakpoint
CREATE INDEX `activities_owner_idx` ON `activities` (`owner_email`);--> statement-breakpoint
CREATE INDEX `activities_status_idx` ON `activities` (`status`);--> statement-breakpoint
CREATE INDEX `activities_related_idx` ON `activities` (`related_type`,`related_id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_record_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`owner_email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`legacy_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_legacy_record_unique` ON `businesses` (`legacy_record_id`);--> statement-breakpoint
CREATE INDEX `businesses_normalized_name_idx` ON `businesses` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `businesses_owner_idx` ON `businesses` (`owner_email`);--> statement-breakpoint
CREATE INDEX `businesses_updated_idx` ON `businesses` (`updated_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_record_id` text,
	`business_id` text,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`normalized_email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`normalized_phone` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`owner_email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`legacy_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_legacy_record_unique` ON `contacts` (`legacy_record_id`);--> statement-breakpoint
CREATE INDEX `contacts_business_idx` ON `contacts` (`business_id`);--> statement-breakpoint
CREATE INDEX `contacts_email_idx` ON `contacts` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `contacts_phone_idx` ON `contacts` (`normalized_phone`);--> statement-breakpoint
CREATE INDEX `contacts_owner_idx` ON `contacts` (`owner_email`);--> statement-breakpoint
CREATE INDEX `contacts_updated_idx` ON `contacts` (`updated_at`);--> statement-breakpoint
CREATE TABLE `lead_status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_status_history_lead_idx` ON `lead_status_history` (`lead_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`business_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`normalized_email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`normalized_phone` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`owner_email` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`converted_business_id` text,
	`converted_contact_id` text,
	`converted_opportunity_id` text,
	`converted_at` text,
	`converted_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`converted_business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_owner_idx` ON `leads` (`owner_email`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `leads_phone_idx` ON `leads` (`normalized_phone`);--> statement-breakpoint
CREATE INDEX `leads_updated_idx` ON `leads` (`updated_at`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`business_id` text NOT NULL,
	`primary_contact_id` text,
	`related_lead_id` text,
	`stage` text DEFAULT 'evaluation' NOT NULL,
	`outcome` text,
	`estimated_value` real DEFAULT 0 NOT NULL,
	`expected_close_date` text,
	`loss_reason` text DEFAULT '' NOT NULL,
	`owner_email` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_related_lead_unique` ON `opportunities` (`related_lead_id`);--> statement-breakpoint
CREATE INDEX `opportunities_business_idx` ON `opportunities` (`business_id`);--> statement-breakpoint
CREATE INDEX `opportunities_contact_idx` ON `opportunities` (`primary_contact_id`);--> statement-breakpoint
CREATE INDEX `opportunities_stage_idx` ON `opportunities` (`stage`);--> statement-breakpoint
CREATE INDEX `opportunities_owner_idx` ON `opportunities` (`owner_email`);--> statement-breakpoint
CREATE INDEX `opportunities_close_date_idx` ON `opportunities` (`expected_close_date`);--> statement-breakpoint
CREATE INDEX `opportunities_updated_idx` ON `opportunities` (`updated_at`);--> statement-breakpoint
CREATE TABLE `opportunity_quotes` (
	`opportunity_id` text NOT NULL,
	`quote_record_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`opportunity_id`, `quote_record_id`),
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_record_id`) REFERENCES `business_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `opportunity_quotes_quote_idx` ON `opportunity_quotes` (`quote_record_id`);--> statement-breakpoint
CREATE TABLE `opportunity_stage_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`outcome` text,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `opportunity_stage_history_opportunity_idx` ON `opportunity_stage_history` (`opportunity_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `search_documents` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_entity_unique` ON `search_documents` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `search_documents_type_idx` ON `search_documents` (`entity_type`);--> statement-breakpoint
CREATE INDEX `search_documents_owner_idx` ON `search_documents` (`owner_email`);--> statement-breakpoint
CREATE VIRTUAL TABLE `search_documents_fts` USING fts5(
	`title`,
	`subtitle`,
	`search_text`,
	content='search_documents',
	content_rowid='row_id',
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `search_documents_ai` AFTER INSERT ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`rowid`, `title`, `subtitle`, `search_text`)
	VALUES (new.`row_id`, new.`title`, new.`subtitle`, new.`search_text`);
END;--> statement-breakpoint
CREATE TRIGGER `search_documents_ad` AFTER DELETE ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`search_documents_fts`, `rowid`, `title`, `subtitle`, `search_text`)
	VALUES ('delete', old.`row_id`, old.`title`, old.`subtitle`, old.`search_text`);
END;--> statement-breakpoint
CREATE TRIGGER `search_documents_au` AFTER UPDATE ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`search_documents_fts`, `rowid`, `title`, `subtitle`, `search_text`)
	VALUES ('delete', old.`row_id`, old.`title`, old.`subtitle`, old.`search_text`);
	INSERT INTO `search_documents_fts` (`rowid`, `title`, `subtitle`, `search_text`)
	VALUES (new.`row_id`, new.`title`, new.`subtitle`, new.`search_text`);
END;--> statement-breakpoint
INSERT INTO `businesses` (
	`id`, `legacy_record_id`, `name`, `normalized_name`, `email`, `phone`,
	`address`, `notes`, `owner_email`, `created_by`, `created_at`, `updated_at`
)
SELECT
	`id`, `id`, `title`, lower(trim(`title`)), '', `contact`, '', `notes`,
	`created_by`, `created_by`, `created_at`, `updated_at`
FROM `business_records`
WHERE `module` = 'clientes' AND `archived_at` IS NULL;--> statement-breakpoint
INSERT INTO `contacts` (
	`id`, `legacy_record_id`, `business_id`, `name`, `email`, `normalized_email`,
	`phone`, `normalized_phone`, `title`, `notes`, `owner_email`, `created_by`,
	`created_at`, `updated_at`
)
SELECT
	`id`, `id`, NULL, `title`, '', '', `contact`,
	replace(replace(replace(replace(replace(`contact`, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''),
	'', `notes`, `created_by`, `created_by`, `created_at`, `updated_at`
FROM `business_records`
WHERE `module` = 'contactos' AND `archived_at` IS NULL;--> statement-breakpoint
INSERT INTO `search_documents` (
	`entity_type`, `entity_id`, `title`, `subtitle`, `search_text`,
	`owner_email`, `updated_at`
)
SELECT
	CASE `module`
		WHEN 'clientes' THEN 'business'
		WHEN 'contactos' THEN 'contact'
		WHEN 'proyectos' THEN 'project'
		WHEN 'cotizaciones' THEN 'quote'
		WHEN 'facturas' THEN 'invoice'
		WHEN 'pagos' THEN 'payment'
		WHEN 'ordenes-cambio' THEN 'case'
		WHEN 'tareas' THEN 'task'
		WHEN 'hitos' THEN 'milestone'
		WHEN 'reportes-diarios' THEN 'daily_report'
		WHEN 'equipos' THEN 'equipment'
		WHEN 'personal' THEN 'staff'
		WHEN 'suplidores' THEN 'supplier'
		ELSE 'record'
	END,
	`id`,
	`title`,
	trim(`customer_name` || ' ' || `contact`),
	trim(`title` || ' ' || `customer_name` || ' ' || `contact` || ' ' || `notes`),
	`created_by`,
	`updated_at`
FROM `business_records`
WHERE `archived_at` IS NULL;--> statement-breakpoint
INSERT INTO `search_documents` (
	`entity_type`, `entity_id`, `title`, `subtitle`, `search_text`,
	`owner_email`, `updated_at`
)
SELECT
	'document', `id`, `name`, `content_type`, `name`, `created_by`, `created_at`
FROM `documents`;
