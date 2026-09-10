# Step 04 Acceptance Record

> Status: implementation and available local verification complete; PostgreSQL CI plus external Apple/Render and real-device acceptance pending
>
> Last updated: 2026-09-06 (Asia/Shanghai)

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
not available; it must pass in CI before this section is finalized.

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
| PostgreSQL migration/integration suite | Not run locally — `TEST_DATABASE_URL` unavailable; CI required |

## External acceptance still required

1. In Apple Developer, register/enable Sign in with Apple for the staging App ID `ai.lauver.app.staging` and assign the signing team/profile.
2. Create a Sign in with Apple server key and enter its Team ID, Key ID, and p8 value directly in Render secrets.
3. Generate a 32-byte encryption key directly for Render and configure the staging Apple client ID; do not place either key in git or Xcode settings.
4. Enable `APPLE_AUTH_ENABLED=true`, deploy the migration/API, and verify `/readyz` after deployment.
5. On a real iPhone, create an account, sign out, and sign in again. Confirm the original name/email remain when Apple no longer returns them.
6. Revoke Lauver under Apple Account settings, relaunch, and confirm the app clears the saved session.
7. Search the signed archive strings and source history for Apple private-key material before marking Step 04 complete.

Step 04 must remain incomplete in `mvp.md` until these real Apple and staging checks pass.
