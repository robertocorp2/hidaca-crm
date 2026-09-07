# HIDACA Constructora CRM audit — 2026-09-06

Repository audited: `robertocorp2/hidaca-crm`

This audit covers the private HIDACA operations application in `hidaca-constructora-app/`. It combines source inspection, existing focused tests, and a read-only browser audit of an isolated fixture built from copied current UI source with synthetic records. The fixture blocked all non-GET requests and never touched production data. The authenticated production app could not be opened in the available in-app browser because it required a ChatGPT sign-in; live record pages and production timings therefore remain unverified.

## Executive assessment

The application has a substantial shared UI foundation: centralized primitives, a shared Company/Contact `RecordWorkspace`, explicit permission checks, server-side validation, protected file routes, and focused responsive and modal tests. The main health risks are contract drift between normalized financial data and dashboard KPIs, permission inheritance that can re-enable an explicit denial, non-retryable WhatsApp webhook processing, and rollback procedures that do not actually quiesce writes. The largest product opportunity is to make the shared workspace, action controls, and related empty states consistent across all record types.

## Confirmed findings

| Priority | Finding | Classification | GitHub issue |
| --- | --- | --- | --- |
| P1 | Dashboard receivable KPI reads capped legacy records rather than normalized invoice/payment truth | Data/business logic | [#7](https://github.com/robertocorp2/hidaca-crm/issues/7) |
| P1 | Dependency grants can override explicit permission denials | Security/permissions | [#8](https://github.com/robertocorp2/hidaca-crm/issues/8) |
| P1 | WhatsApp webhook marks a batch processed before ingestion and acknowledges failed retries | Data integrity/architecture | [#9](https://github.com/robertocorp2/hidaca-crm/issues/9) |
| P1 | Database rollback has no real write barrier or D1/R2 reconciliation step | Operations/recovery | [#10](https://github.com/robertocorp2/hidaca-crm/issues/10) |
| P1 | Document upload/delete has no D1/R2 transaction or reconciliation contract | Data integrity/architecture | [#11](https://github.com/robertocorp2/hidaca-crm/issues/11) |
| P2 | Appearance font cards inherit full-width input styling and squeeze preview text | Shared CSS defect | [#12](https://github.com/robertocorp2/hidaca-crm/issues/12) |
| P2 | Action controls have layered, conflicting size rules | Design-system defect | [#13](https://github.com/robertocorp2/hidaca-crm/issues/13) |
| P2 | Projects use a separate detail layout instead of the shared record workspace | Architectural/product UX issue | [#14](https://github.com/robertocorp2/hidaca-crm/issues/14) |
| P2 | Related side panels fall back to passive “Sin registros” and lose record context for creation | Product/UX improvement | [#15](https://github.com/robertocorp2/hidaca-crm/issues/15) |
| P2 | Company detail performance needs instrumented measurement and query/payload reduction | Performance issue | [#16](https://github.com/robertocorp2/hidaca-crm/issues/16) |
| P2 | Users editor tabs lack tab-panel relationships and keyboard tab navigation | Accessibility issue | [#17](https://github.com/robertocorp2/hidaca-crm/issues/17) |

## Evidence highlights

- Dashboard totals in `app/app/operations-client.tsx:417-446` derive receivables from `records` where `module === "facturas"`; the initial page query in `app/app/page.tsx` caps generic records at 250. The normalized billing API calculates invoice balances from `payment_allocations`, `credit_note_applications`, cancellation state, and snapshots in `app/api/invoices/route.ts` and `app/api/receivables/route.ts`.
- `app/lib/modules.ts:165-187` applies overrides, then dependency grants. `tests/permissions.test.ts:38-48` explicitly expects a denied `clientes:view` permission to become true through the Projects dependency.
- `app/api/whatsapp/webhook/route.ts:26-28` inserts an event as `processed` and treats every insert error as a successful duplicate. Work happens later at lines 30-52; failures return 500 at lines 54-56, but the next delivery is acknowledged without replaying the work.
- `app/api/businesses/[id]/route.ts:41-126` runs the Company detail load as one initial query plus eleven parallel related queries, most capped at 250 rows. This is a confirmed fan-out to measure, not proof that database latency is the sole cause of the user-visible delay.
- `app/app/ui.tsx:105-159` and `app/globals.css:1011-1021,6256-6303` define Appearance Preferences. In the isolated fixture, the global `input { width:100%; min-height:42px }` rule made radio inputs consume 86–112px of 237px desktop cards, leaving 81–107px for text. At 390px and 320px the cards stacked without horizontal overflow, so the user-reported vertical rendering was not reproduced exactly.
- `app/app/projects-view.tsx:240-318` renders a bespoke project detail grid and related cards, while Company and Contact details use `app/app/record-workspace.tsx:693-845`.
- `app/app/record-workspace.tsx:510-616` supports actionable center empty states, but the related sidebar calls the same component without `fullEmptyState` or `onCreate`, producing passive “Sin registros”.
- `app/app/users-admin-view.tsx:215-235` uses `role="tablist"` and `role="tab"` without stable IDs, `aria-controls`, associated `tabpanel` elements, or arrow/Home/End navigation.
- Existing focused source tests for dashboard responsiveness, mobile layout, creation modals, and workspace surfaces passed: 11 tests, 11 passed. These are source-contract tests; they do not replace an authenticated browser audit.

## User-reported findings not reproduced exactly

- The Appearance Preferences cards did not become vertically stacked text or overflow the viewport at 1440, 1366, 1024, 768, 390, or 320px in the isolated fixture. A related readability defect was reproduced: the global full-width input rule consumes most of each desktop card.
- The “Trabajo vencido / Ver agenda” spacing did not visibly overlap in the 1440px synthetic dashboard capture. The shared panel/action pattern remains a candidate for regression coverage, but there is not enough current evidence for a separate issue.
- Company-record delay could not be measured against authenticated production data. The issue records the observable query fan-out and requires before/after timing evidence before selecting an optimization.

## Systemic causes

1. Two financial models are still presented together, but dashboard summary logic has not been moved to the normalized source of truth.
2. Permission dependencies are implemented as additive grants without preserving the distinction between an explicit denial and an inferred prerequisite.
3. Event processing, blob storage, and metadata writes do not share a durable completion/reconciliation contract.
4. Global CSS has historical layers with overlapping button, workspace, and form rules; local components inherit rules intended for ordinary text inputs.
5. Record detail architecture is shared for Companies and Contacts but remains duplicated for Projects and several financial surfaces.

## Recommended implementation order

1. Fix dashboard financial truth and add controlled KPI reconciliation tests.
2. Set permission-denial precedence and add dependency/deny security tests.
3. Make WhatsApp delivery retryable and idempotent, then add failure-after-deduplication tests.
4. Define a real maintenance barrier and D1/R2 recovery reconciliation before any destructive restore.
5. Define document blob/metadata reconciliation and operator visibility.
6. Correct Appearance radio sizing and consolidate button tokens/variants.
7. Add accessible Users tabs and make related empty states permission-aware and contextual.
8. Instrument Company detail latency, reduce measured waterfalls/payloads, and use the shared RecordWorkspace for Projects.

## Quick wins

- Scope radio input sizing inside `.font-choice-card`.
- Add tab IDs, `aria-controls`, and panel relationships in the Users editor.
- Replace related-sidebar passive empty states with existing permission-aware creation hooks.
- Add dashboard KPI source labels and a controlled synthetic invoice/payment fixture.

## Larger improvements

- One financial read model for dashboard, invoices, receivables, payments, and credit notes.
- A durable event lifecycle with retry and idempotent side effects for webhooks and blob-backed workflows.
- A shared RecordWorkspace contract extended to Projects and other entity detail pages.
- A tokenized action system with one canonical size/variant matrix.

## Limitations

The browser audit could not authenticate to the production app. No live database rows, production R2 objects, credentials, Meta messages, AI calls, mail, or DGII requests were accessed. The audit intentionally made no application, deployment, Git, or production-data changes. The screenshots and measurement bundle in this directory are from the synthetic fixture and are not claims about live customer data.

## GitHub publication

The 11 confirmed findings were published as GitHub issues #7–#17. Existing related issues #1–#6 were reviewed and not duplicated. This report is the companion audit record for those issues.
