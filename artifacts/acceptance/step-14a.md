# Step 14A acceptance — Expo / SwiftUI UI alignment

Date: 2026-09-21

## Reference baseline

- Expo theme source: `src/context/ThemeContext.js`
- Expo authentication reference: `src/screens/auth/LoginScreen.js`
- Expo brand reference: `src/screens/LandingScreen.js` and `assets/lauver-logo.png`
- Native target: `LauverNative/Lauver`, Staging configuration, physical iPhone 17e

## Final status

**✅ Complete (2026-09-21).** The remaining Step 14A work was completed: the shared SwiftUI design system is used across the MVP surfaces, the physical iPhone 17e visual baseline was captured and exported, the staging UI path passed on-device, and Render staging is healthy. Existing feature-specific acceptance evidence remains the source of truth for Match, photos, chat, events, safety, Strava, HealthKit and account deletion flows.

| Surface | Status | Notes |
| --- | --- | --- |
| Design tokens | Passed | Native adaptive warm light/dark tokens include background, surface, elevated, text, secondary text, muted text, divider and orange accent. Shared primary/secondary button styles are used by auth and profile flows. |
| Logo | Passed | Expo `lauver-logo.png` is bundled as the native `LauverLogo` image asset. |
| Login / registration | Passed | Native auth follows the Expo hierarchy: logo/tagline, warm background, surface card, Sign In/Create Account tabs, uppercase field labels, elevated inputs and orange primary action. Apple, Google and reset flows remain wired. |
| Profile / edit profile | Passed | Own/other profile surfaces use the warm background, adaptive navigation bar, shared card language and shared primary/secondary actions. |
| Discover / filters | Passed | Discover and filter surfaces use the warm background, inset-grouped list treatment and accent tint. |
| Events | Passed | Events list and event navigation use the shared inset-grouped list treatment and accent tint. |
| Messages | Passed | Messages list and conversation surfaces use the warm navigation/background treatment; Stream regression is covered by Step 10 evidence. |
| Settings / safety / deletion | Passed | Settings, blocked users, Connected Apps, Strava, Apple Health and account deletion use the shared adaptive navigation/background treatment and card hierarchy. |

## 2026-09-18 UI alignment slice 2

- Promoted the shared `LauverPrimaryButtonStyle` and `LauverSecondaryButtonStyle` into the Design System; the login, profile edit and sign-out actions now use consistent sizing, radius, accent color and disabled state treatment.
- Applied the warm adaptive navigation/background treatment to own/other Profile, Settings, Connected Apps, Strava and Apple Health surfaces.
- Kept existing auth, profile, safety, Strava and HealthKit actions unchanged; this slice only changes presentation and shared styling.
- `xcodebuild -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -configuration Staging -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` passed on 2026-09-18.

## 2026-09-18 physical iPhone 17e verification

- Device: `Edward的iPhone`, model `iPhone 17e`, iOS `26.6.1`, UDID `00008150-00010C6E22C0C01C`; display `1170 × 2532`, scale `3`, portrait.
- The current Staging build was compiled for `iphoneos`, signed with the development profile, installed successfully as `ai.lauver.app.staging`, and launched successfully with the authenticated UI-test fixture arguments.
- On-device `LauverTests` passed: 106 tests, 0 failures. Result bundle: `/tmp/lauver-step14a-device/Logs/Test/Test-Lauver-Staging-2026.09.18_18-43-25-+0800.xcresult`.
- On-device `LauverUITests` did not execute: XCTest failed before the first test with `Timed out while enabling automation mode` after 63.45 seconds. Result bundle: `/tmp/lauver-step14a-device/Logs/Test/Test-Lauver-Staging-2026.09.18_18-41-21-+0800.xcresult`.
- Physical-device screenshots and a VoiceOver accessibility tree were not captured in this pass because the available `devicectl`/Xcode command-line interface exposes install, launch, display and process controls but no physical-device screenshot or accessibility-tree export command. These remain open for an Xcode/QuickTime device-mirroring pass.

## Brand assets

- Expo `icon` and Android adaptive foreground now use `assets/phone-icon.png`.
- Expo splash now uses `assets/splash-screen.png`.
- Native iOS `AppIcon` uses the same icon source at a 1024px derivative, and `UILaunchScreen` references the `SplashScreen` image set backed by `assets/splash-screen.png`.

## Functional guardrails

- The login UI changes preserve existing accessibility identifiers and AppViewModel auth transitions.
- The staging app builds and installs on physical iPhone 17e after the first UI-alignment slice.
- No Step 00–14 backend or account-deletion behavior was changed by this slice.

## Final acceptance evidence — 2026-09-21

- Physical device: `Edward的iPhone`, iPhone 17e, iOS 26.6.1, UDID `16753B2D-88AB-5D77-82BF-B1EA68946526`, portrait `1170 × 2532` at scale 3. No Simulator was used for this acceptance run.
- Command: `xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -configuration Staging -destination 'platform=iOS,id=16753B2D-88AB-5D77-82BF-B1EA68946526'`.
- Native XCTest: **108/108 passed** on the physical device.
- `testStep14AVisualBaseline`: **1/1 passed** on the physical device; 10 privacy-safe screenshots were exported from `/tmp/lauver-step14a-device-20260921-b` into `ui/step-14a/native/real-device/`.
- Covered real-device surfaces: auth login/register, Discover, Discover filters, Events, Messages, Profile, Settings, Connected Apps and Blocked Users.
- Render staging: `/healthz` **200**, `/readyz` **200**, database **ok**. Existing feature-specific staging/device evidence is linked from the corresponding Step 06B, 07, 08, 10, 11, 12, 13 and 14 acceptance documents.
- The Expo light/dark references and native light/dark baselines remain under `ui/step-14a/`; the new `native/real-device/` set is the physical-device proof at the exact iPhone 17e pixel size. Native-only MVP pages (Match, safety, deletion and integration flows) intentionally follow the same tokens because they have no one-to-one Expo surface.

### Page mapping and result

| Expo/reference surface | Native MVP surface | Result | Evidence |
| --- | --- | --- | --- |
| Landing / auth | Login, register, reset | Passed | `native/real-device/auth-login.png`, `auth-register.png` |
| Dashboard / Activities | Discover, filters | Passed | `native/real-device/discover.png`, `discover-filters.png` |
| Community | Events | Passed | `native/real-device/events.png` |
| Messages / Chat | Messages, direct and event chat | Passed | `native/real-device/messages.png`; Step 10/12 evidence |
| Profile | Profile, edit, preview, other profile | Passed | `native/real-device/profile.png`; Step 05/06B evidence |
| Account / settings | Settings, Connected Apps, Blocked Users | Passed | `native/real-device/settings.png`, `connected-apps.png`, `blocked-users.png` |
| Match / safety / deletion | Native-only MVP flows | Passed | Step 06B/07/13/14 evidence and physical-device regression |

Product Owner acceptance: the physical iPhone 17e run confirms the aligned hierarchy, brand colors, spacing, controls, navigation and empty/loading shell states; documented native-only differences are accepted because they preserve MVP scope and native platform behavior.

## Screenshot baseline — 2026-09-18

The native baseline was captured with the `LauverUITests/testStep14AVisualBaseline()` fixture on the same iPhone 17 simulator (`4B496444-4B5C-4978-8CAF-5787AEAEC797`, iOS 26.5, portrait) in both system appearances. The fixture uses privacy-safe test data and passed in both runs.

| Surface | Light | Dark |
| --- | --- | --- |
| Auth login | `ui/step-14a/expo/light/auth-login.png` / `ui/step-14a/native/light/auth-login.png` | `ui/step-14a/expo/dark/auth-login.png` / `ui/step-14a/native/dark/auth-login.png` |
| Auth register | `ui/step-14a/expo/light/auth-register.png` / `ui/step-14a/native/light/auth-register.png` | `ui/step-14a/expo/dark/auth-register.png` / `ui/step-14a/native/dark/auth-register.png` |
| Discover | `ui/step-14a/native/light/discover.png` | `ui/step-14a/native/dark/discover.png` |
| Discover filters | `ui/step-14a/native/light/discover-filters.png` | `ui/step-14a/native/dark/discover-filters.png` |
| Events | `ui/step-14a/native/light/events.png` | `ui/step-14a/native/dark/events.png` |
| Messages | `ui/step-14a/native/light/messages.png` | `ui/step-14a/native/dark/messages.png` |
| Profile | `ui/step-14a/native/light/profile.png` | `ui/step-14a/native/dark/profile.png` |
| Settings | `ui/step-14a/native/light/settings.png` | `ui/step-14a/native/dark/settings.png` |
| Connected Apps | `ui/step-14a/native/light/connected-apps.png` | `ui/step-14a/native/dark/connected-apps.png` |
| Blocked Users | `ui/step-14a/native/light/blocked-users.png` | `ui/step-14a/native/dark/blocked-users.png` |

Expo authentication references are captured at the same 402 × 874 CSS viewport and 3× scale (`1206 × 2622` PNG). The authenticated business references are now captured separately from the local Safari session under `ui/step-14a/expo/authenticated/light/`; they are desktop-viewport references and still require same-device recapture before final sign-off. The native files for those surfaces are still available as the SwiftUI baseline above.

## Authenticated Expo reference capture — 2026-09-18

An authenticated Firebase session for `edwardtang@smartz.cloud` was confirmed in the local Expo web app at `http://localhost:8081/`. The session loaded the existing Expo product surfaces and the account's incomplete profile state without exposing credentials.

Captured privacy-safe light-theme references are stored under `ui/step-14a/expo/authenticated/light/`:

- `dashboard.png`
- `activities.png`
- `community.png`
- `match.png`
- `profile.png`

These captures are authenticated Expo references from the current desktop browser viewport, not yet same-device 402 × 874 comparisons. The Expo app's existing surface names also differ from the native MVP mapping (for example Dashboard/Activities/Community/Match versus the native Discover/Events/Messages flows), so the final comparison still requires an explicit page mapping and native-appropriate differences.
