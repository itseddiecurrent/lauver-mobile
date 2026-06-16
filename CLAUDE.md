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

All env vars must be prefixed `EXPO_PUBLIC_` to be accessible in the Expo bundle:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

## Architecture

Expo SDK 54 / React Native 0.81.5 / React 19 app with `newArchEnabled: true`.

### Dual Auth: Firebase + Supabase

**Firebase is the auth source of truth.** `useAuth` listens to `onAuthStateChanged` and, on every Firebase user change, calls `syncFirebaseToSupabase(firebaseUser)` in `src/lib/supabase.js`. That function exchanges the Firebase ID token for a Supabase session via `supabase.auth.signInWithIdToken({ provider: 'firebase', token })`, so both systems share the same UID and Supabase RLS policies (`auth.uid() = user_id`) work correctly.

**Critical:** The user object from `useAuth()` is a Firebase `User`, not a Supabase user. Always use `user.uid` (not `user.id`) when passing a user ID to any lib function or Supabase query.

```
useAuth() → { user: FirebaseUser, loading }
user.uid  ← correct
user.id   ← undefined, causes silent Supabase query failures
```

### Navigation (`src/navigation/index.js`)

```
RootNavigator (Stack)
├── Login (unauthenticated)
└── Main → MainTabs (BottomTab)
           ├── Dashboard        headerShown: false (custom header in-screen)
           ├── Activities       headerShown: false → ActivitiesStack (nested Stack)
           │                    ├── ActivitiesList
           │                    └── ActivityDetail
           ├── Community
           ├── Match
           └── Profile
```

`NavigationContainer` receives a theme derived from `useTheme()` so nav chrome matches the app palette.

### Theme (`src/context/ThemeContext.js`)

`ThemeProvider` wraps the app. `useTheme()` returns `{ colors, isDark, toggleTheme }`. Theme is persisted to `AsyncStorage` under `@lauver_theme`.

Every screen calls `makeStyles(colors)` with the current palette, e.g.:
```js
const { colors: c } = useTheme();
const s = useMemo(() => makeStyles(c), [c]);
```

Palette tokens (both LIGHT and DARK export the same keys):
- `c.BG` — screen background
- `c.CARD_BG` — card/surface
- `c.ELEVATED` — modal/popover surface
- `c.TEXT`, `c.TEXT_SUB`, `c.TEXT_MUTED`, `c.TEXT_FAINT`
- `c.ORANGE` / `c.DARK_ORANGE` — primary accent
- `c.DIVIDER`, `c.INPUT_BG`, `c.BAR_ACTIVE`, `c.BAR_EMPTY`, `c.ICON_BG`

### Lib / Hooks pattern

`src/lib/` — pure async functions that talk to Supabase (no React). Each file has the required SQL DDL in a top-of-file comment block.

`src/hooks/` — React hooks that hold state, call lib functions, and implement optimistic updates. All hooks call `useAuth()` internally; screens never deal with `user.uid` directly.

Key hooks and what they own:
| Hook | State |
|---|---|
| `useAuth` | Firebase session, Supabase sync |
| `useDashboard` | week stats, chart, recent activities |
| `useActivities` | all-time stats, distance chart, activity list with filters |
| `useCommunity` | posts (+ Realtime subscription), groups, events, comments |
| `useMatch` | readiness checks, candidates, mutual matches, swipe actions |
| `useStravaConnect` | Strava OAuth2 PKCE flow via `expo-auth-session` |
| `useAppleHealthConnect` | Apple Health via `react-native-health` (needs dev build) |

### Activity deduplication (`src/lib/sync/importActivity.js`)

Two-layer dedup when importing from external platforms:
1. **Exact match** — `activity_sources` table lookup by `(platform, external_id)`
2. **Temporal fingerprint** — same sport within ±5 min start time and ±10% duration → linked as alternate source

Source priority for `canonical_source`: `garmin > apple > strava > manual`. Higher-priority sources upgrade the canonical fields (distance, heart rate, elevation) on the existing activity row.

### Community Realtime

`useCommunity` subscribes to `postgres_changes` on the `posts` table (INSERT events) via a Supabase channel. On any new INSERT the feed is re-fetched. The channel is torn down on unmount.

Comments are managed by `CommentsModal` in `CommunityScreen.js` with self-contained state; the hook only tracks `commentCount` in the posts list for optimistic counter updates.

### Brand tokens

- `ORANGE = '#E8602C'` — primary accent
- Logo: `assets/lauver-logo.png` — transparent padding around content, use `resizeMode="contain"` with a fixed 3:1 bounding box. Dashboard header uses `marginLeft: -60` to compensate for this padding.

### Screens status

- **LandingScreen** — complete
- **DashboardScreen** — complete (custom header, stat grid, weekly chart)
- **ActivitiesScreen** — complete (stat cards, distance chart, filter chips, activity list)
- **CommunityScreen** — complete (feed + realtime, reactions, comments modal, groups, events, activity/photo attach)
- **LoginScreen / SignupScreen** — complete
- **MatchScreen** — stub; lib and hook are complete
- **ProfileScreen** — stub
- **ActivityDetailScreen** — stub

### Pending DB setup (Supabase SQL Editor)

Each lib file's top comment has the exact DDL. Summary:
- `activities` table + RLS — `src/lib/activities.js`
- `activity_sources` table — `src/lib/sync/importActivity.js`
- `posts`, `post_reactions`, `post_comments`, `groups`, `group_members`, `events`, `event_rsvps`, `communities` — `src/lib/community.js`
- `swipes` table + RLS — `src/lib/match.js`
- `profiles` columns: `skill_level text`, `availability text[]`, `location_name text` — `src/lib/match.js`
- `alter table posts add column if not exists photo_url text`
- `increment_group_member_count` Postgres RPC function
- `post-media` Storage bucket (public read) for photo attachments
