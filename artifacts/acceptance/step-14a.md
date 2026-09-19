# Step 14A acceptance — Expo / SwiftUI UI alignment

Date: 2026-09-18

## Reference baseline

- Expo theme source: `src/context/ThemeContext.js`
- Expo authentication reference: `src/screens/auth/LoginScreen.js`
- Expo brand reference: `src/screens/LandingScreen.js` and `assets/lauver-logo.png`
- Native target: `LauverNative/Lauver`, Staging configuration, physical iPhone 17e

## Current progress

| Surface | Status | Notes |
| --- | --- | --- |
| Design tokens | In progress | Native adaptive warm light/dark tokens now include background, surface, elevated, text, secondary text, muted text, divider and orange accent. Shared primary/secondary button styles are now used by auth and profile flows. |
| Logo | Passed | Expo `lauver-logo.png` is bundled as the native `LauverLogo` image asset. |
| Login / registration | In progress | Native auth now follows the Expo hierarchy: logo/tagline, warm background, surface card, Sign In/Create Account tabs, uppercase field labels, elevated inputs and orange primary action. Native Apple/authentication and reset flows remain wired. |
| Profile / edit profile | In progress | Own/other profile surfaces now use the warm background, adaptive navigation bar, shared card language and shared primary/secondary actions; screenshot comparison and Dynamic Type review remain. |
| Discover / filters | In progress | Discover and filter surfaces now use the warm background, inset-grouped list treatment and accent tint; screenshot comparison remains. |
| Events | In progress | Events list now uses the shared inset-grouped list treatment and accent tint; event detail/create/edit comparison remains. |
| Messages | In progress | Messages list and conversation surfaces now use the warm navigation/background treatment; chat regression and screenshot comparison remain. |
| Settings / safety / deletion | In progress | Settings, blocked users, Connected Apps, Strava and Apple Health now share adaptive navigation/background treatment and card hierarchy; Step 14 deletion flow still requires full regression. |

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

## Remaining sign-off

- Capture privacy-safe Expo and native screenshots at matching device sizes and light/dark modes.
- Align the remaining user-facing screens and record intentional native differences.
- Run full functional regression for auth, profile save/location, Discover, chat, events, safety and account deletion on staging.
- Complete small/large iPhone, Dynamic Type, VoiceOver and real-device checks before marking Step 14A complete.

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
