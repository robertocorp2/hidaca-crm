# Import behavior and duplicate rules

1. Authorization, extension, MIME, empty-file, and 32 MB checks run first.
2. The original is written to private R2 and hashed with SHA-256.
3. D1 receives durable batch, document, and import-file staging rows.
4. A bounded parser extracts evidence and writes the full extraction sidecar
   to R2.
5. Exact hash matches block acceptance. Name/RNC/email/phone and quote
   identity matches create review candidates; they never auto-merge.
6. Reviewers may correct normalized values, resolve or dismiss issues with a
   reason, select an existing record, or retry from the retained original.
7. Acceptance refuses open blocking issues and uses one D1 `batch()` for
   canonical records, provenance, audit, search, and import state.
8. Repeated acceptance is idempotent. A failed batch creates no partial
   canonical records.

Organizations and individuals are both supported. Blank RNC is valid for an
individual. Quote numbers are not globally unique; revision identity is unique
only within its quote family. Original raw values are append-only evidence.
Internal costs and formulas are excluded from viewer responses and search.
