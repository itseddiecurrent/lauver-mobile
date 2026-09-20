# Step 13 acceptance — Admin Report Dashboard

Date: 2026-09-21

## Implemented — first backend phase

- Added `admin_users`, `admin_sessions`, and immutable `admin_audit_logs` migration/models.
- Admin credentials are provisioned only by `npm run admin:create` with process environment variables; no public registration route exists.
- Admin session tokens are opaque, hashed at rest, short-lived, isolated from user JWTs, and sent in Secure/HttpOnly/SameSite=Strict cookies.
- State-changing admin requests require the separate readable CSRF cookie value in `x-csrf-token`; a cookie-only request is rejected.
- Added report queue/filter/detail endpoints, Open → In Review → Resolved/Dismissed workflow, user suspend/restore, event removal, and Stream message deletion endpoints.
- Every admin action records reason, before/after state, actor, request ID, and timestamp. Database trigger rejects audit updates/deletes.
- Suspended users lose Lauver sessions and cannot receive new Stream tokens.
- Match moderation evidence covers `match` and `like` report sources, including the `unmatch` context supported by the API.
- Suspension revokes the target user's swipes, active matches, Lauver sessions and Stream memberships; candidate listing and existing direct-chat writes are rejected afterward.

## Local evidence

- `npm run db:generate` — passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — 187 backend tests passed.
- `npm run build` — passed.
- `prisma validate` — passed.
- `/admin` serves the authenticated report queue/detail dashboard with filters, cursor pagination, evidence snapshots and moderation actions.
- Admin routes explicitly accept only `ADMIN` and `SUPER_ADMIN` identities; writes remain CSRF-protected.
- `npm run typecheck` and `npm run lint` — passed after adding the full Match/Like moderation fixture.

## Staging preflight evidence — 2026-09-17

- `GET https://lauver-api-staging.onrender.com/healthz` — passed (`200`, service `lauver-api`).
- `GET https://lauver-api-staging.onrender.com/readyz` — passed (`200`, database `ok`).
- `npm run verify:step-13:staging` passed against Render after CI run `35241856935` deployed `ac4fc53`: unauthenticated denial, UI shell, admin login, CSRF rejection, report queue (`1` report), and logout.
- `npm run verify:step-13:moderation` passed against Render on 2026-09-18: Profile, Direct Chat, Event and Event Chat reports; all report status transitions; suspend/restore; session/API/Stream-token rejection; event removal and group-chat revocation; Stream message deletion; unique audit logs for every moderation action; and logout.
- The moderation verifier creates disposable staging users/events/messages and uses random fixture names. No credentials are printed. Its PostgreSQL audit check uses TLS and all fixture-side assertions passed.

## Final staging and device verification — 2026-09-21

- `GET https://lauver-api-staging.onrender.com/healthz` — `200`, service `lauver-api`.
- `GET https://lauver-api-staging.onrender.com/readyz` — `200`, database `ok`.
- `npm run verify:step-13:moderation` — the verifier was extended to create a mutual Match before Direct Chat, then passed the Match, Like, Profile, Direct Chat, Event and Event Chat source checks plus suspension cleanup checks after the Render deploy.
- Native build target: connected `Edward的iPhone`, model `iPhone 17e (iPhone18,5)`, device ID `16753B2D-88AB-5D77-82BF-B1EA68946526`; no simulator was used.

## Acceptance result

Step 13 passes its staging/API/UI acceptance criteria. Product Owner visual sign-off for the broader native app remains tracked under Step 14A.
