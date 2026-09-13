# Lauver Native iOS MVP

This repository contains the legacy React Native prototype plus the new native iOS MVP and its Node.js backend. The marketing website at [lauver.ai](https://lauver.ai/) is maintained separately and is not rebuilt here.

The authoritative MVP scope is in [`mvp.md`](mvp.md). The native implementation must not include AI features, Garmin sync, paid subscriptions, in-app purchases, or Tinder-style swipe/match behavior.

## Repository layout

```text
LauverNative/          Native SwiftUI Xcode project
backend/               TypeScript Express API
openapi/mvp.yaml       REST contract
scripts/               Scope, secret, iOS, and per-step test scripts
artifacts/acceptance/  Per-step verification records
src/                   Legacy React Native prototype; reference only
```

## Requirements for Step 00

You need:

- macOS with the current stable full Xcode installation, including an iOS Simulator;
- Xcode command-line selection pointing to the full app, not Command Line Tools only;
- Node.js 24 LTS or a compatible version declared in `backend/package.json`;
- npm;
- ripgrep (`rg`) for the local secret scanner;
- a GitHub repository with Actions enabled to run the macOS iOS test job.

No Apple, Strava, Stream, Render, database, or object-storage secret is required for Step 00. Those credentials are introduced only in the step that consumes them.

If `xcodebuild` reports that Command Line Tools is active, install Xcode and run:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

An Apple Developer Team ID is not needed for Simulator tests. Xcode applies local ad-hoc Simulator signing so the Keychain integration test can exercise the real Security framework. Copy `LauverNative/Config/Local.xcconfig.example` to an ignored local config only when device signing is introduced.

## Backend and PostgreSQL setup

Step 01 uses PostgreSQL 17 and Prisma. The recommended local setup is Docker Desktop:

```bash
cd backend
docker compose up --detach postgres
cp .env.example .env
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run dev
```

The Compose service creates persistent `lauver` and disposable `lauver_test` databases. If the volume existed before the test database initializer was added, create `lauver_test` manually or recreate only that development volume after confirming it contains no needed data.

If you use an independently installed PostgreSQL server, create both databases and update the ignored `backend/.env` file with their connection strings.

Verify liveness and database readiness separately:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

Expected responses:

```json
{"status":"ok","service":"lauver-api"}
```

```json
{"status":"ready","service":"lauver-api","database":"ok"}
```

## Email/password authentication

Step 03 adds Argon2id password credentials, short-lived signed access tokens, rotating hashed refresh sessions, logout/session restore, and single-use password-reset tokens. The iOS app stores both session tokens only in Keychain.

Local and newly created Render environments default to `PASSWORD_RESET_DELIVERY=disabled`. Registration, login, refresh, logout, and session restore still work in that mode, but password-reset email cannot be delivered. To enable reset delivery with Resend:

1. verify a sender domain in Resend;
2. set `PASSWORD_RESET_DELIVERY=resend`;
3. set `RESEND_API_KEY` as a secret environment variable;
4. set `PASSWORD_RESET_FROM_EMAIL` to an address on the verified domain;
5. restart the API and run a reset request against a non-production test account.

The API key and reset token must never be logged or placed in iOS configuration. The public forgot-password response is deliberately identical whether an account exists or delivery succeeds. Reset messages contain a short-lived, one-time token that users enter in the native app.

## Tests

Run all Step 00 checks:

```bash
./scripts/test-step-00.sh
```

Run all Step 01 backend checks after PostgreSQL is healthy:

```bash
./scripts/test-step-01.sh
```

Run the Step 02 native shell, API client, Keychain, state-component, and UI navigation checks:

```bash
./scripts/test-step-02.sh
```

Run all Step 03 backend migration/authentication and native auth-flow checks after PostgreSQL is healthy:

```bash
./scripts/test-step-03.sh
```

Run Step 04 Apple authentication, encryption, migration, native capability, and regression checks:

```bash
./scripts/test-step-04.sh
```

Run Step 05 workout-profile, location privacy, image validation, and native Profile checks:

```bash
./scripts/test-step-05.sh
```

After deploying Step 05 to Render staging, verify the running profile/photo flow:

```bash
python3 scripts/verify-step-05-staging.py
```

This creates two generated staging accounts, checks profile persistence and public
location privacy, then tests the photo lifecycle and completion replay. It clears
their profiles/photos and revokes sessions on success or failure. Empty test
accounts remain until the later account-deletion step. If cleanup fails, the
script saves a private recovery file; retry with
`python3 scripts/verify-step-05-staging.py --cleanup-state /path/from/output.json`.
No storage credentials are needed, and tokens and signed URLs are never printed.

`npm run test:integration` resets the `public` schema of `TEST_DATABASE_URL` before applying every migration. As a safety boundary, the database name must end in `_test`; remote resets also require `ALLOW_REMOTE_TEST_DATABASE_RESET=true`.

Run checks separately:

```bash
./scripts/tests/check-mvp-scope.test.sh
./scripts/tests/check-secrets.test.sh
./scripts/tests/select-ios-simulator.test.sh
./scripts/tests/check-step-00-structure.test.sh
./scripts/tests/check-step-01-structure.test.sh
./scripts/tests/check-step-02-structure.test.sh
./scripts/tests/check-step-03-structure.test.sh
./scripts/tests/check-step-04-structure.test.sh
./scripts/tests/check-step-05-structure.test.sh
./scripts/tests/check-step-06-structure.test.sh
./scripts/check-mvp-scope.sh
./scripts/check-secrets.sh

cd backend
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit --omit=dev

cd ..
./scripts/test-ios.sh
./scripts/test-ios-config.sh
```

The iOS script prefers an already booted iPhone Simulator, then falls back to the first available iPhone. Set `SIMULATOR_UDID` to choose a specific device or `IOS_TEST_TIMEOUT_SECONDS` to override the 15-minute safety timeout. The staging scheme calls `https://lauver-api-staging.onrender.com/healthz`; production remains configured independently.

## Configuration boundaries

- Public iOS configuration lives in `.xcconfig` files.
- Backend configuration is documented in `backend/.env.example`.
- Real `.env` files, private keys, OAuth secrets, tokens, and signing files must never be committed.
- Staging and production use separate API base URLs and, in later steps, separate third-party applications.

## Sign in with Apple

The iOS target contains the public Sign in with Apple entitlement and uses the official AuthenticationServices control. It creates a new random nonce for every attempt, sends only Apple's signed proof and one-time code to the API, and stores the local credential identifier in Keychain solely for Apple credential-state checks.

Apple auth is disabled by default on a new backend. For each environment, configure `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and a separately generated `APPLE_TOKEN_ENCRYPTION_KEY` directly in Render, then set `APPLE_AUTH_ENABLED=true`. The native iOS flow does not supply a web redirect URI; the API validates its one-time code directly against Apple's token endpoint. Never put the p8 key, generated client secret, token-encryption key, or Apple refresh token in the iOS project.

## Workout profiles, city privacy, and photos

Step 05 adds authenticated `GET/PATCH /v1/me`, public-profile reads, deterministic pace units/brackets, preferred training times, and profile completeness. The iOS app uses MapKit only after the user opens the city picker. The API stores the selected city center for approximate-distance filtering, while `GET /v1/users/:userId` deliberately omits latitude and longitude.

Profile photos use a short-lived signed PUT followed by `POST /v1/me/photo/complete`. Completion fully decodes the object, checks its declared content type, byte count, and pixel dimensions, then re-encodes it as a bounded JPEG without EXIF/GPS metadata before exposing it. Pending, replaced, and deleted keys enter a durable cleanup queue so transient storage failures do not create permanent orphan objects. Configure a private upload-capable S3-compatible bucket and a public read/CDN base URL per environment, then set:

```text
PROFILE_PHOTO_STORAGE_ENABLED=true
OBJECT_STORAGE_ENDPOINT=...
OBJECT_STORAGE_REGION=...
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_PUBLIC_BASE_URL=...
OBJECT_STORAGE_FORCE_PATH_STYLE=false
```

Only the backend receives storage credentials. Use a bucket policy or CDN configuration that permits public reads solely for the `profile-photos/` prefix; keep listing and writes private. CORS must permit PUT from the native upload client as required by the chosen provider. JPEG/PNG/HEIC/HEIF files are accepted up to 5 MB, with dimensions from 128 through 4096 pixels. The native picker center-crops and compresses selections to JPEG before upload.

## Container and Render deployment

Build the production API image from the repository root:

```bash
docker build --tag lauver-api:step-01 backend
```

The image runs as the unprivileged `node` user and expects `DATABASE_URL`, `HOST`, `PORT`, and the optional settings documented in `backend/.env.example`. Apply migrations before starting a new application image.

The root `render.yaml` defines a Singapore staging web service and PostgreSQL database. In Render:

1. Create a Blueprint from this repository and review the selected service/database plans before applying it.
2. Keep the generated `DATABASE_URL` binding; do not copy it into source control.
3. On the free web-service plan, Render runs `npm run db:migrate:deploy && npm start` as the start command because pre-deploy commands are unavailable. Prisma safely skips migrations that are already applied; a migration failure prevents the API process from starting.
4. After the first deploy, record the assigned `onrender.com` URL in `artifacts/acceptance/step-01.md` and verify both health endpoints.

## Current external setup still needed

Step 01 Render staging acceptance is complete. Before later steps, the project owner will still need to provide or create:

- Apple Developer Program access and the `ai.lauver.app` App ID;
- a Render production project (staging is defined by `render.yaml`);
- Strava staging/production applications;
- Stream Chat staging/production applications;
- an S3-compatible object-storage bucket;
- a Resend project, API key, and verified sender domain for password-reset delivery;
- accessible Privacy Policy and Terms URLs.

Never send secrets in chat or commit them to this repository. Add them directly to the appropriate provider dashboard or local ignored environment file.

## Discover manual filters (Step 06)

The native Discover tab is a normal list with a filter sheet, pull-to-refresh, Load more, and navigation to public profiles. `GET /v1/discover` accepts optional `sport`, `radius` (5/10/20/25/30/40/50/60/70/80/90/100 km or `unlimited`, default 25), `paceMin` / `paceMax` (inclusive numeric bounds), `limit` (1–50, default 20), and a signed `cursor`. Unlimited removes the distance cap and keeps city-centre distance sorting, location privacy, all exclusions and cursor pagination. Pace filtering requires a sport because units differ. The filter sheet accepts mm:ss for running/trail running/walking/hiking (per km), swimming (per 100 m) and rowing (per 500 m); cycling uses km/h. Duration bounds are sent as decimal minutes in the sport’s unit. Either end may be blank; both bounds must be in ascending numeric order. It does not label users by subjective pace categories. Users without a self-reported pace remain visible only when neither pace bound is set.

Distances use city-centre Haversine calculations with Earth radius 6371.0088 km. SQL orders by unrounded distance ascending, profile update time descending, and user UUID ascending. The public response rounds distance to whole kilometres and omits coordinates. Each request excludes both directions of `blocks`, plus the caller and incomplete/suspended/deleted profiles. Step 06 establishes the minimal blocks schema; Step 07 adds its management and report APIs.

A saved caller city is required (otherwise `discover_city_required`, HTTP 422). Cursors use a domain-separated HMAC with the existing backend access-token secret and bind the caller, city and filters. A changed context or invalid cursor returns `invalid_discover_cursor`, HTTP 422; refresh starts over. Pagination guarantees apply to unchanged data; profiles edited during traversal can change their ordering.

Run `./scripts/test-step-06.sh` with an isolated `TEST_DATABASE_URL` to run migrations, backend tests, both iOS configurations, and Simulator tests. Evidence and remaining staging/device checks are recorded in `artifacts/acceptance/step-06.md`.

For example, a running range of `5:01`–`5:30` sends `paceMin=5.016666666666667&paceMax=5.5`; cycling at 20–30 km/h sends `paceMin=20&paceMax=30`. Profile values and Discover bounds share six-decimal storage precision so whole-second endpoints match. Migration `20260913010000_explicit_pace_ranges` expands stored precision, preserves the displayed whole seconds of legacy duration paces, removes derived category data and indexes sport with the actual pace value.

### Automated staging acceptance and complete fixture deletion

Step 06 has a verifier that creates 34 generated Email test accounts, runs Discover filtering, ordering, pagination, location privacy and bidirectional block checks, then deletes every generated account and its dependent database rows. It uses the real staging API for login, profile writes and queries. Synthetic city centres and fixed timestamps make distance boundaries and sorting repeatable; direct database fixtures supply suspended/deleted states and blocks because those management endpoints are later steps.

The account-deletion API is not implemented yet, so complete removal requires a PostgreSQL connection to the **same** `lauver_staging` database used by the API. Copy the example and enter the staging external connection URL from Render into the ignored file:

```bash
cp backend/.env.staging.example backend/.env.staging
npm run verify:step-06:staging --prefix backend
```

Set `STAGING_DATABASE_URL` in `backend/.env.staging` before running the command. If your database's external-access rules restrict connections, allow the machine running the verifier. The verifier permits only `https://lauver-api-staging.onrender.com` and the `lauver_staging` database, and automatically enables verified TLS for external PostgreSQL connections. On a Render staging runtime, it can also use the existing `DATABASE_URL` when `NODE_ENV=staging`.

Successful output ends with `"result":"passed"` and `"deletedAccounts":34`. A failed assertion or Ctrl+C also triggers cleanup. The script writes a private cleanup journal **before** creating any accounts; if cleanup cannot finish, keep the printed file and retry:

```bash
npm run verify:step-06:staging --prefix backend -- --cleanup-state /path/from/output/cleanup.json
```

Cleanup selects exact emails belonging to that random run, verifies they have no external credentials/photos/uploads, deletes users transactionally, checks cascade removal, and verifies the old viewer session returns 401. Passwords, tokens and database connection strings are never printed. This verifier does not reset the database schema. It does not keep accounts for manual iPhone testing; it removes them when API acceptance ends.

The verifier closes its fixture database connection before the longer HTTP pagination checks and opens a fresh connection for cleanup, so database idle-connection limits do not interrupt pagination. Unexpected PostgreSQL connection errors stop acceptance and trigger cleanup without an unhandled process error.

The deployed staging API passed all 44 checks for the original radius options on 2026-09-13, and all 34 generated accounts were deleted. See `artifacts/acceptance/step-06-staging-20260913.log`; the expanded radius options and explicit numeric pace ranges require a new deployment and acceptance run. Actual API interaction on iPhone is tracked separately in `artifacts/acceptance/step-06.md`.
