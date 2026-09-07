# Client approvals

The WhatsApp module is implemented behind feature flags, but these inputs must
be approved before production activation or changing the Site edge to public:

- Meta Business ownership and administrator who will complete onboarding.
- The production HIDACA WhatsApp number and approved display name.
- Permanent system-user token, app secret, verification token, WABA ID, phone
  number ID, and Graph API version (enter only as server-side Site secrets).
- Spanish copy, languages, and variables for every production-approved Meta
  template.
- The operational process and source used to record WhatsApp opt-in consent.
- Formal retention policy; v1 intentionally keeps WhatsApp data indefinitely.
- Approval immediately before public edge access and production publishing.

The implementation does not add unverified business claims, clients, metrics,
prices, warranties, locations, testimonials, or social links.

Optional follow-up decisions:

AI operations foundation (feature flags remain disabled until approved):

- Confirm billing ownership and server-side setup for OpenAI, DeepSeek,
  Google AI Studio, and Cloudflare AI Gateway.
- Approve the Gemini API key route for v1; Vertex AI can be added later.
- Approve audio consent wording, 30-day source-audio retention, deletion, and
  whether inbound WhatsApp audio may be sent to a transcription provider.
- Confirm daily-report fields and which staff roles may approve AI drafts.
- Set provider fallback order and monthly usage/spend limits.
- Confirm whether provider keys should be stored directly in Sites secrets or
  as BYOK credentials in Cloudflare AI Gateway.
- Validate Queue/Workflow bindings before enabling asynchronous processing.

- Approve a controlled vocabulary for Lead Source.
- Approve a controlled vocabulary for Opportunity loss reasons.
- Decide whether future authorization needs row-level ownership/territories;
  the current application intentionally preserves the existing staff-wide
  access model.
- Decide whether the application should eventually translate all CRM action
  labels to Spanish. Required entity and pipeline terminology currently uses
  the specified English labels.
- Decide whether legacy Clientes/Contactos rows should later be hidden from
  generic legacy APIs after all external consumers are confirmed migrated.
