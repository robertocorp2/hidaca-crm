# Completion report

## Implemented

- Additive and reversible D1 schema for customer identity, projects,
  addresses, quotations/revisions, items, measurements, finance, payments,
  terms, private production data, import review, provenance, and history.
- Bounded PDF/XLSX/XLSM/XLSB extraction with raw/formula retention,
  blank/zero semantics, financial validation, and explicit partial/failure
  outcomes.
- Private R2 source and extraction-sidecar retention, SHA-256 duplicates,
  customer/contact/revision candidates, corrections, decisions, retry, and
  atomic idempotent acceptance.
- Normalized quotation and Business relationship read models and responsive
  UI, global-search integration, protected source downloads, and viewer
  redaction.
- Existing framework, authentication, D1/R2, generic Operations records,
  visual system, and Sites workflow remain in place.
- Consolidated-register dry run and acceptance workflow with source-row
  addresses, per-origin reconciliation, duplicate/conflict queues, manual
  review actions, hash-idempotent re-execution, and a detailed exception
  export.
- Dedicated project and normalized-quotation portals with deep links,
  exhaustive filters, source metadata, import warnings, revision history, and
  responsive detail layouts.

## Consolidated register validation

Workbook:
`registro combinado de cotizaciones HIDACA.xlsx`

- Size: 533,122 bytes
- SHA-256:
  `0443848e13f7a8df1cfdace7afdce029ea07c4506d670782cfb2e3441e82a2b8`
- Worksheets inspected: 2
- Source rows discovered: 4,505
- Rows imported in the final isolated integration run: 2,398
- Rows matched: 0
- Manual-review rows: 2,107
- Duplicate candidates: 762
- Failed or unresolved rows: 0
- New customers: 1,194
- New contacts: 319
- New projects: 47
- New quotations: 2,300
- Revision records: 2,398
- Unmapped fields, total discrepancies, and raw-value preservation failures: 0

The exception report includes 681 conflicts, 236 rows missing required
identity, 174 suspicious dates, and 445 low-confidence matches. Duplicate
candidates are a subset of manual review and are displayed separately to avoid
double counting.

Evidence is written outside the repository at:
`outputs/crm-import-20260729-133324/reconciliation.local.json`,
`outputs/crm-import-20260729-133324/exceptions.local.csv`, and
`outputs/crm-import-20260729-133324/screenshots/`.

## Release and rollback

Deploy application code before applying `0002` through `0006` only with a
recorded D1 recovery point. If application rollback is required, redeploy the
prior saved Sites version. The additive tables may remain safely unused. If a
full schema rollback is approved, run the down scripts newest-first against a
restored/tested copy. Retain R2 originals during rollback; deleting them would
remove the audit source.

## Remaining operational decisions

- Review the 2,107 conservative manual-review rows; no automatic merge was
  performed for name-only or conflicting identities.
- Confirm retention duration for original source files and extraction
  sidecars.
- Decide whether legacy quotation/project/payment records will be linked
  manually or by a separately reviewed backfill. This implementation does not
  overwrite them automatically.
