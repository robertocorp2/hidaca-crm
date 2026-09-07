# HIDACA source-file expansion execution plan

## Goal

Extend the existing private vinext/React CRM so HIDACA can retain, normalize,
review, search, and display the meaningful information in its historical PDF,
XLSX, XLSM, and XLSB quotation files without replacing legacy records,
discarding raw values, exposing internal costs, or changing the OpenAI
Sites/D1/R2 deployment architecture.

This plan implements the approved five-phase source-file audit baseline. The
existing CRM expansion in `docs/CRM-EXPANSION.md` remains in force.

## Evidence and invariants

- The current application uses React 19/vinext, Cloudflare D1, private R2,
  ChatGPT identity, and a D1 staff allowlist.
- Existing CRM migrations `0000` and `0001`, legacy module keys,
  `business_records`, routes, records, search behavior, and R2 object keys must
  remain compatible.
- The local source corpus contains 5,779 files: 2,819 XLSX, 42 XLSB, 2 XLSM,
  2,569 PDF, and ancillary formats.
- The previous register extraction successfully indexed 2,819 XLSX files,
  explicitly reported all 42 XLSB files as unsupported, and reported two
  corrupt temporary XLSX files. New behavior must improve those outcomes
  without silently skipping either condition.
- Representative files confirm:
  - installation quotations with opening and finished dimensions, area,
    square-meter pricing, installation, ITBIS, and Spanish terms;
  - repair/maintenance quotations with item quantities, flat prices,
    installation/maintenance charges, disclaimers, and totals;
  - manual/motorized or scope alternatives and revision-like filename
    suffixes;
  - internal `despiece` and production worksheets with component quantities,
    costs, formulas, and broken formulas such as `#REF!`;
  - blank RNC, email, phone, dimensions, taxes, and non-applicable fields.
- A blank source value is not zero. Canonical numeric columns remain nullable,
  while a structured value-state map records `blank`, `zero`,
  `not_applicable`, `not_calculated`, `value`, or `invalid`.
- Raw extracted values and source formulas are append-only provenance.
  Corrections create normalized mappings and audit entries; they do not
  overwrite source evidence.
- Internal production quantities, formulas, and costs are visible only to
  `admin` and `operator` roles and are never indexed by global search.
- No production source file is imported by development or test commands.
  Automated fixtures are synthetic but mirror verified templates; selected
  original files are used only for local read-only validation.

## Dependency and migration order

1. Add the schema and reversible migration first.
2. Add domain validation/calculation/import primitives with unit tests.
3. Add normalized APIs and permission enforcement.
4. Add import upload, parse, staging, duplicate/revision/conflict analysis,
   and review resolution.
5. Add focused record/detail/review UI.
6. Backfill search documents and compatibility links.
7. Run migration/rollback, automated, browser, and representative-source
   validation.

The implementation uses SheetJS Community Edition for XLSX, XLSM, and XLSB
array-buffer parsing, `unpdf` for serverless PDF text extraction, Web Crypto
SHA-256 for hashes, D1 `batch()` for atomic record acceptance, and the existing
R2 bucket for original bytes. Parser failures still create a source document,
import-file row, and manual-review issue.

## Task 1 - Additive schema and reversible migration

### Goal

Create storage for every canonical record, value, relationship, warning, and
provenance requirement without deleting or renaming existing tables.

### Context

`db/schema.ts` and `drizzle/0000`/`0001` are authoritative. The migration must
be additive and safe for existing deployed data.

### Relevant files

- `db/schema.ts`
- `drizzle/0002_*.sql`
- `drizzle/meta/*`
- `tests/migration.test.mjs`
- `docs/source-file-expansion/schema.md`
- `docs/source-file-expansion/rollback.md`

### Proposed approach

- Extend `businesses` with customer type, RNC, mobile, billing details, and
  source-quality metadata. Individual customers do not require RNC.
- Extend `contacts` with mobile and source-quality metadata.
- Extend `documents` with extension, SHA-256, source path, import role,
  import-batch link, and import timestamp while keeping existing columns.
- Add company settings, addresses, normalized projects, quotation families,
  quotation revisions/alternatives, sections, line items, measurements,
  financial summaries, charges, terms, payments, manufacturing worksheets,
  material components, import batches/files/values/issues/candidates, and
  entity history.
- Add indexes for business identity, quotation lookup, dates, source hashes,
  review state, relationships, and filters.
- Use uniqueness only for source hash within a retained file identity and for
  revision identity within one quotation family. Do not make quotation number
  globally unique.
- Add search rows only for customer-facing canonical entities.

### Acceptance criteria

- Existing migrations still apply from an empty database.
- Migration `0002` applies after a representative pre-`0002` database without
  changing or deleting old rows.
- Companies and individuals are valid; only organizations validate RNC when a
  value is supplied.
- Duplicate quotation numbers across years, customers, scopes, or families
  are valid.
- Multiple revisions and alternatives under one quotation family are valid.
- Foreign-key violations fail atomically.
- Required lookup indexes exist.
- A documented down/rollback SQL script removes only `0002` additions and is
  tested on an isolated database.

### Source reference

Objective Phases 1-4; prior canonical-field and relationship audit.

### Verify

```text
node --import tsx --test tests/migration.test.mjs tests/source-schema.test.ts
npm run db:generate
```

## Task 2 - Domain values, financial calculations, and validation

### Goal

Provide one tested domain layer for canonicalization, value-state preservation,
totals, warnings, revisions, and duplicate signals.

### Relevant files

- `app/lib/source-domain.ts`
- `app/lib/financials.ts`
- `app/lib/import-validation.ts`
- `tests/source-domain.test.ts`
- `tests/financials.test.ts`

### Proposed approach

- Define canonical enums and runtime guards for customer types, quotation
  statuses/types, price bases, currencies, payment states, mapping confidence,
  import states, issue types/severity, and value states.
- Preserve `rawValue`, normalized value, source location, parser, confidence,
  and transformation for every extracted field.
- Calculate quantity x unit price, area x price per square meter, flat fees,
  charges, discounts, taxes/ITBIS, subtotal, and total without mutating source
  amounts.
- Compare calculated and source totals using currency-aware tolerances and
  generate discrepancies.
- Normalize names, RNC, email, phone, quotation number/year, dates, currencies,
  filenames, and revision/alternative hints conservatively.
- Detect exact-source duplicates by hash; likely customer duplicates by
  normalized name/RNC/email/phone; likely revisions by quotation identity plus
  filename/version/scope; conflicts by disagreeing nonblank identifiers.

### Acceptance criteria

- All required financial formulas and blank/zero/NA/not-calculated cases have
  unit tests.
- Invalid or suspicious dates, broken formulas, unsupported calculations,
  missing identity, conflicting identifiers, and total discrepancies become
  issues.
- Original currency is preserved and no conversion occurs.
- No normalizer invents missing values.

### Verify

```text
node --import tsx --test tests/source-domain.test.ts tests/financials.test.ts
```

## Task 3 - Spreadsheet and PDF extraction adapters

### Goal

Extract bounded, auditable workbook/PDF structures from all required formats
while retaining partial results and explicit failures.

### Relevant files

- `app/lib/importers/index.ts`
- `app/lib/importers/spreadsheet.ts`
- `app/lib/importers/pdf.ts`
- `app/lib/importers/hidaca-mapper.ts`
- `tests/importers.test.ts`
- `tests/fixtures/imports/*`

### Proposed approach

- Parse XLSX/XLSM/XLSB from `ArrayBuffer` with SheetJS, retaining worksheet
  names, cell addresses, raw/display values, formulas, and parser warnings.
- Never execute VBA macros. Record macro presence as metadata.
- Extract PDF text page-by-page with `unpdf`; map labels and tables when
  confidence is adequate and preserve page text/raw tokens regardless.
- Cap file size, worksheets, cells, formulas, text length, and parser duration
  to prevent resource exhaustion.
- Classify verified HIDACA templates as installation, repair/maintenance,
  production/material, register, or unknown.
- Map high-confidence labels, retain medium/low mappings for review, and store
  every other nonblank cell/token as unmapped source data.
- Treat encrypted, corrupt, unsupported, partially parsed, and formula-error
  files as retained manual-review imports.

### Acceptance criteria

- Synthetic installation, maintenance, revision, production, XLSM, XLSB, PDF,
  corrupt, and partial fixtures cover every adapter.
- XLSB parsing produces structured cells or an explicit retained failure; it
  is never skipped.
- Source formulas and formula errors are preserved.
- No macro is executed.
- Parser limits reject abusive inputs with a retained issue.

### Verify

```text
node --import tsx --test tests/importers.test.ts
npm run build
```

## Task 4 - Import staging, persistence, and atomic acceptance APIs

### Goal

Store original files and parsed evidence, then let authorized users accept or
correct mappings without partial canonical writes.

### Relevant files

- `app/api/imports/route.ts`
- `app/api/imports/[id]/route.ts`
- `app/api/imports/[id]/review/route.ts`
- `app/api/imports/[id]/accept/route.ts`
- `app/api/imports/[id]/retry/route.ts`
- `app/api/documents/route.ts`
- `app/lib/import-service.ts`
- `tests/import-api.test.ts`

### Proposed approach

- Accept PDF/XLSX/XLSM/XLSB, hash bytes, store the original in private R2,
  create batch/file records, parse, and persist raw values plus issues.
- Check an existing hash before canonical creation and stage exact duplicates
  for review.
- Generate customer, quotation revision, and conflicting-value candidates.
- `viewer` may read review data but cannot upload, correct, retry, or accept.
- Operators/admins can correct normalized values and resolve issues.
- Acceptance uses a D1 batch to create/link business/contact/project,
  quotation/revision, lines, measurements, financials, payments, terms, and
  source links plus audit history.
- Repeated acceptance is idempotent and returns the prior canonical links.
- R2 upload followed by D1 failure leaves a recoverable import failure; a
  compensating delete is attempted only before any durable source-document row
  exists.

### Acceptance criteria

- Original bytes, filename, path, type, size, SHA-256, uploader, and timestamps
  survive every parser outcome.
- Raw and normalized values remain distinct.
- Exact duplicates, likely duplicates, revisions, conflicts, missing data,
  dates/totals, parser/formula errors, and unmapped fields are visible.
- Forced acceptance failure rolls back all canonical rows.
- Audit entries identify uploader, reviewer, accepter, corrections, and time.
- Internal material data is written but never returned to a viewer.

### Verify

```text
node --import tsx --test tests/import-api.test.ts tests/import-transaction.test.ts
```

## Task 5 - Normalized record APIs and compatibility behavior

### Goal

Expose secure CRUD/read models for the new canonical records while preserving
existing CRM and generic Operations behavior.

### Relevant files

- `app/api/businesses/*`
- `app/api/contacts/*`
- `app/api/projects/*`
- `app/api/quotations/*`
- `app/api/payments/*`
- `app/api/search/route.ts`
- `app/lib/search.ts`
- `tests/source-api.test.ts`
- `tests/crm-surface.test.mjs`

### Proposed approach

- Expand Business/Contact APIs and add normalized Project, Quotation,
  Revision, Payment, and related-record endpoints.
- Return segmented detail models rather than one unbounded payload.
- Add bounded filters for customer/contact/RNC/phone/email/quote number/date,
  project/address/service/status/payment/total/source filename.
- Keep `business_records` quotation/project/payment rows readable and linkable;
  do not migrate or overwrite them automatically.
- Index safe summaries only. Exclude raw import data, internal costs, audit
  internals, authentication data, object keys, and unresolved PII-only tokens.

### Acceptance criteria

- API authorization is enforced server-side on every route.
- Viewer writes and internal production access are denied.
- Existing Leads, Opportunities, Businesses, Contacts, Projects, Quotations,
  Cases, search, navigation, authentication, and document workflows pass
  regression tests.
- Query limits and indexes prevent unbounded full-table reads.

### Verify

```text
node --import tsx --test tests/source-api.test.ts tests/crm-surface.test.mjs
```

## Task 6 - Business/customer and quotation UI

### Goal

Give every canonical field a logical, responsive display/edit location without
creating monolithic pages.

### Relevant files

- `app/app/source-types.ts`
- `app/app/customer-detail.tsx`
- `app/app/quotation-view.tsx`
- `app/app/quotation-form.tsx`
- `app/app/operations-client.tsx`
- `app/globals.css`
- `tests/source-ui.test.mjs`

### Proposed approach

- Expand Business detail into Overview, Contacts, Addresses, Projects,
  Opportunities, Quotations, Payments, Documents, and Activity History.
- Add quotation list/detail with Summary, customer/contact, project,
  identity/date, revision history, locations/measurements, line items,
  financials, payments, terms, notes, internal material, source documents,
  warnings, and audit history.
- Use disclosure tabs/sections and focused forms for summary, lines,
  payments/terms, and internal production.
- Hide internal material sections and API data from viewers.
- Render optional/null/value-state fields explicitly and accessibly.

### Acceptance criteria

- Every canonical field in `field-dictionary.md` has a documented and rendered
  UI destination.
- Optional fields do not create empty broken layouts.
- Revision history never replaces older revisions.
- Source documents download through the protected endpoint.
- Warnings are adjacent to affected fields/sections.
- Desktop, tablet, and mobile views have no clipping or horizontal overflow.

### Verify

```text
node --test tests/source-ui.test.mjs tests/ux-regression.test.mjs
npm run dev -- --host 127.0.0.1
```

## Task 7 - Import review UI

### Goal

Provide an actionable, permission-aware review queue for uncertain and failed
imports.

### Relevant files

- `app/app/imports-view.tsx`
- `app/app/import-review.tsx`
- `app/app/operations-client.tsx`
- `app/lib/modules.ts`
- `app/globals.css`
- `tests/import-ui.test.mjs`

### Proposed approach

- Add an Imports navigation item in Operations.
- Show batch/file state, counts, duplicate/revision candidates, conflicts,
  missing values, suspicious dates/totals, unmapped fields, and failed files.
- Add a side-by-side source-to-record comparison with raw value, normalized
  value, target field, confidence, source location, and resolution.
- Let authorized reviewers select existing records, correct mappings, dismiss
  false positives with a reason, retry parsing, or accept.
- Preserve focused keyboard navigation, loading/empty/success/error states,
  unsaved-change guard, and reduced motion.

### Acceptance criteria

- Successful, review-required, duplicate, revision, conflict, unmapped,
  partial, and failed states are reachable in tests.
- Acceptance is disabled while blocking issues remain.
- Every resolution is audited.
- Viewer sees review summaries but no internal production costs and cannot
  mutate.

### Verify

```text
node --test tests/import-ui.test.mjs tests/rendered-html.test.mjs
```

## Task 8 - Documentation, representative validation, and release gates

### Goal

Prove the full objective against schema, parser, UI, migration, source files,
and regression evidence.

### Relevant files

- `docs/source-file-expansion/schema.md`
- `docs/source-file-expansion/entity-relationships.md`
- `docs/source-file-expansion/field-dictionary.md`
- `docs/source-file-expansion/source-mapping.md`
- `docs/source-file-expansion/import-behavior.md`
- `docs/source-file-expansion/duplicate-revision-rules.md`
- `docs/source-file-expansion/manual-test-checklist.md`
- `docs/source-file-expansion/test-results.md`
- `docs/source-file-expansion/completion-report.md`
- `README.md`
- `docs/DEPLOYMENT-AND-ROLLBACK.md`

### Proposed approach

- Maintain the canonical field dictionary and source-to-field mapping beside
  code.
- Validate read-only representative originals for installation, manual and
  motorized alternatives, maintenance/repair, revision names, production
  worksheets, XLSM, XLSB, PDF, blank RNC/email, blank/zero, and broken
  formulas.
- Record only necessary filenames/template types and comparison results; do
  not commit source customer PII or original documents.
- Apply migrations to an isolated database, test down/up, and verify old rows.
- Run formatting, lint, TypeScript, full tests, build, local app, browser
  desktop/mobile checks, console/network checks, and production-safe smoke
  checks without deployment.

### Acceptance criteria

- Every objective and completion criterion maps to current passing evidence.
- No known field is silently discarded: mapped fields have a canonical target;
  every other nonblank value is retained as unmapped evidence with an issue.
- Required parser formats and representative templates pass.
- No P0/P1 issue remains.
- No test is skipped or failing.
- Rollback instructions cover application, D1 migration, search rebuild, and
  R2 source-file retention.

### Verify

```text
npm run lint
npx tsc --noEmit
npm test
```

## Out of scope

- Bulk import of the full production source corpus.
- Automatic customer merges or deletion of duplicate files.
- Executing spreadsheet macros.
- Currency conversion or invented tax/financial values.
- Customer-facing/public quotation portals.
- Replacing the current framework, authentication, D1, R2, or Sites workflow.
- Renaming legacy tables/module keys.
