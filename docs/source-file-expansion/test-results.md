# Test results

Recorded 2026-07-29. Final release validation must remain green before
deployment.

- TypeScript: passing.
- ESLint: passing after source-view effect and redaction cleanup.
- Vinext production build: passing; import, project, and quotation routes
  emitted.
- Automated tests: 55 passing after the final UI-regression assertion was made
  whitespace-insensitive.
- D1 migrations `0000` through `0006`: applied successfully to a fresh
  isolated state.
- `0006` rollback: passed against a copied state; the target index count was
  zero after rollback.
- XLSX, XLSM, XLSB, PDF, corrupt-file, installation, maintenance, revision,
  manufacturing, broken-formula, blank/zero, payment, and unknown-template
  cases are covered.

Representative source files were exercised with
`scripts/validate-source-corpus.ts`. The consolidated register was also
dry-run, accepted, reconciled, and re-run in an isolated D1 state:

- 2 worksheets and all 4,505 source rows were inspected.
- 2,398 rows imported; 2,107 remained visible for manual review; 0 failed or
  disappeared.
- Reconciliation found 0 unresolved rows, 0 unmapped fields, 0 raw-value
  preservation failures, and 0 total discrepancies in the register source.
- Re-execution reused the same import identity and processed 0 additional rows.

Authenticated browser checks passed through a loopback-only test identity for
the import review, quotation list/search/detail, project list/detail, direct
record URLs, mobile navigation, and mobile quotation detail. Screenshots are
stored with the reconciliation evidence.

The importer uses the public npm release `@e965/xlsx` 0.20.3 so Sites can build
it without a private/CDN package source; the XLSX/XLSM/XLSB corpus passed again
after that substitution. `npm audit --omit=dev` still reports three transitive
high-severity advisories in Next.js' bundled PostCSS and Sharp versions. npm's
only proposed automatic remediation is a breaking downgrade to Next.js 9, so
it was not applied. The direct Next.js, React, RSC, Vite, and workbook-parser
dependencies were moved to patched public releases and the complete suite was
rerun.
