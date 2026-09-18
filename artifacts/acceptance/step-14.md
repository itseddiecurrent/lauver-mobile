# Step 14 acceptance — Account deletion

Date: 2026-09-17

## Implemented

- `DELETE /v1/account` requires an authenticated Bearer session, the explicit `confirmation: "DELETE"` body, and the current Email-account password.
- Incorrect or missing re-authentication is rejected before a deletion job is created; Apple-authenticated accounts still require the Apple re-authentication provider flow before sign-off.
- Deletion is idempotent through the unique `account_deletion_jobs.user_id` record.
- The account is marked `DELETED`, all active sessions are revoked, and password-reset tokens are removed before the asynchronous cleanup job is queued.
- The worker retries external cleanup with bounded exponential backoff and never restores account access after a provider failure.
- Apple grant revocation, Strava grant revocation, Stream user deletion, current profile-photo deletion, and cascading relational data deletion are wired into the production server.
- Settings exposes Delete Account with a second confirmation alert and a password re-authentication sheet; successful completion clears the native session through the existing sign-out path and returns to Login.

## Automated evidence

- `cd backend && npm test` — **170/170 passed**.
- `cd backend && npm run lint` — **passed**.
- `cd backend && npm run typecheck` — **passed**.
- `cd backend && npm run build` — **passed**.
- `xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination "platform=iOS Simulator,id=F6A3D49F-DC24-40C3-A717-305EB0B9F4F5" -only-testing:LauverTests` — **106/106 passed**.
- `xcodebuild build -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging` — **passed** (simulator build; existing CLLocation concurrency warnings only).
- The full native test invocation was interrupted by the simulator test runner after package/build startup; it was not counted as a pass.

## Remaining acceptance / blockers

- PostgreSQL integration deletion tests have not run in this environment because `TEST_DATABASE_URL` and `DATABASE_URL` are unset.
- Render staging deletion E2E has not been run in this continuation. It must cover Email and Apple accounts, with/without Strava and HealthKit data, Chat/Event/report data, old-token rejection, database/object-storage/Stream cleanup, and retry after each external-provider failure.
- Email accounts now require current-password re-authentication before starting deletion. Apple-account re-authentication still needs an Apple credential hand-off from the native flow and provider-backed staging evidence.
- A real iPhone deletion run and confirmation that the post-delete app restart remains at Login are still required.

## Sign-off

**Not signed off.** Local unit/build and Simulator UI evidence is green, but staging provider cleanup, PostgreSQL integration evidence, real-device verification, and sensitive-operation re-authentication remain outstanding.
