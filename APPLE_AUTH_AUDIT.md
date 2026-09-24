# Apple Sign In audit

## Pre-change audit (2026-09-24)

### Current architecture and critical path

`SignInWithAppleButton` in `LauverNative/Lauver/App/ContentView.swift` creates a random nonce and immediately presents Apple's native sheet. Its completion extracts `ASAuthorizationAppleIDCredential.identityToken` and the one-use `authorizationCode`, then invokes `AuthService` to POST `/v1/auth/apple`. The API route validates the body and calls `AuthService.signInWithApple`. The backend verifies the supplied identity token against Apple JWKS, exchanges the code at `https://appleid.apple.com/auth/token`, verifies the returned ID token, upserts the account by Apple `sub`, creates a local refresh-session row and signs the Lauver access JWT. The iOS view model writes the session to Keychain and switches to the authenticated app shell.

The supplied-token JWKS verification and token-code exchange are intentionally parallel. `jose`'s `createRemoteJWKSet` already caches Apple keys for one hour and refreshes on an unknown `kid` (subject to its 30 second anti-stampede cooldown); it is not fetched on every warm login.

### Likely latency/breakage points

1. The app used the shared API timeout (15s request / 30s resource), without a specific bounded Apple-auth budget or elapsed timing.
2. Server-to-Apple token exchange had only a five-second total abort; it emitted no DNS/socket/TLS/HTTP timing, and collapsed all transport failures into `unavailable`.
3. Backend stages (Apple verification, database upsert and session creation) had no stage timings, so a TestFlight report could not distinguish Apple native UI, phone-to-API, Apple exchange, or database latency.
4. The client showed internal Apple error details in a user message for native failures. Those details belong in safe diagnostics, not customer-facing text.

### Pre-change correctness findings

* The native request is guarded against duplicate taps and is not preceded by app networking; the Apple button is disabled while authorization/exchange is active.
* The server does validate RS256 signature, issuer, audience, expiration (via `jwtVerify`), hashed nonce, subject, and verified email. It validates both supplied and exchanged ID tokens and requires matching subjects.
* Apple `sub`, rather than email, is the primary identity mapping. Name/email are only used if returned; the transactional repository upsert avoids ordinary duplicate-account races.
* The Apple code is never retried by the iOS retry policy (`allowsConnectionRetry` remains false), which is required because it is single use.
* There is no WebView, blocking wait/semaphore, polling loop, or optional post-login work in the examined critical path.

### Proposed changes

Add safe stage timing on iOS and backend; set a shorter Apple API request timeout with no credential retry; instrument the backend Apple HTTP connection phases and status without credentials; preserve strict verification and JWKS cache behavior; report backend errors by type while keeping the user message actionable and non-internal; add deterministic timeout/error tests.

## Implementation update

### Files changed

* `ContentView.swift`, `AuthService.swift`, and `APIClient.swift`: safe TestFlight-visible `[AppleAuth]` stage timings, an explicit eight-second `/v1/auth/apple` request budget, and no retry of that POST.
* `backend/src/apple-auth.ts`, `auth.ts`, and `server.ts`: structured server stage records for Apple verification/exchange, DB account transaction, and local session creation.
* `backend/tests/apple-auth.test.ts`: deterministic Apple transport-timeout/no-retry coverage.

### Root cause and observability

The pre-existing implementation already avoided the common client-side causes (duplicate taps, polling, WebViews, synchronous waits, and JWKS-per-login downloads). It lacked the measurements needed to distinguish Apple-native delay from phone→API, server→Apple, database, or session work. The new logs use the requested stage names and elapsed millisecond fields, never request bodies or credentials. Backend Apple failures preserve their actual error name in structured diagnostics while returning the safe `apple_sign_in_unavailable` API outcome.

### Timeouts, caching, retries, and security

The iOS Apple API request now has an explicit 8s request timeout (the session resource ceiling remains 30s); it does not retry. The backend Apple token/revocation calls retain their 5s total `AbortSignal` budget and have no retry. This means a timeout requires a fresh native Apple operation and code; a consumed authorization code is never automatically reused.

`jose` keeps Apple JWKS in process for 1 hour, refreshes when it sees an unknown `kid`, and uses a 30-second refresh cooldown to prevent a stampede. Signature, RS256 algorithm, issuer, audience/client ID, expiry, nonce, subject, verified email, and matching returned-token subject checks remain mandatory. Refresh tokens stay AES-256-GCM encrypted at rest.

### Manual production/TestFlight checklist

The repository proves the release bundle is `ai.lauver.app.release` and Team ID is `94KFUD562T`; verify the deployed backend `APPLE_CLIENT_ID` exactly matches that App ID (or the configured Services ID if architecture changes), and that `APPLE_TEAM_ID`, `APPLE_KEY_ID`, p8 private key, and encryption key are production values. Confirm the TestFlight `API_BASE_URL` is the intended HTTPS deployment—not localhost/staging by accident—and that the App ID’s Sign in with Apple capability and the archive entitlement match. Native flow uses no redirect URI.

For server-region diagnosis, collect the new `[AppleAuth]` logs by request time: `APPLE_TOKEN_EXCHANGE_COMPLETE` shows server→Apple HTTP latency/status and `APPLE_TOKEN_VERIFY_COMPLETE` shows JWKS/JWT work. A consistently slow exchange across phone networks indicates backend egress/DNS/TLS path, not a user VPN; investigate the hosting provider’s route to `appleid.apple.com` rather than routing through the phone.

## TestFlight Failure Investigation

### TestFlight API host

The checked-in Production configuration is `LauverNative/Config/Production.xcconfig`, which resolves the TestFlight Release build to `https://lauver-api-staging.onrender.com` (host `lauver-api-staging.onrender.com`). Debug/Staging also use that host; their bundle IDs differ (`ai.lauver.app.staging` versus `ai.lauver.app.release`). This is staging accidentally/temporarily, not a production hostname. A shell check during this investigation reached both `/healthz` and `/readyz` with HTTP 200; `/readyz` reported `database: ok`.

### Did request reach backend?

Unknown for the reported attempt: deployment logs from that TestFlight session are not accessible in this repository. The next attempt will emit `APPLE_AUTH_REQUEST_RECEIVED` at the first route instruction and include the request ID, followed by request-ID-correlated Apple/backend stages. If that first event is absent, the failure is phone→API.

### Backend request ID

Not available for the reported attempt. The client now logs the response `x-request-id` and backend error code; the backend route logs the request ID at receipt and all Apple stages include it through request-scoped async context.

### Client failure category

The exact text `Unable to contact the authentication server. Please try again.` is produced only by `APIError.transport(.timedOut)`, i.e. a URLSession timeout. DNS failure, connection refusal, TLS failure, network loss, cancellation, HTTP 4xx/5xx, and JSON decoding do not currently map to that exact string. They have separate `APIError` cases/messages. The client now logs `transport_error type=backend_timeout|dns_failure|connection_failure|tls_failure|network_unreachable|cancelled`, HTTP status, backend code, request ID, and elapsed request time without credentials.

### Apple /auth/token result

Not reached/unknown for the reported attempt. The next backend attempt logs exchange start, elapsed time, HTTP status, Apple safe error type (`invalid_client`, `invalid_grant`, etc.), and transport exception class. It never logs codes, tokens, client secrets, or keys.

### Backend stage that failed

Unknown until the next attempt is correlated. The health checks show the host and database are currently responsive, but they do not exercise Apple verification or token exchange.

### Root cause

Not conclusively proven from the reported attempt because the TestFlight/device logs and Render deployment logs are not present here. The only proven facts are that the exact user-facing string denotes a client-side URLSession timeout and that TestFlight is pointed at the staging Render host. The new instrumentation is sufficient to identify A/B/C/D/E in one further attempt.

### Fix

Observability/error classification only at this stage; no timeout values were changed. Production/TestFlight host correction remains a deployment/configuration decision because this repository currently intentionally points Production at staging.

### Evidence

* `Production.xcconfig`: `API_BASE_URL = https://lauver-api-staging.onrender.com`.
* Direct checks at investigation time: `/healthz` HTTP 200 and `/readyz` HTTP 200 with database `ok`.
* `APIError.userMessage`: the exact displayed text is the `.transport(.timedOut)` branch only.
* No request ID or backend Apple stage log for the user’s attempt is available in the repository.

### Production Apple configuration verification

The backend requires `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and `APPLE_TOKEN_ENCRYPTION_KEY` whenever `APPLE_AUTH_ENABLED=true`. The client-secret implementation uses ES256 with `kid=APPLE_KEY_ID`, `iss=APPLE_TEAM_ID`, `sub=APPLE_CLIENT_ID`, `aud=https://appleid.apple.com`, `iat=now`, and a five-minute expiry. The repository does not contain deployed Render environment values, so the actual current `APPLE_CLIENT_ID`, Team ID, and Key ID cannot be truthfully confirmed from this workspace; no private key was printed. The next backend startup log emits the non-secret client/team/key identifiers for comparison with the TestFlight bundle (`ai.lauver.app.release`).

### Diagnostic changes for the next attempt

`APPLE_AUTH_REQUEST_RECEIVED` is now logged before body parsing/verification. The request-scoped ID is propagated through all Apple stage logs. The iOS client logs the API host, transport category, HTTP status, backend error code, response request ID, and elapsed request time. `/healthz` already exists and remains independent of Apple login.
