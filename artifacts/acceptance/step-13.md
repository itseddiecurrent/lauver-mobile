# Step 13 acceptance — Admin Report Dashboard

Date: 2026-09-17

## Implemented — first backend phase

- Added `admin_users`, `admin_sessions`, and immutable `admin_audit_logs` migration/models.
- Admin credentials are provisioned only by `npm run admin:create` with process environment variables; no public registration route exists.
- Admin session tokens are opaque, hashed at rest, short-lived, isolated from user JWTs, and sent in Secure/HttpOnly/SameSite=Strict cookies.
- State-changing admin requests require the separate readable CSRF cookie value in `x-csrf-token`; a cookie-only request is rejected.
- Added report queue/filter/detail endpoints, Open → In Review → Resolved/Dismissed workflow, user suspend/restore, event removal, and Stream message deletion endpoints.
- Every admin action records reason, before/after state, actor, request ID, and timestamp. Database trigger rejects audit updates/deletes.
- Suspended users lose Lauver sessions and cannot receive new Stream tokens.

## Local evidence

- `npm run db:generate` — passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test -- --pool=forks --poolOptions.forks.singleFork=true` — 170 tests passed.
- `npm run build` — passed.
- `prisma validate` — passed.
- `/admin` serves the authenticated report queue/detail dashboard with filters, cursor pagination, evidence snapshots and moderation actions.
- Admin routes explicitly accept only `ADMIN` and `SUPER_ADMIN` identities; writes remain CSRF-protected.

## Staging preflight evidence — 2026-09-17

- `GET https://lauver-api-staging.onrender.com/healthz` — passed (`200`, service `lauver-api`).
- `GET https://lauver-api-staging.onrender.com/readyz` — passed (`200`, database `ok`).
- `npm run verify:step-13:staging` — ready to run after staging admin credentials are provisioned; it checks unauthenticated denial, UI shell, admin login, CSRF enforcement, queue access and logout without printing secrets.
- 2026-09-17 execution — blocked before network login because `ADMIN_EMAIL` and `ADMIN_PASSWORD` are not present in the process environment or ignored env files; no credential was guessed or printed.
- The currently deployed `/admin` response does not contain the new `Admin sign in` / `Target moderation` UI markers, so the latest backend must be deployed before the verifier can pass.
- 2026-09-17 rerun — `npm run admin:create` succeeded against `STAGING_DATABASE_URL`; the current source was then run locally against the same staging database and `npm run verify:step-13:staging` passed: unauthenticated denial, UI shell, admin login, CSRF rejection, report queue (`1` report), and logout. No fixture or report mutation was performed.

## Remaining acceptance

- Provision a real staging admin and run `npm run verify:step-13:staging --prefix backend`.
- Verify report sources from Profile, Direct Chat, Event, and Event Chat in the queue.
- Verify suspend invalidates existing sessions and Stream token issuance; verify event removal and message deletion in real staging.
- Complete browser/UI evidence and Product Owner sign-off for `/admin`.
