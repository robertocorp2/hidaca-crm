# HIDACA CRM and operations

Private CRM and operations application for HIDACA Constructora S.R.L., built
with vinext for OpenAI Sites.

## CRM capabilities

- Global, grouped, permission-gated full-text search with `Ctrl+K` / `Command+K`.
- Businesses, Contacts, Leads, Opportunities, and Cases terminology.
- Lead pipeline with status history, terminal outcomes, and transactional
  Business + Contact + Opportunity conversion.
- Opportunity pipeline with separate Closed stage and Won/Lost outcome.
- Quote links from Opportunities without implicit stage changes.
- Schedule and Calendar views over one shared Activities entity.
- Reviewed PDF/XLSX/XLSM/XLSB imports with original-file retention, duplicate
  candidates, corrections, retry, and atomic canonical record creation.
- Normalized quotation revisions, alternatives, measurements, financials,
  payments, terms, protected source documents, and role-gated production data.
- Responsive navigation, keyboard access, and reduced-motion behavior.

## Security model

- ChatGPT provides authenticated identity.
- The server validates that identity against the `staff_users` D1 allowlist on
  every protected page and API request.
- The connected deployment owner is the initial administrator. Administrators
  can authorize additional ChatGPT email addresses and assign `admin`,
  `operator`, or `viewer` roles.
- Viewers cannot create, edit, archive, upload, delete, or manage users.
- Documents are stored in private R2 and are downloaded only through an
  authenticated route.
- Mutating actions are written to `audit_log`.

## Storage

- D1 binding: `DB`
- R2 binding: `FILES`
- D1 migrations: `drizzle/0000_sour_fat_cobra.sql`,
  `drizzle/0001_big_celestials.sql`, `drizzle/0002_sturdy_silk_fever.sql`,
  `drizzle/0003_dark_puma.sql`, `drizzle/0004_public_namor.sql`,
  `drizzle/0005_sudden_viper.sql`, `drizzle/0006_nasty_chameleon.sql`, and
  `drizzle/0007_awesome_toxin.sql` through `drizzle/0010_light_clea.sql`
- Uploaded file limit: 10 MB; PDF, JPEG, PNG, WebP, DOCX, or XLSX.
- Reviewed source-import limit: 32 MB; PDF, XLSX, XLSM, or XLSB.

The CRM migration is additive. It retains the legacy `business_records` table
and its stable module keys for backward compatibility, backfills Businesses
and Contacts, and builds a separate FTS5 search index. It does not delete
production records or R2 objects.

## Normalized invoice import

The invoice workspace, APIs, staging engine, pilot acceptance, reconciliation,
post-validation, and reversal controls are guarded by
`INVOICE_IMPORT_PHASE1_ENABLED` and remain disabled by default. Production
promotion has a second independent kill switch,
`INVOICE_PRODUCTION_IMPORT_ENABLED`, also disabled by default.

The importer preserves source binaries and extraction evidence, auto-links only
unique exact identifiers, treats matrix `Avance`/`Pendiente` as receivable
snapshots, and requires identifiable payment evidence before creating
transactions or allocations. See
[the invoice production runbook](docs/hidaca-invoice-import/hidaca-invoice-production-runbook.md).

## Validation

```text
npm run lint
npm run typecheck
npm test
```

See [docs/CRM-EXPANSION.md](docs/CRM-EXPANSION.md) for architecture and
[docs/DEPLOYMENT-AND-ROLLBACK.md](docs/DEPLOYMENT-AND-ROLLBACK.md) for release
and recovery procedures. Source-expansion design, mappings, tests, and release
evidence are in [docs/source-file-expansion](docs/source-file-expansion).
