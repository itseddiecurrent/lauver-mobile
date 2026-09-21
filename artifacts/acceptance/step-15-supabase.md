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

## 2026-09-21 follow-up

- The currently connected physical device is `Edward的iPhone`, iPhone 17e,
  iOS 26.6.1, UDID `00008150-00010C6E22C0C01C`. The native test command was
  rerun with `-destination id=00008150-00010C6E22C0C01C`; no simulator
  destination was used.
- Render `GET /healthz` returned HTTP 200. Before this follow-up push, Render
  `GET /readyz` returned HTTP 503 (`service_unavailable`); the configured
  encrypted `SUPABASE_DATABASE_URL` will be exercised by the deployment
  triggered from this verified commit.
- The secret value is intentionally not stored in this repository. After the
  deployment, `/readyz` must return HTTP 200 and the post-cutover staging
  checks can proceed against the Supabase native schema.

## Render deployment follow-up (2026-09-21)

- The project owner manually triggered the Render deployment for commit
  `4c690b2`; the Render deployment completed successfully.
- Immediate and delayed probes still report `/healthz` HTTP 200 and `/readyz`
  HTTP 503 (`service_unavailable`). This means the web process is reachable,
  but its database `SELECT 1` readiness check is still failing. Supabase
  post-cutover E2E is therefore not marked passed until Render logs confirm
  the configured `SUPABASE_DATABASE_URL` connects and `/readyz` returns 200.

## TLS fix follow-up (2026-09-21)

- Render logs identified `SELF_SIGNED_CERT_IN_CHAIN` from Prisma's Supabase
  connection during profile-photo cleanup.
- Added shared PostgreSQL transport normalization for Prisma and the Strava
  `pg` pool: Supabase keeps TLS encryption with `rejectUnauthorized: false`
  for its managed CA chain; Render PostgreSQL keeps strict verification.
- Backend tests now pass 190/190, including three transport regression tests.
- The connected physical iPhone 17e rerun passed 109/109 native XCTest cases
  using UDID `00008150-00010C6E22C0C01C`; no Simulator destination was used.
- Render manually deployed the TLS fix from commit `b92f29b`. Post-deploy
  probes now return `/healthz` HTTP 200 and `/readyz` HTTP 200 with
  `{"database":"ok"}`. The Supabase database readiness blocker is cleared;
  post-cutover live E2E remains a separate acceptance step.

## Post-cutover API smoke (2026-09-21)

- Against the deployed Render API and Supabase native schema, two disposable
  users completed registration, Profile save, Match preferences, one-way Like,
  mutual Match and Matches listing.
- Both accounts then completed `DELETE /v1/account` with password
  reauthentication; old sessions immediately returned 401. The fixture was
  removed through the production deletion orchestration, with no direct write
  to the old Render database. Evidence:
  `artifacts/acceptance/step-15-post-cutover-smoke.log`.
