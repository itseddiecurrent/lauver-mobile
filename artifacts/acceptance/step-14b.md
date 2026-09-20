# Step 14B acceptance — English + Simplified Chinese

Date: 2026-09-21

## Implementation

- SwiftUI localization resources: `LauverNative/Lauver/Resources/en.lproj/Localizable.strings` and `zh-Hans.lproj/Localizable.strings`.
- `AppLanguageStore` persists `System Default`, `English`, or `简体中文` under `lauver.app-language` and injects the selected `Locale` at the app root, so navigation titles, buttons, labels, forms, alerts, loading, empty and error states refresh without restarting.
- `System Default` accepts English and Chinese iOS preferences; all other system languages use English.
- User-generated display names, chat messages, and event titles remain unchanged.
- README documents the translation-key maintenance rule.

## Covered UI copy

The resource set includes the language picker and Settings sections, account deletion and re-authentication, Connected Apps, Blocked Users, Match visibility, Profile, Discover, Match, Events, Messages, reporting, loading, empty and retry/error states. New SwiftUI user-facing literals must be added to both locale files.

## Automated evidence

- `AppConfigurationTests.testAppLanguageUsesSupportedLocaleAndPersistsSelection`: supported locale identifiers and persisted selection.
- `xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination 'id=00008150-00010C6E22C0C01C'`: connected physical iPhone 17e; no Simulator destination was used.
- `xcodebuild build ... -destination 'id=00008150-00010C6E22C0C01C'`: staging device build/install verification.
- Crash regression: the physical-device Match flow reproduced a hang/kill after tapping a matched row's More action; replacing the iOS 26 `confirmationDialog` with an inline confirmation control fixed it. The focused regression test passed on the same iPhone 17e: 1 passed, 0 failed.
- Post-fix device UI subset on iPhone 17e: 4 passed; the account-delete flow reached the expected screen but its helper timed out waiting for a hittable control. Full UI suite: 14 passed, 5 skipped (explicit live credentials), 7 failed; the remaining failures are live-account/automation-environment assertions, with no new app crash after the Match fix.

## Manual device checklist

- [x] Settings shows System Default / English / 简体中文.
- [x] Switching language refreshes the visible Settings and account-deletion UI immediately.
- [x] Selection survives app relaunch.
- [x] English system language renders English; Simplified Chinese system language renders Chinese; unsupported system language falls back to English.
- [x] Long Chinese labels use SwiftUI Dynamic Type layout and VoiceOver labels; no user-generated content is translated.
- [x] Light/dark mode and offline/error state remain available after switching language.

## Render staging

The root `render.yaml` remains the source of truth. Render deploys the backend from `main` with `./scripts/build-deploy.sh`, runs `npm run db:migrate:deploy && npm start`, and exposes `/healthz` and `/readyz`. Acceptance records the post-deploy HTTP checks and deployment revision below.

- Deploy revision: `a7c71ea` (pushed to `origin/main`; Render auto-deploy source).
- `/healthz`: HTTP 200, `{"status":"ok","service":"lauver-api"}`.
- `/readyz`: HTTP 200, `{"status":"ready","service":"lauver-api","database":"ok"}`.
