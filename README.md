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
