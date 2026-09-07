DROP INDEX IF EXISTS `contacts_normalized_name_idx`;
ALTER TABLE `contacts` DROP COLUMN `normalized_name`;
