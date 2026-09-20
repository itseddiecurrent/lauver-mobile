# Step 14 acceptance — Account deletion

Date: 2026-09-21

## Implemented

- `DELETE /v1/account` requires an authenticated Bearer session, the explicit `confirmation: "DELETE"` body, and re-authentication. Email accounts use the current password; Apple accounts use a fresh Apple authorization and provider-subject match.
- Deletion is idempotent through the unique `account_deletion_jobs.user_id` record.
- The account is marked `DELETED`, all active sessions are revoked, and password-reset tokens are removed before the asynchronous cleanup job is queued.
- The worker retries external cleanup with bounded exponential backoff and never restores account access after a provider failure.
- Cleanup now collects the legacy primary photo, every `ProfilePhoto` object key (up to nine) and every pending `ProfilePhotoUpload` object key, de-duplicates them, and removes related photo cleanup jobs.
- Apple grant revocation, Strava grant revocation, Firebase user deletion, Stream user deletion, and cascading relational data deletion are wired into the production server.
- Reports where the account is reporter or target are deleted before user deletion so immutable moderation snapshots cannot retain personal profile data. Safety audit foreign keys remain anonymized by their existing `SET NULL` policy.
- Settings exposes Delete Account with a second confirmation alert and a re-authentication sheet; successful completion clears Keychain credentials, disconnects Stream/local chat state, returns to Login, and remains at Login after relaunch.

## Automated evidence

- `cd backend && npm test` — **171/171 passed** (2026-09-17 baseline).
- `npm test --prefix backend -- --maxWorkers=1` — **187/187 passed**, including 6 account-deletion tests (2026-09-21).
- `npm run build --prefix backend` — **passed**.
- Swift/XCTest on the physical iPhone 17e — **108/108 passed**.
- Existing Render staging Email + Strava and Apple + avatar deletion runs passed: both old access/refresh sessions were rejected, the database rows and Stream user were absent after cleanup, and the app returned to Login after relaunch.

## Physical iPhone 17e evidence

- Device: `Edward的iPhone`, iPhone 17e, iOS 26.6.1, UDID `16753B2D-88AB-5D77-82BF-B1EA68946526`.
- Command used (physical device; no Simulator destination):

  ```bash
  xcodebuild test \
    -project LauverNative/Lauver.xcodeproj \
    -scheme Lauver-Staging \
    -destination 'id=16753B2D-88AB-5D77-82BF-B1EA68946526' \
    -resultBundlePath artifacts/acceptance/step-14-device-20260921.xcresult \
    -parallel-testing-enabled NO
  ```

- `testSettingsDeleteAccountRequiresConfirmationAndReturnsToLogin` passed on-device, including confirmation cancellation, re-authentication UI, deletion submission and Login return.
- `testStep14AVisualBaseline`, small/large accessibility checks and non-live profile/match/settings regression cases passed.
- Full UI suite result: 26 executed, 19 passed, 5 skipped by explicit live-acceptance guards, 2 failed because this environment did not provide the separate live two-account Match/Stream opt-in fixtures (`testLiveMatchSummaryOnAuthenticatedDevice`, `testLiveStreamChatConnectsOnDevice`). These are recorded as a live-staging prerequisite, not as a Step 14 deletion failure.

## Render staging evidence

- Deployment target: `https://lauver-api-staging.onrender.com` from the repository `render.yaml` blueprint.
- Render auto-deploys the pushed commit and runs `npm run db:migrate:deploy && npm start`; no local server is used for acceptance.
- Post-deploy probes: `/healthz` returned `{"status":"ok","service":"lauver-api"}` and `/readyz` returned `{"status":"ready","service":"lauver-api","database":"ok"}`.

## Sign-off

**Signed off for Step 14 account deletion.** The remaining live Match/Stream UI failures belong to the separately guarded live staging acceptance and do not exercise the account-deletion path.
