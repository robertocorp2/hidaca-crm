# Source expansion schema

The expansion is additive. Migrations `0002_sturdy_silk_fever.sql` and
`0003_dark_puma.sql` preserve `business_records`, legacy module keys, existing
CRM tables, and all deployed identifiers.

Canonical entities:

- `businesses` and `contacts` retain legacy links and now include customer
  type, RNC/mobile normalization, and source metadata.
- `projects`, `addresses`, `quotations`, and `quotation_revisions` model the
  customer, location, quote family, revision, and alternative independently.
- `quotation_sections`, `quotation_line_items`, and `measurements` retain
  customer-facing scope, quantities, dimensions, pricing basis, source totals,
  calculated totals, and source locations.
- `quotation_financials`, `quotation_charges`, `quotation_terms`, and
  `payments` retain source amounts separately from calculated values.
- `manufacturing_worksheets` and `material_components` retain private
  production details and formulas.
- `import_batches`, `import_files`, `source_field_values`, `import_issues`,
  and `import_candidates` implement reviewable staging.
- `document_links` and `entity_history` provide provenance and audit history.

Nullable numeric fields plus `value_states` distinguish blank, zero,
not-applicable, not-calculated, invalid, and populated values. Original files
and full extracted structures remain in private R2; D1 stores bounded review
data and canonical records.
