# Manual test checklist

- Sign in as admin, operator, viewer, unauthorized user, and signed-out user.
- Upload one valid PDF/XLSX/XLSM/XLSB, one exact duplicate, and one corrupt
  spreadsheet; confirm the original remains retained in every outcome.
- Resolve a blocking issue, dismiss a nonblocking false positive with a
  reason, correct a normalized field, and select Business/Contact/revision
  candidates.
- Force acceptance failure and verify no canonical rows exist; retry and
  accept, then repeat acceptance to verify idempotency.
- Verify imported Business, Contact, Project, and Quotation appear in global
  search without internal costs, raw evidence, object keys, or auth records.
- Verify quotation revisions, alternatives, items, measurements, totals,
  payments, terms, source documents, warnings, and history.
- Verify viewer cannot upload/retry/review/accept and cannot receive material
  costs or formulas.
- At 390, 768, 1024, and 1440 px, verify navigation, import queue, review
  table, quotation list/detail, and Business related sections.
- Test keyboard navigation, focus visibility, error/status announcements, and
  reduced-motion mode.
