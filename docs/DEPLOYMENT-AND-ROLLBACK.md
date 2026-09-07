# Deployment and rollback

## Release checklist

1. Record the current Sites version and UTC deployment time.
2. Capture a D1 Time Travel bookmark for the pre-deployment timestamp.
3. Run `npm run lint`, `npm run typecheck`, and `npm test`.
4. Push the exact tested commit to the Sites source repository.
5. Package and save that exact commit as a Sites version.
6. Deploy the saved version with the existing private access policy.
7. Verify authentication, legacy records, search, CRM navigation, pipelines,
   Schedule, Calendar, Documents, and Users.
8. Retain screenshots and the version/deployment identifiers in release notes.

The schema changes in `0002` through `0006` are applied by the Sites deployment
workflow. They contain no DROP, DELETE, destructive rename, or R2 operation.
`0004` adds the consolidated-register staging model, `0005` adds the normalized
contact-name field, and `0006` adds the revision lookup index required by the
quotation list. Record a backup/bookmark before applying the migrations and
verify the current application code is the exact tested commit.

## Application rollback

Redeploy the previously known-good Sites version. This immediately restores
the prior application code and assets. The additive CRM tables can safely
remain because the previous release does not query them.

## Database rollback

Database restore is required only if new CRM writes must also be removed or
the additive migration itself caused a verified data issue.

1. Stop CRM writes by redeploying the previous Sites version.
2. Confirm the intended pre-deployment UTC timestamp or saved bookmark.
3. Run `npx wrangler d1 time-travel info DB --timestamp=<RFC3339>` and record
   the returned bookmark.
4. Run `npx wrangler d1 time-travel restore DB --bookmark=<BOOKMARK>`.
5. Verify the two pre-existing legacy records and the active staff allowlist.
6. Smoke-test the previous Sites version.

Time Travel restore is destructive to writes made after the selected point.
It therefore requires explicit production approval and a verified timestamp.
R2 files are independent of D1 and are not changed by either this migration or
the normal rollback.

If an explicitly approved structural rollback is required instead of Time
Travel, validate the down scripts on a copy first and run them newest-first:

1. `drizzle/rollback/0006_import_row_revision_index.down.sql`
2. `drizzle/rollback/0005_contact_normalized_name.down.sql`
3. `drizzle/rollback/0004_register_import.down.sql`
4. `drizzle/rollback/0003_source_expansion.down.sql`

`build/sites-vite-plugin.ts` explicitly excludes this directory from the
deployable migration bundle. Rollback SQL must never be packaged as an upward
production migration.

The `0006` rollback was executed against a copied D1 state on 2026-07-29 and
the index count returned zero. Do not delete R2 originals or extraction
sidecars during application/database rollback; they are audit evidence and may
be reattached during forward recovery.

## Forward recovery

If only search data is damaged, do not restore the whole database. Rebuild
`search_documents` and its FTS index from business-facing source tables in a
new reviewed migration. If one CRM row is wrong, correct that row and append
an audit entry rather than restoring the database.
