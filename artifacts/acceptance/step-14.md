# Step 14 acceptance — Account deletion

Date: 2026-09-17

## Implemented

- `DELETE /v1/account` requires an authenticated Bearer session and the explicit `confirmation: "DELETE"` body.
- Deletion is idempotent through the unique `account_deletion_jobs.user_id` record.
- The account is marked `DELETED`, all active sessions are revoked, and password-reset tokens are removed before the asynchronous cleanup job is queued.
- The worker retries external cleanup with bounded exponential backoff and never restores account access after a provider failure.
- Apple grant revocation, Strava grant revocation, Stream user deletion, current profile-photo deletion, and cascading relational data deletion are wired into the production server.
- Settings exposes Delete Account with a second confirmation alert; successful completion clears the native session through the existing sign-out path and returns to Login.

## Automated evidence

- `cd backend && npm test` — **169/169 passed**.
- `cd backend && npm run lint` — **passed**.
- `cd backend && npm run typecheck` — **passed**.
- `cd backend && npm run build` — **passed**.
- `xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination "platform=iOS Simulator,id=F6A3D49F-DC24-40C3-A717-305EB0B9F4F5" -only-testing:LauverTests` — **106/106 passed**.
- The deletion-focused native UI test `testSettingsDeleteAccountRequiresConfirmationAndReturnsToLogin` — **passed**; it verified cancel/confirm behavior and return to Login.

## Remaining acceptance / blockers

- PostgreSQL integration deletion tests have not run in this environment because `TEST_DATABASE_URL` and `DATABASE_URL` are unset.
- Render staging deletion E2E has not been run in this continuation. It must cover Email and Apple accounts, with/without Strava and HealthKit data, Chat/Event/report data, old-token rejection, database/object-storage/Stream cleanup, and retry after each external-provider failure.
- The product requirement calls for sensitive-operation re-authentication. Current implementation has an explicit confirmation phrase but does not request a password or Apple re-authentication before starting deletion. Step 14 cannot be signed off until this is implemented and tested, or the requirement is formally revised.
- A real iPhone deletion run and confirmation that the post-delete app restart remains at Login are still required.

## Sign-off

**Not signed off.** Local unit/build and Simulator UI evidence is green, but staging provider cleanup, PostgreSQL integration evidence, real-device verification, and sensitive-operation re-authentication remain outstanding.
