# Step 15 Supabase database cutover

## Implementation delivered

- `supabase/migrations/20260921000000_native_api_schema.sql` is generated from
  `backend/prisma/schema.prisma` and creates the complete native API schema in
  an isolated `native` schema. The legacy Expo tables remain in `public`.
- `backend/scripts/migrate-render-to-supabase.sh` remains available for a
  future data cutover, but it is not part of this schema-only migration because
  Render staging contains disposable test data.
- `backend/scripts/start-render.sh` switches Render to `SUPABASE_DATABASE_URL`
  when that secret is configured, adds TLS, and forces
  `search_path=native,public` before applying Prisma migrations.
- `backend/scripts/verify-supabase-cutover.sh` checks the native schema and
  the tables required by the API.

## Schema-only migration

The Render staging test rows are intentionally not migrated. The production
cutover can start from the empty native schema below. Do not put database
credentials in git, iOS config, or chat.

```bash
# 1. Apply the repository migrations to the linked Supabase project.
supabase link --project-ref kmwfgkibdqartalfsajy
supabase db push

# 2. Verify the native schema. No Render data export is required.
cd backend
npm run db:verify:supabase
```

Then add `SUPABASE_DATABASE_URL` as an encrypted Render environment variable
and deploy the pushed commit. `start-render.sh` makes the empty Supabase native
schema authoritative while retaining the Render database binding as a rollback
fallback during the observation window. Verify `/healthz` and `/readyz` before
using fresh staging accounts for login, profile, Match, events, Stream chat,
Strava and account deletion.

## Current evidence

On 2026-09-21, the linked Supabase project `lauver`
(`kmwfgkibdqartalfsajy`) accepted
`supabase/migrations/20260921000000_native_api_schema.sql` through the
authenticated Management API database-query path. The remote verification
reported 30 native tables, 209 native columns, 61 native constraints and 17
Prisma migration ledger rows. No native schema existed before this operation.

Render staging data was intentionally excluded from scope, so the Render
external PostgreSQL connection is not required for this migration. Post-cutover
iPhone acceptance remains pending until Render is configured with
`SUPABASE_DATABASE_URL` and fresh staging accounts pass the smoke flow.

The non-simulator verification run on 2026-09-21 used the connected physical
iPhone 17e (`16753B2D-88AB-5D77-82BF-B1EA68946526`): native XCTest 109/109
passed; UI XCTest 19 passed, 5 were explicitly skipped because live acceptance
opt-ins were not set, and 2 existing live-staging checks failed (`testLiveMatchSummaryOnAuthenticatedDevice`,
`testLiveStreamChatConnectsOnDevice`). No app crash was observed. The run used
`xcodebuild -destination id=16753B2D-88AB-5D77-82BF-B1EA68946526`; no simulator
destination was used.
