# Google Places storage audit

The Google adapter uses Places API (New) with explicit field masks. It sends one minimal search request for discovery and requests the same allowlisted fields for a place detail refresh. Raw upstream response bodies are never persisted.

| Google field | Source | Product use | Durable storage | Temporary storage |
| --- | --- | --- | --- | --- |
| Place ID (`id`) | Text/Nearby Search, Place Details | Stable identity and refresh key | `pi_prospects.place_id`, `pi_identities`, `pi_sources.external_id` | No expiry |
| Business name (`displayName`) | Search/Details | Prospect display, reviewed CRM conversion | No in prospect row; copied to CRM only after reviewed conversion | `pi_place_context`, 24-hour TTL |
| Address (`formattedAddress`) | Search/Details | Search result, matching, reviewed CRM conversion | No in prospect row; copied to CRM only after reviewed conversion | `pi_place_context`, 24-hour TTL |
| Coordinates (`location`) | Search/Details | Radius filtering and map context | No | `pi_place_context`, 24-hour TTL |
| Phone (`internationalPhoneNumber`) | Search/Details | Reachability score and reviewed CRM conversion | No in prospect row | `pi_place_context`, 24-hour TTL |
| Website (`websiteUri`) and derived domain | Search/Details | Enrichment input and reachability score | No in prospect row | `pi_place_context`, 24-hour TTL |
| Categories/types (`types`) | Search/Details | Business/service-area fit | No | `pi_place_context`, 24-hour TTL |
| Maps URL (`googleMapsUri`) | Search/Details | Attributed live display | No raw URL; a Place-ID lookup URL is generated when a source row is written | `pi_place_context`, 24-hour TTL |
| Rating/review count (`rating`, `userRatingCount`) | Search/Details | Temporary prospecting context only | No | `pi_place_context`, 24-hour TTL |
| Attributions | Search/Details | Provider attribution alongside live context | No | `pi_place_context`, 24-hour TTL |
| Opening hours, photos, reviews, business status | Not requested by the current field mask | Not used by HIDACA | No | No |

`pi_snapshots` keeps Google evidence provenance, status, timing, and score links, but its `data.facts` payload is removed before insertion. `pi_prospects.facts` is reduced to `{ placeId }`; `crm_facts` is reserved for HIDACA-owned or derived values. Scores, audit findings, enrichment results, conversion records, and user decisions remain durable because they are HIDACA-derived or explicitly user-created.

Expired context is excluded from repository reads. The scheduled worker removes expired context during the next Google provider write; a fresh search or detail refresh replaces the context and its expiry. A stale prospect therefore retains its Place ID and derived intelligence while requiring a provider refresh before listing fields are used.

This implementation control does not replace a legal review of the applicable Google Maps Platform agreement. Before enabling production discovery, confirm retention, attribution, display, and downstream CRM use with the applicable policy owner.
