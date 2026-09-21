# Final release test report

Date: 2026-09-21

## Verified

| Area | Evidence | Result |
| --- | --- | --- |
| Backend unit and authorization | `backend` Vitest | 190/190 passed |
| PostgreSQL migration-from-zero and integration | `artifacts/acceptance/step-15-integration.log` | 17 migrations, 71/71 passed |
| Scope and secret scans | `artifacts/acceptance/step-15-release-hardening.log` | Passed for source and archive |
| iOS archive/export | `artifacts/acceptance/step-15-production-distribution-archive-20260921.log`, `artifacts/acceptance/step-15-production-distribution-export-20260921.log` | Production archive and App Store Connect export succeeded for `ai.lauver.app.release`; IPA is Apple Distribution signed with Store profile, HealthKit and Sign in with Apple entitlements |
| Physical iPhone 17e native tests | `artifacts/acceptance/step-15-iphone17e-unit-current.log` | 109/109 passed, explicit physical-device destination, no Simulator |
| Step 15 UI follow-up on physical iPhone 17e | `artifacts/acceptance/step-15.md` | 3/3 targeted UI tests passed; login environment label removed, incomplete-profile Discover/Match prompts verified in English and Simplified Chinese, and Chinese Discover/Events labels verified |
| Render/Supabase readiness | `/healthz`, `/readyz` | HTTP 200; database `ok` |
| Post-cutover API smoke | `artifacts/acceptance/step-15-post-cutover-smoke.log` | Two disposable users, Match and account deletion passed |

## Still requires external Apple delivery access

- TestFlight upload/processing for the existing `ai.lauver.app.release` App ID.
- App Store Connect App Privacy, Review Notes, review demo account and internal E2E sign-off.
- The public-release API/DNS/TLS cutover remains outstanding.  This internal TestFlight build intentionally uses the existing healthy Render staging API, `https://lauver-api-staging.onrender.com`, so no additional Render service is created.
- Final product-owner sign-off for the remaining full UI/TestFlight flow.

The repository deliberately does not contain provider secrets, database URLs,
Apple private keys or TestFlight credentials.
