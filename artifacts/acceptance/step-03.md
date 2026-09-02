# Step 03 Acceptance Record

> Status: in progress — implementation, PostgreSQL/CI, and Render staging verification complete; real email delivery pending
>
> Last updated: 2026-09-02 (Asia/Shanghai)

## Scope

Step 03 implements Email/Password registration and login, Argon2id credential hashing, short-lived JWT access tokens, rotating refresh sessions stored only as hashes, logout and server-backed session restore, generic forgot-password behavior, single-use reset tokens, rate limiting, and the native register/login/reset/session UI with Keychain-only token storage.

Password-reset delivery is implemented through the server-side Resend API adapter. Delivery is fail-safe and disabled by default until a verified sender and API key are configured outside the repository.

## Verification environment

- Repository: `lauver-mobile`, implementation commit `f7d5b51`, guardrail follow-up `a890360`
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

## CI and PostgreSQL verification

[MVP CI run 33586632539](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/33586632539) passed all three jobs on 2026-09-02:

1. `guardrails` passed the Step 00–03 structure checks, scope guard, working-tree secret scan, and Gitleaks history scan;
2. `backend` reset a real PostgreSQL 17 test schema, deployed every migration from zero, passed the Step 03 database integration suite, built the production server and Docker image, and reported zero production dependency vulnerabilities;
3. `ios` passed the complete XCTest/XCUITest suite and staging/production built-configuration checks.

The first implementation run exposed five Gitleaks false positives for the exact synthetic password fixture `ReplacementHorse8`. `.gitleaksignore` now suppresses only those five commit/path/rule/line fingerprints; no detector or file is broadly excluded. The same Gitleaks 8.24.3 command passed locally before the follow-up was pushed.

## Render staging verification

Render deployed the Step 03 API and migration to `https://lauver-api-staging.onrender.com`. On 2026-09-02, `/healthz` and database-backed `/readyz` both returned HTTP 200. A generated non-production account then passed:

- registration and duplicate-email rejection;
- access-token session restore;
- refresh-token rotation;
- reused old-token rejection and revocation of the rotated token from the compromised session;
- wrong-password rejection and correct-password login;
- logout and immediate access-session invalidation;
- identical forgot-password responses for existing and missing accounts;
- invalid reset-token rejection.

The test printed no password or session token. The generated account remains isolated staging test data because account deletion is intentionally deferred to Step 14.

## Acceptance still required

- Configure `PASSWORD_RESET_DELIVERY=resend`, `RESEND_API_KEY`, and a verified `PASSWORD_RESET_FROM_EMAIL` directly in Render.
- Complete a real test-account password reset from delivered email through the native app and confirm the old password and old sessions are invalid.

Step 03 must remain incomplete in `mvp.md` until real email delivery and the delivered-token reset path pass.
