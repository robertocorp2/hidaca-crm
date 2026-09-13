# Dashboard receivable KPI contract

The dashboard **Balance por cobrar** KPI reads the normalized invoice model,
not the capped legacy `business_records` projection. The summary endpoint
returns `source: normalized_invoice_read_model` and the UTC `asOf` date used for
the response.

Balance precedence for each active invoice is:

1. Cancelled, replaced, void, and draft invoices contribute zero.
2. If an applied payment allocation or credit-note application exists, use the
   total less those applied amounts, floored at zero.
3. Otherwise use the imported/manual balance snapshot when present.
4. A paid invoice without a snapshot contributes zero.
5. Other active invoices contribute their non-negative total.

Archived invoices are excluded. Legacy `business_records` invoice rows remain
included only when no normalized invoice points to the same legacy record. The
query has no 250-row cap, so high-volume datasets are summed consistently with
the normalized receivables source.
