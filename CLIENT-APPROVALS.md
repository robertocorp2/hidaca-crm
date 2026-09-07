# Client approvals

No unresolved value blocks this release. The implementation does not add
unverified business claims, clients, metrics, prices, warranties, locations,
testimonials, or social links.

Optional follow-up decisions:

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
