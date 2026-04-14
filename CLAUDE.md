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

### Navigation structure (`src/navigation/index.js`)

The root is a single `Stack.Navigator` with three top-level routes:
- `Landing` — unauthenticated entry point with CTA to either bypass auth ("Try the App") or go to Login/Signup
- `Login` / `Signup` — auth screens
- `Main` — a `BottomTabNavigator` containing: Dashboard, Activities (nested stack: list → detail), Community, Match, Profile

Auth state is managed by `src/hooks/useAuth.js`, which wraps Supabase's `onAuthStateChange`. The navigator currently does **not** gate routes based on auth state — `LandingScreen` lets users navigate directly to `Main` without authenticating.

### Supabase (`src/lib/supabase.js`)

`expo-secure-store` is used as the auth token storage adapter instead of `localStorage`. `detectSessionInUrl` is disabled (no deep-link OAuth flows yet).

### Brand tokens

The primary color palette is defined inline in screens (no shared theme file yet):
- `ORANGE = '#E8602C'` — primary accent
- `DARK = '#1C1A18'` — dark background
- Light background: `#F7F5F2`
