# Step 00 Acceptance Record

> Status: complete
>
> Last updated: 2026-09-19 (Asia/Shanghai)

## Scope

Step 00 establishes the native SwiftUI project, the TypeScript Express service, staging and production configuration boundaries, CI, scope and secret guardrails, and the initial OpenAPI contract.

## Verification environment

- Repository: `lauver-mobile`
- Branch: `main`
- macOS: `26.4.1` (`25E253`)
- Xcode: `26.6` (`17F113`)
- iOS Simulator: `iPhone 17 Pro - Lauver`, iOS `26.5`, UDID `C8000809-C352-4408-AC67-DCBAF53C415B`
- Node.js: `v26.7.0` (allowed by `>=24 <27`)
- npm: `11.19.0`
- Third-party credentials: none used or required

## Automated results

Run from the repository root:

```bash
./scripts/test-step-00.sh
```

| Check | Result | Evidence |
|---|---|---|
| MVP scope checker regression tests | Pass | Clean fixture accepted; StoreKit, Garmin SDK, AI SDK, AI matching copy and Tinder brand fixtures rejected; approved Swipe/Like/Pass/Match fixture accepted |
| Secret checker regression tests | Pass | Populated fake secret and private-key fixtures independently rejected; clean fixture accepted before and after both cases |
| iOS Simulator selector regression tests | Pass | Booted iPhone preferred; unavailable devices ignored; missing iPhone rejected |
| Repository structure tests | Pass | Required project/config/contract files, executable scripts, ignored local config, trackable Xcode project/schemes, CI iOS/backend commands, and error contract checked |
| Backend lint | Pass | `npm run lint` |
| Backend typecheck | Pass | `npm run typecheck` |
| Backend unit tests | Pass | 11/11 tests passed with `npm test`, including malformed JSON error-contract coverage |
| Backend integration tests | Pass | `npm run test:integration` |
| Backend production build | Pass | `npm run build` |
| Native iOS XCTest/XCUITest | Pass | 106 XCTest and 1 XCUITest passed with `Lauver-Staging`; UI test launched the app and verified the shell labels and auth entry |
| Native iOS built configuration | Pass | Staging and production `.app` products contain the expected environment, HTTPS API URL, and bundle identifier |
| GitHub Actions workflow definition | Pass | `ios` job now runs `test-ios-config.sh` and the native `xcodebuild test` wrapper with staging-dependent tests explicitly isolated; workflow structure test checks these commands |

## Manual health check

Passed again on 2026-08-31 using port `3100`:

```bash
cd backend
PORT=3100 npm start
curl -i http://localhost:3100/healthz
```

Expected body:

```json
{"status":"ok","service":"lauver-api"}
```

Observed HTTP status: `200 OK`. The response also included a UUID `x-request-id` header.

## iOS acceptance

Executed on 2026-08-31:

```bash
SIMULATOR_UDID=C8000809-C352-4408-AC67-DCBAF53C415B \
IOS_TEST_TIMEOUT_SECONDS=600 \
./scripts/test-ios.sh
```

Result: `TEST SUCCEEDED`. The `Lauver-Staging` app launched in the Simulator and displayed `Lauver` and `Native iOS MVP`. Visual evidence: [step-00-simulator.png](step-00-simulator.png).

## Current local re-verification

Executed on 2026-09-19 after the Match scope update:

```bash
./scripts/tests/check-mvp-scope.test.sh
./scripts/tests/check-step-00-structure.test.sh
./scripts/check-mvp-scope.sh
./scripts/check-secrets.sh
cd backend && npm run lint && npm run typecheck && npm test \
  && npm run test:step-00-integration && npm run build
cd .. && ./scripts/test-ios-config.sh
IOS_SKIP_EXTERNAL_UI=true IOS_TEST_TIMEOUT_SECONDS=720 ./scripts/test-ios.sh
```

The backend checks, iOS configuration checks, native XCTest and non-staging XCUITest suite passed locally. The external Stream/Strava UI checks remain intentionally excluded from this local Step 00 run; they belong to their respective later acceptance steps.

## Completion

Step 00 is complete. The native app shell, backend service, configuration boundaries, automated tests, scope and secret guardrails, OpenAPI contract, local acceptance, and CI workflow coverage all pass. The native login entry also exposes stable environment and app accessibility identifiers for the shell smoke test without adding prohibited product behavior or AI copy.
