# Final release test report

Date: 2026-09-21

## Verified

| Area | Evidence | Result |
| --- | --- | --- |
| Backend unit and authorization | `backend` Vitest | 190/190 passed |
| PostgreSQL migration-from-zero and integration | `artifacts/acceptance/step-15-integration.log` | 17 migrations, 71/71 passed |
| Scope and secret scans | `artifacts/acceptance/step-15-release-hardening.log` | Passed for source and archive |
| iOS archive | `artifacts/acceptance/step-15-archive-latest.log`, `artifacts/acceptance/step-15-production-archive-20260921.log` | Staging archive succeeded; Production archive is blocked by Apple bundle-ID/capability provisioning |
| Physical iPhone 17e native tests | `artifacts/acceptance/step-15-iphone17e-current-unit.log` | 109/109 passed, explicit physical-device destination, no Simulator |
| Step 15 UI follow-up on physical iPhone 17e | `artifacts/acceptance/step-15.md` | 3/3 targeted UI tests passed; login environment label removed, incomplete-profile Discover/Match prompts verified in English and Simplified Chinese, and Chinese Discover/Events labels verified |
| Render/Supabase readiness | `/healthz`, `/readyz` | HTTP 200; database `ok` |
| Post-cutover API smoke | `artifacts/acceptance/step-15-post-cutover-smoke.log` | Two disposable users, Match and account deletion passed |

## Still requires external Apple delivery access

- Production App ID `ai.lauver.app` owned by the active team, HealthKit and Sign in with Apple capabilities, distribution certificate/profile, signed IPA and TestFlight upload.
- App Store Connect App Privacy, Review Notes and review demo account.
- A reachable Production API behind the Production scheme (currently `https://api.lauver.ai` does not return the health check from this machine).
- Final product-owner sign-off for the remaining full UI/TestFlight flow.

The repository deliberately does not contain provider secrets, database URLs,
Apple private keys or TestFlight credentials.
