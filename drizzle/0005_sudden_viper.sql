ALTER TABLE `contacts` ADD `normalized_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `contacts`
SET `normalized_name` = lower(trim(`name`))
WHERE `normalized_name` = '';--> statement-breakpoint
CREATE INDEX `contacts_normalized_name_idx` ON `contacts` (`normalized_name`);
