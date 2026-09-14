# Dashboard receivable KPI contract

The dashboard **Balance por cobrar** KPI and receivables list read the
normalized invoice model plus the unpromoted legacy `business_records`
read-through. The summary endpoint returns
`source: normalized_invoice_read_model_with_legacy_read_through`, the explicit
`sources` array, and the UTC `asOf` date used for the response.

Balance precedence for each active invoice is:

1. Cancelled, replaced, void, and draft invoices contribute zero.
2. If an applied payment allocation or credit-note application exists, use the
   total less those applied amounts, floored at zero.
3. Otherwise use the imported/manual balance snapshot when present.
4. A paid invoice without a snapshot contributes zero.
5. Other active invoices contribute their non-negative total.

Archived invoices are excluded. Legacy `business_records` invoice rows remain
included only when no normalized invoice points to the same legacy record. The
receivables list applies the same filters and has no server-side result cap, so
high-volume datasets remain visible and consistent with the summary source.
