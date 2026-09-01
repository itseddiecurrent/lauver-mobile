# Lauver Native iOS MVP

This repository contains the legacy React Native prototype plus the new native iOS MVP and its Node.js backend. The marketing website at [lauver.ai](https://lauver.ai/) is maintained separately and is not rebuilt here.

The authoritative MVP scope is in [`mvp.md`](mvp.md). The native implementation must not include AI features, Garmin sync, paid subscriptions, in-app purchases, or Tinder-style swipe/match behavior.

## Repository layout

```text
LauverNative/          Native SwiftUI Xcode project
backend/               TypeScript Express API
openapi/mvp.yaml       REST contract
scripts/               Scope, secret, iOS, and Step 00 test scripts
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

An Apple Developer Team ID is not needed for unsigned Simulator tests. Copy `LauverNative/Config/Local.xcconfig.example` to an ignored local config only when device signing is introduced.

## Backend setup

```bash
cd backend
cp .env.example .env
npm ci
npm run dev
```

Verify the service:

```bash
curl http://localhost:3000/healthz
```

Expected response:

```json
{"status":"ok","service":"lauver-api"}
```

## Tests

Run all Step 00 checks:

```bash
./scripts/test-step-00.sh
```

Run checks separately:

```bash
./scripts/tests/check-mvp-scope.test.sh
./scripts/tests/check-secrets.test.sh
./scripts/tests/select-ios-simulator.test.sh
./scripts/tests/check-step-00-structure.test.sh
./scripts/check-mvp-scope.sh
./scripts/check-secrets.sh

cd backend
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build

cd ..
./scripts/test-ios.sh
./scripts/test-ios-config.sh
```

The iOS script prefers an already booted iPhone Simulator, then falls back to the first available iPhone. Set `SIMULATOR_UDID` to choose a specific device or `IOS_TEST_TIMEOUT_SECONDS` to override the 15-minute safety timeout.

## Configuration boundaries

- Public iOS configuration lives in `.xcconfig` files.
- Backend configuration is documented in `backend/.env.example`.
- Real `.env` files, private keys, OAuth secrets, tokens, and signing files must never be committed.
- Staging and production use separate API base URLs and, in later steps, separate third-party applications.

## Current external setup still needed

Step 00 can be completed without third-party accounts. Before later steps, the project owner will need to provide or create:

- Apple Developer Program access and the `ai.lauver.app` App ID;
- Render staging and production projects;
- PostgreSQL instances on Render;
- Strava staging/production applications;
- Stream Chat staging/production applications;
- an S3-compatible object-storage bucket;
- an email delivery provider and verified sender domain;
- accessible Privacy Policy and Terms URLs.

Never send secrets in chat or commit them to this repository. Add them directly to the appropriate provider dashboard or local ignored environment file.
