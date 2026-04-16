# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start Expo dev server (opens QR code for Expo Go)
npm start

# Run on specific platform
npm run ios
npm run android
npm run web
```

No test runner or linter is configured yet.

## Environment Variables

Supabase credentials must be set as Expo public env vars (prefix `EXPO_PUBLIC_`):

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Architecture

This is an **Expo (React Native) app** using the new architecture (`newArchEnabled: true`).

### Navigation (`src/navigation/index.js`)

The root `Stack.Navigator` gates on auth state via `useAuth`:
- Authenticated → `Main` (BottomTabNavigator)
- Unauthenticated → `Login`

Tab screens and their header config:
- `Dashboard` — `headerShown: false` (custom header in-screen)
- `Activities` — `headerShown: false` (nested stack handles its own headers)
- `Community`, `Match`, `Profile` — default tab header shown

The `ActivitiesStack` is a nested `Stack.Navigator` inside the Activities tab with two screens: `ActivitiesList` and `ActivityDetail`.

When adding a new tab screen that manages its own header (logo, custom buttons), set `headerShown: false` on the Tab.Screen and build the header inside a `SafeAreaView`.

### Auth (`src/hooks/useAuth.js`, `src/lib/supabase.js`)

`useAuth` wraps `supabase.auth.onAuthStateChange` and exposes `{ session, user, loading }`. The navigator reads this to decide which stack to render. `expo-secure-store` is used as the Supabase auth storage adapter; `detectSessionInUrl: false` since there are no deep-link OAuth flows.

### Brand tokens

Defined inline per-screen (no shared theme file yet):
- `ORANGE = '#E8602C'` — primary accent, buttons, highlights
- `DARK = '#1C1A18'` — headings, dark surfaces
- `BG = '#F0EDE8'` — screen background (warm off-white)
- `CARD_BG = '#EAE6DF'` — card/surface background

Logo: `assets/lauver-logo.png`. Base display size is `120×40` (as used in LandingScreen). The PNG has transparent padding around the visible content — use `resizeMode="contain"` only with a bounding box that matches the logo's natural 3:1 ratio, otherwise the content will appear centered. The Dashboard header uses `marginLeft: -60` to compensate for this padding offset.

### Screens status

- **LandingScreen** — complete. Dark hero + light bottom sheet, sport pills, CTAs to Login or straight to Main.
- **DashboardScreen** — complete. Custom header (logo left, "+ Log Activity" right), 2×2 stat grid, weekly bar chart, recent activities empty state, quick stats cards.
- **ActivitiesScreen** — complete. Stat cards (horizontal scroll), distance chart with period toggle, sport filter chips, activity list — all showing empty states.
- **CommunityScreen** — complete. Compose box, empty feed state, suggested groups empty state, nearby athletes (location prompt), upcoming events empty state.
- **MatchScreen, ProfileScreen, ActivityDetailScreen** — stubs.
