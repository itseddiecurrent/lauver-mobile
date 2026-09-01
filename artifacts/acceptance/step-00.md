# Step 00 Acceptance Record

> Status: complete
>
> Last updated: 2026-09-01 (Asia/Shanghai)

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
| MVP scope checker regression tests | Pass | Clean fixture accepted before and after isolated StoreKit, Garmin SDK, AI SDK, AI matching copy, and swipe matching rejection cases |
| Secret checker regression tests | Pass | Populated fake secret and private-key fixtures independently rejected; clean fixture accepted before and after both cases |
| iOS Simulator selector regression tests | Pass | Booted iPhone preferred; unavailable devices ignored; missing iPhone rejected |
| Repository structure tests | Pass | Required project/config/contract files, executable scripts, ignored local config, trackable Xcode project/schemes, and error contract checked |
| Backend lint | Pass | `npm run lint` |
| Backend typecheck | Pass | `npm run typecheck` |
| Backend unit tests | Pass | 11/11 tests passed with `npm test`, including malformed JSON error-contract coverage |
| Backend integration tests | Pass | `npm run test:integration` |
| Backend production build | Pass | `npm run build` |
| Native iOS XCTest/XCUITest | Pass | 7 XCTest and 1 XCUITest passed with `Lauver-Staging`; UI test launched the app and verified both labels |
| Native iOS built configuration | Pass | Staging and production `.app` products contain the expected environment, HTTPS API URL, and bundle identifier |
| GitHub Actions | Pass | [`guardrails`, `backend`, and `ios` completed successfully](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/33466934837) |

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

## Completion

Step 00 is complete. The native app shell, backend service, configuration boundaries, automated tests, scope and secret guardrails, OpenAPI contract, local acceptance, and the first full GitHub Actions run all passed.
