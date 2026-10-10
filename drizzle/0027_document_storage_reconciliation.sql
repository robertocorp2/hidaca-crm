CREATE TABLE `document_storage_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `operation_kind` text NOT NULL CHECK (`operation_kind` IN ('upload', 'delete')),
  `status` text NOT NULL CHECK (`status` IN ('pending', 'metadata_pending', 'r2_pending', 'reconcile_required', 'failed', 'completed')),
  `document_id` text NOT NULL,
  `object_key` text NOT NULL,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `error` text,
  `attempts` integer NOT NULL DEFAULT 0,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `document_storage_operations_idempotency_unique`
  ON `document_storage_operations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `document_storage_operations_status_idx`
  ON `document_storage_operations` (`status`, `updated_at`);--> statement-breakpoint
CREATE INDEX `document_storage_operations_document_idx`
  ON `document_storage_operations` (`document_id`);
