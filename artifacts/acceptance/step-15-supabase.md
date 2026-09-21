# Step 15 Supabase database cutover

## Implementation delivered

- `supabase/migrations/20260921000000_native_api_schema.sql` is generated from
  `backend/prisma/schema.prisma` and creates the complete native API schema in
  an isolated `native` schema. The legacy Expo tables remain in `public`.
- `backend/scripts/migrate-render-to-supabase.sh` copies Render `public` data
  into the native schema without copying Prisma migration metadata.
- `backend/scripts/start-render.sh` switches Render to `SUPABASE_DATABASE_URL`
  when that secret is configured, adds TLS, and forces
  `search_path=native,public` before applying Prisma migrations.
- `backend/scripts/verify-supabase-cutover.sh` checks the native schema and
  the tables required by the API.

## Operator cutover

The repository does not contain a Supabase database password or management
token, so the remote cutover must be run from an authenticated operator
machine. Do not put either credential in git, iOS config, or chat.

```bash
# 1. Apply the repository migrations to the linked Supabase project.
supabase link --project-ref kmwfgkibdqartalfsajy
supabase db push

# 2. Export both connection strings in the current shell only.
export SOURCE_DATABASE_URL='postgresql://...render.../lauver_staging?sslmode=require'
export SUPABASE_DATABASE_URL='postgresql://...supabase.../postgres?sslmode=require'

# 3. Verify schema, copy data, then verify row counts/checksums in the project.
cd backend
npm run db:verify:supabase
npm run db:migrate:render-to-supabase
npm run db:verify:supabase
```

Then add the same `SUPABASE_DATABASE_URL` as an encrypted Render environment
variable and deploy the pushed commit. `start-render.sh` makes the Supabase
database authoritative while retaining the Render database binding as a
rollback fallback during the observation window. Verify `/healthz`, `/readyz`,
login, profile, Match, events, Stream chat, Strava and account deletion before
removing the fallback or deleting the Render database.

## Current evidence

The migration files and cutover scripts are committed locally. Remote schema
push/data copy and post-cutover iPhone acceptance are not marked complete until
the Supabase credentialed commands above and the deployed Render checks succeed.

The non-simulator verification run on 2026-09-21 used the connected physical
iPhone 17e (`16753B2D-88AB-5D77-82BF-B1EA68946526`): native XCTest 109/109
passed; UI XCTest 19 passed, 5 were explicitly skipped because live acceptance
opt-ins were not set, and 2 existing live-staging checks failed (`testLiveMatchSummaryOnAuthenticatedDevice`,
`testLiveStreamChatConnectsOnDevice`). No app crash was observed. The run used
`xcodebuild -destination id=16753B2D-88AB-5D77-82BF-B1EA68946526`; no simulator
destination was used.
