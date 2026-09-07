DROP TABLE IF EXISTS `document_links`;
--> statement-breakpoint
DROP TABLE IF EXISTS `entity_history`;
--> statement-breakpoint
DROP TABLE IF EXISTS `import_issues`;
--> statement-breakpoint
DROP TABLE IF EXISTS `source_field_values`;
--> statement-breakpoint
DROP TABLE IF EXISTS `import_candidates`;
--> statement-breakpoint
DROP TABLE IF EXISTS `import_files`;
--> statement-breakpoint
DROP TABLE IF EXISTS `import_batches`;
--> statement-breakpoint
DROP TABLE IF EXISTS `material_components`;
--> statement-breakpoint
DROP TABLE IF EXISTS `manufacturing_worksheets`;
--> statement-breakpoint
DROP TABLE IF EXISTS `payments`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_charges`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_financials`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_terms`;
--> statement-breakpoint
DROP TABLE IF EXISTS `measurements`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_line_items`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_sections`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotation_revisions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `quotations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `addresses`;
--> statement-breakpoint
DROP TABLE IF EXISTS `projects`;
--> statement-breakpoint
DROP TABLE IF EXISTS `company_settings`;
--> statement-breakpoint
DROP INDEX IF EXISTS `opportunities_project_idx`;
--> statement-breakpoint
ALTER TABLE `opportunities` DROP COLUMN `project_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `documents_record_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `documents_hash_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `documents_imported_idx`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `extension`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `sha256`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `source_path`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `document_role`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `parser_name`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `parsing_status`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `imported_at`;
--> statement-breakpoint
DROP INDEX IF EXISTS `contacts_mobile_idx`;
--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `mobile_phone`;
--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `normalized_mobile_phone`;
--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `source_metadata`;
--> statement-breakpoint
DROP INDEX IF EXISTS `businesses_rnc_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `businesses_type_idx`;
--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `customer_type`;
--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `rnc`;
--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `normalized_rnc`;
--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `mobile_phone`;
--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `source_metadata`;
