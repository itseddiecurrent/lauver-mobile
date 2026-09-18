# Step 14 acceptance — Account deletion

Date: 2026-09-17

## Implemented

- `DELETE /v1/account` requires an authenticated Bearer session, the explicit `confirmation: "DELETE"` body, and the current Email-account password.
- Incorrect or missing re-authentication is rejected before a deletion job is created. Email accounts use the current password; Apple accounts use a fresh Apple authorization and provider-subject match.
- Deletion is idempotent through the unique `account_deletion_jobs.user_id` record.
- The account is marked `DELETED`, all active sessions are revoked, and password-reset tokens are removed before the asynchronous cleanup job is queued.
- The worker retries external cleanup with bounded exponential backoff and never restores account access after a provider failure.
- Apple grant revocation, Strava grant revocation, Stream user deletion, current profile-photo deletion, and cascading relational data deletion are wired into the production server.
- Settings exposes Delete Account with a second confirmation alert and a password re-authentication sheet; successful completion clears the native session through the existing sign-out path and returns to Login.

## Automated evidence

- `cd backend && npm test` — **171/171 passed**.
- `cd backend && npm run lint` — **passed**.
- `cd backend && npm run typecheck` — **passed**.
- `cd backend && npm run build` — **passed**.
- `xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination "platform=iOS Simulator,id=F6A3D49F-DC24-40C3-A717-305EB0B9F4F5" -only-testing:LauverTests` — **106/106 passed**.
- `xcodebuild build -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging` — **passed** (simulator build; existing CLLocation concurrency warnings only).
- Render staging smoke using a disposable Email account — **passed**: registration, password re-authenticated deletion (`202`), and old access-token rejection (`401`). Deletion job: `6e26ea20-0dc3-4c54-9b18-21038c33a0f2`.
- Render staging Strava-connected account — **passed**: Strava status was `connected`, password re-authenticated deletion returned `202`, both old access and refresh tokens returned `401`, and PostgreSQL recorded deletion job `f3588ff7-e8be-4499-bce1-0467b43d6786` as `COMPLETED` on attempt 1 with no error; the associated user row was absent after cleanup.
- Stream cleanup verification for the same job — **passed**: the deleted user id from the completed job returned zero Stream users.
- The full native test invocation was interrupted by the simulator test runner after package/build startup; it was not counted as a pass.

## Remaining acceptance / blockers

- PostgreSQL integration deletion tests have not run in this environment because `TEST_DATABASE_URL` and `DATABASE_URL` are unset.
- Render staging deletion E2E still lacks a real Apple-authenticated account and a photo-bearing object-storage fixture; the Email and Strava-connected paths, old-token rejection, PostgreSQL cleanup, and Stream cleanup are now verified.
- Email accounts require current-password re-authentication before starting deletion. Apple accounts now require a fresh Apple credential and subject match; provider-backed staging evidence is still pending.
- A real iPhone deletion run and confirmation that the post-delete app restart remains at Login are still required.

## Sign-off

**Not signed off.** Local unit/build and Simulator UI evidence is green, but staging provider cleanup, PostgreSQL integration evidence, real-device verification, and sensitive-operation re-authentication remain outstanding.
