DROP INDEX IF EXISTS `source_references_origin_idx`;
DROP INDEX IF EXISTS `source_references_filename_idx`;
DROP INDEX IF EXISTS `source_references_document_idx`;
DROP INDEX IF EXISTS `source_references_revision_idx`;
DROP INDEX IF EXISTS `source_references_row_idx`;
DROP TABLE IF EXISTS `source_references`;

DROP INDEX IF EXISTS `source_field_values_row_idx`;
ALTER TABLE `source_field_values` DROP COLUMN `source_row_number`;
ALTER TABLE `source_field_values` DROP COLUMN `import_row_id`;

DROP INDEX IF EXISTS `import_candidates_row_idx`;
ALTER TABLE `import_candidates` DROP COLUMN `import_row_id`;

DROP INDEX IF EXISTS `import_issues_row_idx`;
ALTER TABLE `import_issues` DROP COLUMN `import_row_id`;

DROP INDEX IF EXISTS `import_rows_quotation_idx`;
DROP INDEX IF EXISTS `import_rows_business_idx`;
DROP INDEX IF EXISTS `import_rows_origin_idx`;
DROP INDEX IF EXISTS `import_rows_fingerprint_idx`;
DROP INDEX IF EXISTS `import_rows_file_outcome_idx`;
DROP INDEX IF EXISTS `import_rows_source_unique`;
DROP TABLE IF EXISTS `import_rows`;

DROP INDEX IF EXISTS `import_batch_sources_batch_idx`;
DROP INDEX IF EXISTS `import_batch_sources_origin_unique`;
DROP TABLE IF EXISTS `import_batch_sources`;

DROP INDEX IF EXISTS `project_locations_building_idx`;
DROP INDEX IF EXISTS `project_locations_address_idx`;
DROP INDEX IF EXISTS `project_locations_project_idx`;
DROP TABLE IF EXISTS `project_locations`;

DROP INDEX IF EXISTS `project_contacts_primary_idx`;
DROP INDEX IF EXISTS `project_contacts_contact_idx`;
DROP TABLE IF EXISTS `project_contacts`;

DROP INDEX IF EXISTS `import_batches_hash_idx`;
ALTER TABLE `import_batches` DROP COLUMN `summary_json`;
ALTER TABLE `import_batches` DROP COLUMN `unmapped_field_count`;
ALTER TABLE `import_batches` DROP COLUMN `duplicate_count`;
ALTER TABLE `import_batches` DROP COLUMN `matched_count`;
ALTER TABLE `import_batches` DROP COLUMN `total_rows`;
ALTER TABLE `import_batches` DROP COLUMN `dry_run`;
ALTER TABLE `import_batches` DROP COLUMN `source_hash`;
ALTER TABLE `import_batches` DROP COLUMN `source_filename`;

DROP INDEX IF EXISTS `quotation_revisions_month_idx`;
ALTER TABLE `quotation_revisions` DROP COLUMN `source_year_raw`;
ALTER TABLE `quotation_revisions` DROP COLUMN `source_month_raw`;
ALTER TABLE `quotation_revisions` DROP COLUMN `quotation_month`;

DROP INDEX IF EXISTS `quotations_normalized_number_idx`;
DROP INDEX IF EXISTS `quotations_family_idx`;
ALTER TABLE `quotations` DROP COLUMN `source_metadata`;
ALTER TABLE `quotations` DROP COLUMN `family_key`;
ALTER TABLE `quotations` DROP COLUMN `normalized_quotation_number`;

DROP INDEX IF EXISTS `projects_type_idx`;
ALTER TABLE `projects` DROP COLUMN `source_metadata`;
ALTER TABLE `projects` DROP COLUMN `notes`;
ALTER TABLE `projects` DROP COLUMN `project_type`;
