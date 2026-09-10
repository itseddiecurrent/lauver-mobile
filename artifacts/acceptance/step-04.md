# Step 04 Acceptance Record

> Status: implementation, CI, Apple Developer setup, and Render staging verification complete; real-device acceptance and signed-archive secret audit pending
>
> Last updated: 2026-09-10 (Asia/Shanghai)

## Implemented

- Native Sign in with Apple control using `AuthenticationServices`, requested name/email scopes, and a cryptographically random SHA-256 nonce.
- Native forwarding of the identity token, one-time authorization code, raw nonce, and first-authorization name/email; the local Apple user identifier is never sent as identity proof.
- Keychain-only storage of the Apple credential identifier for launch-time credential-state checks.
- Launch checks and revoked-credential notifications that clear the Lauver session and return to sign-in.
- `POST /v1/auth/apple` with strict request validation and rate limiting.
- Apple JWKS caching plus RS256 signature, issuer, audience, expiry, verified-email, and nonce validation.
- Server-side ES256 client-secret creation and authorization-code exchange with Apple's token endpoint.
- AES-256-GCM storage of Apple refresh tokens and a migration for Apple identities/credentials.
- Transactional linking to an existing verified email identity, with a unique Apple subject preventing duplicate accounts.
- Fake-provider coverage for repeated sign-in and revoked credentials, plus cryptographic token-verification tests.

## Automated evidence

The workstation checks cover the structure/scope/secret guards, backend lint,
typecheck, unit tests, production build and audit, plus the native build and test
suites. The PostgreSQL migration integration command is not runnable on this
workstation because `TEST_DATABASE_URL` and a local PostgreSQL/Docker service are
not available; it passed against PostgreSQL 17 in CI.

| Check | Result |
|---|---|
| Step 00–04 structure guards | Pass |
| MVP scope and working-tree secret guards | Pass |
| Backend lint and typecheck | Pass |
| Backend unit and boundary tests | Pass — 60/60 |
| Backend production build | Pass |
| Backend production dependency audit | Pass — 0 vulnerabilities |
| Staging and production built iOS configuration | Pass |
| Native XCTest | Pass — 42/42 |
| Native XCUITest | Pass — 9/9 |
| PostgreSQL migration/integration suite | Pass in CI against PostgreSQL 17 |
| Signed staging device build | Pass — Apple Development profile for `ai.lauver.app.staging` includes Sign in with Apple |

[MVP CI run 34426537894](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34426537894)
passed the `guardrails`, `backend`, and `ios` jobs for implementation commit
`43fd796`. The Step 04 PostgreSQL migration deployed successfully.

## Apple and Render staging verification

Completed on 2026-09-10 without recording any secret values:

1. The staging App ID `ai.lauver.app.staging` is registered under Team
   `94KFUD562T`, has Sign in with Apple enabled, and has a matching provisioning
   profile.
2. A Sign in with Apple server key was created and its Team ID, Key ID, and p8
   value were configured directly in Render.
3. A separate base64-encoded 32-byte token-encryption key and the staging Apple
   client ID were configured directly in Render.
4. `APPLE_AUTH_ENABLED=true` was deployed with commit `43fd796`.
5. `/readyz` returned HTTP 200 with `database: ok` after deployment migration.
6. A syntactically valid request containing only synthetic invalid Apple proof
   returned HTTP 401 `invalid_apple_credential`. This confirms that the deployed
   Apple route and provider are enabled without creating an account or exposing
   real credentials.

## External acceptance still required

1. On a real iPhone, create an account, sign out, and sign in again. Confirm the
   original name/email remain when Apple no longer returns them.
2. Revoke Lauver under Apple Account settings, relaunch, and confirm the app
   clears the saved session.
3. Search the signed archive strings and source history for Apple private-key
   material before marking Step 04 complete.

Step 04 must remain incomplete in `mvp.md` until the real-device and signed-archive checks pass.
