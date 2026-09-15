# Document storage reconciliation

Document uploads and deletes are tracked in `document_storage_operations` with
an idempotency key, the intended document metadata, R2 object key, current
phase, attempt count, and the last failure. The upload route writes the R2
object before D1 metadata and keeps the operation retryable when the metadata
write fails. The delete route removes D1 metadata first and then deletes R2;
if R2 fails, the retained operation key makes the delete retryable without
creating a new document row.

Clients should send an `Idempotency-Key` header and reuse it when retrying the
same upload or delete. A completed operation returns the original result and
does not create duplicate metadata or overwrite a different object key.

Administrators can inspect the private reconciliation report with
`GET /api/admin/documents/reconciliation`. It reports D1 rows whose R2 bytes
are missing, R2 objects without metadata, and incomplete operations. Repair is
an explicit admin-only action: `POST /api/admin/documents/reconciliation?repair=true`.
Repair restores metadata only from a recorded upload operation and removes an
object only from a recorded delete operation whose metadata is already absent;
unknown orphan objects remain report-only for policy review.

The endpoint is intentionally authenticated and does not expose document
bytes or create public URLs. Run it after the rollback/write-barrier controls
from issue #10 are available so storage repair can be coordinated with the
same maintenance and audit procedures.
