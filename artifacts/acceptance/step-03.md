# Step 03 Acceptance Record

> Status: in progress — implementation and local non-database verification complete; external acceptance pending
>
> Last updated: 2026-09-02 (Asia/Shanghai)

## Scope

Step 03 implements Email/Password registration and login, Argon2id credential hashing, short-lived JWT access tokens, rotating refresh sessions stored only as hashes, logout and server-backed session restore, generic forgot-password behavior, single-use reset tokens, rate limiting, and the native register/login/reset/session UI with Keychain-only token storage.

Password-reset delivery is implemented through the server-side Resend API adapter. Delivery is fail-safe and disabled by default until a verified sender and API key are configured outside the repository.

## Verification environment

- Repository: `lauver-mobile`, uncommitted Step 03 working tree based on `main` at `bccca4f`
- macOS/Xcode: same local workstation used for Step 02; Xcode 26.6 (`17F113`)
- iOS Simulator: iOS 26.5, UDID `4423DF1C-0121-4788-8BEC-1D3CCF9C6BBC`
- macOS: `26.4.1` (`25E253`)
- Node.js: `v26.7.0` (allowed by `>=24 <27`)
- npm: `11.19.0`
- Local PostgreSQL/Docker: unavailable
- Real email-provider credentials used: none
- UI-test accounts: deterministic in-process fakes only; no real user credentials

## Completed local verification

| Check | Result | Evidence |
|---|---|---|
| Backend lint | Pass | `npm run lint` |
| Backend typecheck | Pass | `npm run typecheck` |
| Backend unit/boundary tests | Pass | 46/46 tests across 9 files |
| Backend production build | Pass | `npm run build` |
| Production dependency audit | Pass | `npm audit --omit=dev` reported 0 vulnerabilities after one transient registry TLS retry |
| Native XCTest | Pass | 36/36 tests, including API errors, auth contracts, Keychain session atomicity, successful and rejected restore/refresh behavior, and prior Step 02 regression coverage |
| Native auth XCUITest | Pass | Six unaffected UI cases passed in the combined run; the three auth-entry cases passed in a focused rerun after removing a software-keyboard visibility assumption |
| Built iOS configuration | Pass | Staging and production schemes retained distinct environment, API URL, and bundle identifier values |
| Guardrails and diff hygiene | Pass | Step 03 structure, MVP scope, working-tree secret scan, and `git diff --check` passed |
| Password-reset provider adapter | Pass with fake provider | Request authentication, idempotency, payload minimization, and provider failure behavior tested without a real API key |

The initial combined UI run exposed a Simulator-setting-dependent assertion that required the software keyboard accessibility node to exist after every secure-field focus. Product behavior was not failing. The assertion was relaxed, and only the three affected auth cases were rerun; all passed. The expensive unaffected cases were not rerun unnecessarily.

## Acceptance still required

- Run the Step 03 migration and auth integration suite against PostgreSQL from an empty schema.
- Pass GitHub Actions guardrails/backend/iOS jobs for the Step 03 change.
- Deploy the migration and API changes to Render staging, then verify register, logout, login, refresh rotation/reuse rejection, and session restore against the real staging database.
- Configure `PASSWORD_RESET_DELIVERY=resend`, `RESEND_API_KEY`, and a verified `PASSWORD_RESET_FROM_EMAIL` directly in Render.
- Complete a real test-account password reset from delivered email through the native app and confirm the old password and old sessions are invalid.

Step 03 must remain incomplete in `mvp.md` until these database, CI, staging, and real-delivery checks pass.
