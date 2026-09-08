# Google Places compliance audit (2026-09)

## Executive summary

The implementation uses Places API (New) server-side, stores the Google Place ID as the durable identity, and keeps the other listing fields in an expiring `pi_place_context` row. Immutable Google snapshots contain provenance and status only; raw Google facts are removed before persistence. The worker hard-deletes expired context. The conversion path now writes only operator-entered or independently verified CRM values and the Place ID reference. PageSpeed, BuiltWith, and Hunter adapters refuse a Google-only website and therefore cannot receive a Places URL or domain by accident.

This is a conservative technical control. It does not create a license to retain or derive Google Maps Content. The current Google rules require a public Terms of Use and Privacy Policy, prohibit copying business names/addresses and creating content from Google Maps Content, and expressly permit indefinite storage of Place IDs. The application has no public Terms/Privacy routes in this repository, and the legality of temporary retention of non-ID Places fields in this CRM workflow has not been approved by a policy/legal owner. Recommendation: **NO-GO for production enablement** until those two governance items are resolved.

## Current Google policies reviewed

- [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) (updated 2026-09-01): Place IDs are exempt from caching restrictions; Places content must not be prefetched/cached/stored beyond allowed exceptions; when content is shown without a Google Map, use Google Maps logo or exact text attribution; keep attribution visible and distinguish Google content from other content; retrieve/display provider attributions; follow applicable law.
- [Place IDs guide](https://developers.google.com/maps/documentation/places/web-service/place-id): Place IDs may be stored and reused indefinitely, with refresh recommended when older than 12 months.
- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms): Customer Terms/Privacy notices must flow down Google Maps use; attribution cannot be modified/obscured; exporting, storing, copying business names/addresses or reviews is prohibited; no caching except service-specific permission; no creating content from Google Maps Content; no use with a non-Google map.
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms): Places API (Legacy and New) may be used without a corresponding map, may not be used with a non-Google map, and latitude/longitude may be cached for up to 30 consecutive calendar days before deletion. The document does not grant a general permanent CRM right for the other requested Places fields.

The production decision must also account for the billing region. The sources above state that EEA billing addresses use the EEA terms instead.

## Current HIDACA architecture

`POST /v1/prospect-searches` is authenticated at the Worker boundary and enqueues a tenant-scoped job. `GooglePlaces` calls `places.googleapis.com/v1/places:searchText` or `searchNearby` with an explicit field mask. `mapPlace` normalizes the response. `Repository.canonicalize` stores only `place_id`, `facts={placeId}`, and a source reference. `WorkerRuntime.saveSnapshot` deletes `data.facts` before writing `pi_snapshots` and writes the raw normalized listing only to `pi_place_context` with a 24-hour expiry. `tick()` hard-deletes expired context even when all feature flags are off. `Repository.getProspect` and `snapshots()` rehydrate that context only while it is unexpired.

Scores, audits, enrichment snapshots, job metadata, and conversion links are durable HIDACA records. Google listing fields are no longer used for durable opportunity dimensions: fit, listed-phone reachability, listed-website reachability, and Google recency remain unknown unless independently sourced evidence exists. Existing provider adapters operate only on independently verified CRM websites. CRM conversion keeps the Place ID and requires operator-entered/independent fields for any durable business/contact values; blank values are allowed until sourced.

## Field-by-field compliance matrix

| Google field | Current storage / retention | UI | CRM / scoring / downstream | Classification | Remediation |
|---|---|---|---|---|---|
| Place ID | `pi_prospects.place_id`, `facts.placeId`, `pi_sources.external_id`; durable | Link identity and Google Maps URL | Reference only; no provider payload | **SAFE TO STORE** | Refresh/revalidate IDs older than 12 months. |
| Business name | `pi_place_context.context`; 24h, hard-deleted | Search/detail temporary listing | Never copied to CRM or opportunity search text; not scored | **TEMPORARY ONLY / LEGAL INTERPRETATION REQUIRED** | Keep temporary only pending policy-owner confirmation. |
| Formatted address | `pi_place_context.context`; 24h, hard-deleted | Temporary detail/list | Never copied to CRM; not scored | **TEMPORARY ONLY / LEGAL INTERPRETATION REQUIRED** | Keep temporary only; independently verify before CRM entry. |
| Latitude / longitude | `pi_place_context.context`; 24h, hard-deleted | Not plotted on a map | Used only for server-side radius filtering during the live search; not durable scoring | **MUST REFRESH** | 24h is below the 30-day service-specific ceiling; retain hard deletion. |
| International phone | `pi_place_context.context`; 24h, hard-deleted | Temporary detail | Never copied to CRM; not scored | **TEMPORARY ONLY / LEGAL INTERPRETATION REQUIRED** | Require independent/user-entered phone for CRM. |
| Website URI / domain | `pi_place_context.context`; 24h, hard-deleted | Temporary external link | Never forwarded by real enrichment adapters unless `independentWebsite` exists | **MUST NOT EXPORT** (Google-only) | Obtain an independent website before PageSpeed/BuiltWith/Hunter. |
| Place types | `pi_place_context.context`; 24h, hard-deleted | Not shown as durable fact | Not scored or exported | **TEMPORARY ONLY** | Use only for live discovery filtering pending legal approval. |
| Google Maps URI | `pi_place_context.context`; 24h, hard-deleted; source URL is also constructed from the durable ID | “Google Maps” link with `translate="no"` | Not copied to CRM | **DISPLAY ONLY** | Keep attribution adjacent and visible. |
| Rating | `pi_place_context.context`; 24h, hard-deleted | Not currently displayed as a durable CRM fact | Not scored or exported | **TEMPORARY ONLY / LEGAL INTERPRETATION REQUIRED** | Do not persist or derive a permanent score. |
| Review count | `pi_place_context.context`; 24h, hard-deleted | Not currently displayed as a durable CRM fact | Not scored or exported | **TEMPORARY ONLY / LEGAL INTERPRETATION REQUIRED** | Do not persist or derive a permanent score. |
| Provider attribution | `pi_place_context.context`; 24h, hard-deleted | Rendered when supplied with the listing | Not copied to CRM | **DISPLAY ONLY** | Preserve provider name/link and Google Maps attribution. |
| Opening hours, photos, reviews, business status | Not requested by field mask; no storage/UI | None | None | **MUST NOT PERSIST** | Do not add without a separate policy review and attribution implementation. |

## Storage and retention matrix

| Store | Google payload allowed by implementation | Retention/control |
|---|---|---|
| `pi_prospects` | Place ID only in `place_id` and `facts` | Durable; ID refresh review at 12 months. |
| `pi_sources` | Provider identity, Place ID, generated Maps URL | Durable provenance/reference only. |
| `pi_place_context` | Normalized listing context | 24 hours; worker hard-deletes `expires_at <= now`. This is a conservative implementation control, not a legal conclusion. |
| `pi_snapshots` | Provider/status/timing/derived evidence IDs; Google `data.facts` removed | Immutable provenance; no raw Google listing payload. |
| `pi_scores`, `pi_audits`, findings | HIDACA-generated technical evidence and findings | Durable; Google listing dimensions are unknown. |
| CRM tables / search index | Operator or independent values; Place ID provenance | No Google name/address/phone/website copied. |
| jobs, payloads, events, logs | IDs, provider, status, latency, error code | No Places payloads or credentials. |

## CRM conversion findings

Before this audit, `createCompany`, `createContact`, and opportunity indexing used the rehydrated Google prospect fields. They now use only mapping fields entered in the conversion form. A user can reuse an existing CRM match, enter independent business/contact values, or leave fields blank. The durable metadata keeps `placeId` as provenance. Opportunity search text falls back to `Place ID <id>` rather than the Google business name.

## Scoring findings

Google rating, review count, categories/types, coordinates, phone, website, and listing recency are not durable scoring inputs. The score retains independently sourced PageSpeed/BuiltWith/Hunter evidence and reports unknown coverage for Google-only dimensions. This avoids claiming that a mathematical transformation removes Google content restrictions.

## Attribution findings

No Google or non-Google map is embedded. Places links are displayed without a map, so the UI uses the exact `Google Maps` text, marks it `translate="no"`, keeps it visible near the listing, and preserves provider attribution links returned by Places. The screen labels the listing as temporary Google Maps data and separates it from HIDACA score/audit content. Photos and reviews are not requested or rendered.

## Terms / Privacy findings

The current repository has no public Terms of Use or Privacy Policy route discovered under `app/`. Google’s Terms require the customer application’s terms to notify users that Google Maps features/content are included and reference the current Google Maps End User Additional Terms and Google Privacy Policy. This is a **GOOGLE POLICY BLOCKER / LEGAL INTERPRETATION REQUIRED** until the owner publishes and reviews those notices. No unsupported legal text was added by this change.

## Third-party enrichment findings

The Google website/domain is not sent to PageSpeed, BuiltWith, Hunter, Ollama, or future adapters. The production adapters return `policy_blocked` unless `Prospect.independentWebsite` is populated from an independently verified CRM value. Synthetic test adapters are intentionally not treated as production provider boundaries.

## API key / security findings

`GOOGLE_PLACES_API_KEY` is read only by the staging prospecting Worker binding and is not present in client bundles, responses, logs, tests, docs, or committed `.env` files. The local source of truth is the ignored `.env` file outside this repository; staging uses the Worker secret named `GOOGLE_PLACES_API_KEY`. Restrict the Google Cloud key to Places API (New) and the staging server environment in Cloud Console. Production secrets and flags were not changed.

## Changes implemented

- Place-ID-first persistence remains enforced.
- Google raw facts remain in a separately expiring context row and are omitted from immutable snapshots.
- Expired context is hard-deleted by the worker cleanup path.
- CRM mapping now separates operator/independent business and contact fields from temporary Google facts.
- CRM records and search indexes no longer receive Google name/address/phone/website values.
- Google-only enrichment requests are blocked at real provider adapters.
- Google-derived score dimensions are unknown until independent evidence exists.
- Text attribution is marked `translate="no"` and the UI labels the listing as Google Maps temporary content.
- Added regression tests for no downstream forwarding, no CRM copying, provenance-only snapshots, and hard deletion.

## Automated / browser evidence

- Compliance regression: `node --import tsx --test tests/prospecting-compliance.test.ts` — 3 passed.
- The full prospecting suite `npm run test:prospecting` passes 48/48, including provider normalization, Place-ID retention, snapshot redaction, expiry cleanup, retry/error handling, feature kill switches, and the new compliance regression tests.
- Staging Google sandbox completed one minimal Places API (New) search with server-side key use; D1 inspection showed Place ID durable, `pi_snapshots.data={}`, and listing fields only in expiring `pi_place_context`.
- Playwright/Edge staging acceptance after the compliance deployment verified desktop/mobile rendering, saved results/detail panels, Google Maps attribution/link visibility, conversion preview, no console errors, no failed requests, and no horizontal overflow at a 390px viewport.

## Remaining questions and release decision

- **GOOGLE POLICY BLOCKER / LEGAL INTERPRETATION REQUIRED:** whether the CRM prospecting workflow may retain the non-ID Places fields in `pi_place_context` for 24 hours, and whether its search/detail display and radius use fit the permitted purpose. The current Terms expressly permit Place IDs and coordinates up to 30 days; they do not clearly grant general caching of the other fields.
- **GOOGLE POLICY BLOCKER:** publish and review the required Terms of Use and Privacy Policy disclosures.
- **NON-BLOCKING IMPROVEMENT:** refresh/revalidate Place IDs older than 12 months and add an explicit policy-owner sign-off record.
- **TECHNICAL BLOCKER for production:** rerun browser acceptance against the deployed compliance build and verify the staging key’s Cloud Console API/application restrictions.

**Recommendation: NO-GO.** Google Places is technically isolated and safer than the previous flow, but production enablement must remain disabled until the public notices and material retention/use questions receive owner/legal approval. Ollama Cloud remains independent of this decision.
