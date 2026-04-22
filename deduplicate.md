# Activity Deduplication — Implementation Guide

## Problem

When a user connects multiple fitness platforms (Garmin, Strava, Apple Health), the same
activity can arrive via multiple channels. The most common chain:

```
Garmin records activity
  → Garmin auto-syncs to Strava
  → Lauver webhook pulls from Garmin  → activity #1
  → Lauver webhook pulls from Strava  → activity #2  ← duplicate
```

The solution is a two-layer deduplication check on every import. Layer 1 catches exact
re-imports from the same platform. Layer 2 catches the cross-platform duplicate case.

---

## Database Changes

### 1. Create `activity_sources` table

Run once in Supabase SQL editor:

```sql
create table activity_sources (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  platform    text not null,   -- 'garmin' | 'strava' | 'apple'
  external_id text not null,   -- the activity ID on that platform
  raw_data    jsonb,           -- optional: store the raw payload for debugging
  synced_at   timestamptz not null default now(),

  unique (platform, external_id)  -- hard constraint: one row per platform activity
);

-- Index for the temporal fingerprint query
create index activity_sources_activity_id_idx on activity_sources(activity_id);

-- RLS
alter table activity_sources enable row level security;

create policy "Users can read their own sources"
  on activity_sources for select
  using (
    activity_id in (
      select id from activities where user_id = auth.uid()::text
    )
  );

create policy "Service role can insert"
  on activity_sources for insert
  with check (true);  -- restrict to service role key in production
```

### 2. Add `canonical_source` to `activities` (optional but recommended)

```sql
alter table activities
  add column if not exists canonical_source text;  -- 'garmin' | 'strava' | 'apple' | 'manual'
```

This records which platform's data is considered authoritative (for splits, HR, pace).
Priority order: `garmin > apple > strava > manual`

---

## File Structure

Create the following files:

```
src/
  lib/
    sync/
      importActivity.js     ← core dedup logic (implement this first)
      garminSync.js         ← Garmin-specific fetch + transform
      stravaSync.js         ← Strava-specific fetch + transform
      appleSync.js          ← Apple Health fetch + transform
      syncManager.js        ← orchestrates all platforms for a user
```

---

## Core Implementation: `src/lib/sync/importActivity.js`

This is the single entry point for ALL activity imports regardless of platform.
Every sync adapter must call this function — never insert into `activities` directly.

```js
import { supabase } from '../supabase';

// How close two activities' start times can be and still be considered the same.
const TEMPORAL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// How similar durations must be (as a ratio) to be considered the same activity.
const DURATION_TOLERANCE = 0.10; // 10%

// Source priority for canonical_source — lower index = higher priority.
const SOURCE_PRIORITY = ['garmin', 'apple', 'strava', 'manual'];

/**
 * Import a single activity from an external platform, deduplicating automatically.
 *
 * @param {string} userId       - The Lauver user ID (Firebase UID string)
 * @param {string} platform     - 'garmin' | 'strava' | 'apple'
 * @param {string} externalId   - The activity's ID on the external platform
 * @param {object} data         - Normalized activity fields (see shape below)
 * @param {object} [rawData]    - Optional raw API payload for debugging
 *
 * data shape:
 * {
 *   sport:            string,   // 'running' | 'cycling' | 'swimming' | etc.
 *   title:            string,
 *   started_at:       string,   // ISO 8601
 *   duration_seconds: number,
 *   distance_km:      number | null,
 *   avg_heart_rate:   number | null,
 *   calories:         number | null,
 *   elevation_gain_m: number | null,
 * }
 *
 * @returns {{ status: 'created' | 'linked' | 'skipped', activityId: string }}
 */
export async function importActivity(userId, platform, externalId, data, rawData = null) {

  // ── Layer 1: Exact match ──────────────────────────────────────────────────
  // Has this exact (platform, externalId) pair already been imported?

  const { data: existingSource } = await supabase
    .from('activity_sources')
    .select('activity_id')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existingSource) {
    return { status: 'skipped', activityId: existingSource.activity_id };
  }

  // ── Layer 2: Temporal fingerprint ─────────────────────────────────────────
  // Does an activity already exist from a different platform that is almost
  // certainly the same workout? Match on: user + sport + start time ± 5 min.

  const startedAt   = new Date(data.started_at).getTime();
  const windowStart = new Date(startedAt - TEMPORAL_WINDOW_MS).toISOString();
  const windowEnd   = new Date(startedAt + TEMPORAL_WINDOW_MS).toISOString();

  const { data: temporalMatch } = await supabase
    .from('activities')
    .select('id, duration_seconds, canonical_source')
    .eq('user_id', userId)
    .eq('sport', data.sport)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .maybeSingle();

  if (temporalMatch) {
    // Secondary check: duration must also be within tolerance.
    // Avoids false positives for back-to-back activities of the same sport.
    const durationRatio = data.duration_seconds / (temporalMatch.duration_seconds || 1);
    const durationMatch = durationRatio >= (1 - DURATION_TOLERANCE) &&
                          durationRatio <= (1 + DURATION_TOLERANCE);

    if (durationMatch) {
      // This is a cross-platform duplicate. Link the new source ID to the
      // existing activity — do not create a new activity row.
      await supabase.from('activity_sources').insert({
        activity_id: temporalMatch.id,
        platform,
        external_id: externalId,
        raw_data:    rawData,
      });

      // Upgrade canonical_source if this platform has higher priority.
      await maybeUpgradeCanonicalSource(temporalMatch.id, temporalMatch.canonical_source, platform, data);

      return { status: 'linked', activityId: temporalMatch.id };
    }
  }

  // ── No duplicate found — create new activity ──────────────────────────────

  const { data: newActivity, error } = await supabase
    .from('activities')
    .insert({
      user_id:          userId,
      sport:            data.sport,
      title:            data.title,
      started_at:       data.started_at,
      duration_seconds: data.duration_seconds,
      distance_km:      data.distance_km      ?? null,
      avg_heart_rate:   data.avg_heart_rate   ?? null,
      calories:         data.calories         ?? null,
      elevation_gain_m: data.elevation_gain_m ?? null,
      canonical_source: platform,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert activity: ${error.message}`);

  await supabase.from('activity_sources').insert({
    activity_id: newActivity.id,
    platform,
    external_id: externalId,
    raw_data:    rawData,
  });

  return { status: 'created', activityId: newActivity.id };
}


/**
 * If the incoming platform has higher priority than the current canonical source,
 * update the activity row with the higher-quality data.
 * Example: Garmin arrives after Strava — overwrite pace/HR with Garmin's values.
 */
async function maybeUpgradeCanonicalSource(activityId, currentSource, incomingPlatform, data) {
  const currentPriority  = SOURCE_PRIORITY.indexOf(currentSource);
  const incomingPriority = SOURCE_PRIORITY.indexOf(incomingPlatform);

  // Lower index = higher priority
  if (incomingPriority < currentPriority || currentPriority === -1) {
    await supabase
      .from('activities')
      .update({
        canonical_source: incomingPlatform,
        avg_heart_rate:   data.avg_heart_rate   ?? undefined,
        distance_km:      data.distance_km      ?? undefined,
        elevation_gain_m: data.elevation_gain_m ?? undefined,
      })
      .eq('id', activityId);
  }
}
```

---

## Platform Adapters

Each adapter is responsible for:
1. Fetching activities from the external API
2. Normalizing fields to the common `data` shape
3. Calling `importActivity()` — never writing to the DB directly

### `src/lib/sync/garminSync.js`

```js
import { importActivity } from './importActivity';

// Maps Garmin activityType to Lauver sport strings
const GARMIN_SPORT_MAP = {
  running:          'running',
  cycling:          'cycling',
  swimming:         'swimming',
  hiking:           'hiking',
  mountainBiking:   'cycling',
  strengthTraining: 'gym',
  yoga:             'yoga',
  skiing:           'skiing',
};

/**
 * @param {string} userId
 * @param {string} accessToken   - Garmin OAuth access token stored in your DB
 * @param {Date}   since         - Only fetch activities after this date
 */
export async function syncGarmin(userId, accessToken, since) {
  // Replace with real Garmin Health API endpoint
  const response = await fetch(
    `https://apis.garmin.com/wellness-api/rest/activities?uploadStartTimeInSeconds=${Math.floor(since.getTime() / 1000)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const { activities } = await response.json();

  const results = [];
  for (const a of activities) {
    const data = {
      sport:            GARMIN_SPORT_MAP[a.activityType] ?? 'other',
      title:            a.activityName ?? `${a.activityType} activity`,
      started_at:       new Date(a.startTimeInSeconds * 1000).toISOString(),
      duration_seconds: a.durationInSeconds,
      distance_km:      a.distanceInMeters ? a.distanceInMeters / 1000 : null,
      avg_heart_rate:   a.averageHeartRateInBeatsPerMinute ?? null,
      calories:         a.activeKilocalories ?? null,
      elevation_gain_m: a.totalElevationGainInMeters ?? null,
    };

    const result = await importActivity(
      userId,
      'garmin',
      String(a.activityId),
      data,
      a  // raw payload
    );
    results.push(result);
  }

  return results;
}
```

### `src/lib/sync/stravaSync.js`

```js
import { importActivity } from './importActivity';

const STRAVA_SPORT_MAP = {
  Run:   'running',
  Ride:  'cycling',
  Swim:  'swimming',
  Hike:  'hiking',
  Walk:  'hiking',
  Ski:   'skiing',
  WeightTraining: 'gym',
  Yoga:  'yoga',
};

export async function syncStrava(userId, accessToken, since) {
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const response = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${afterEpoch}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const activities = await response.json();

  const results = [];
  for (const a of activities) {
    const data = {
      sport:            STRAVA_SPORT_MAP[a.type] ?? 'other',
      title:            a.name,
      started_at:       a.start_date,
      duration_seconds: a.moving_time,
      distance_km:      a.distance ? a.distance / 1000 : null,
      avg_heart_rate:   a.average_heartrate ?? null,
      calories:         a.calories ?? null,
      elevation_gain_m: a.total_elevation_gain ?? null,
    };

    const result = await importActivity(
      userId,
      'strava',
      String(a.id),
      data,
      a
    );
    results.push(result);
  }

  return results;
}
```

### `src/lib/sync/appleSync.js`

```js
import { importActivity } from './importActivity';

// Apple Health data arrives via HealthKit on-device, not a REST API.
// This adapter is called from native code / expo-health after reading workouts.

const APPLE_SPORT_MAP = {
  HKWorkoutActivityTypeRunning:        'running',
  HKWorkoutActivityTypeCycling:        'cycling',
  HKWorkoutActivityTypeSwimming:       'swimming',
  HKWorkoutActivityTypeHiking:         'hiking',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'gym',
  HKWorkoutActivityTypeYoga:           'yoga',
  HKWorkoutActivityTypeCrossCountrySkiing: 'skiing',
};

/**
 * @param {string} userId
 * @param {Array}  workouts  - Array of HKWorkout objects from HealthKit
 */
export async function syncAppleHealth(userId, workouts) {
  const results = [];
  for (const w of workouts) {
    const data = {
      sport:            APPLE_SPORT_MAP[w.workoutActivityType] ?? 'other',
      title:            w.metadata?.HKExternalUUID ? `${w.workoutActivityType}` : 'Workout',
      started_at:       w.startDate,
      duration_seconds: Math.round(w.duration),
      distance_km:      w.totalDistance ? w.totalDistance.quantity / 1000 : null,
      avg_heart_rate:   null,  // requires separate HKStatisticsQuery
      calories:         w.totalEnergyBurned?.quantity ?? null,
      elevation_gain_m: null,
    };

    // Use Apple's UUID as the external ID — it's stable across devices
    const externalId = w.metadata?.HKExternalUUID ?? w.uuid;

    const result = await importActivity(userId, 'apple', externalId, data, w);
    results.push(result);
  }
  return results;
}
```

---

## Sync Manager: `src/lib/sync/syncManager.js`

Orchestrates all connected platforms for a user. Call this on app foreground or
on a scheduled background fetch.

```js
import { supabase } from '../supabase';
import { syncGarmin }      from './garminSync';
import { syncStrava }      from './stravaSync';
import { syncAppleHealth } from './appleSync';

/**
 * Sync all connected platforms for a user.
 * Reads connection tokens from a `platform_connections` table (see below).
 *
 * @param {string} userId
 * @returns {object} Summary of created/linked/skipped counts per platform
 */
export async function syncAllPlatforms(userId) {
  const { data: connections } = await supabase
    .from('platform_connections')
    .select('platform, access_token, last_synced_at')
    .eq('user_id', userId);

  if (!connections?.length) return {};

  // Always sync from the last known sync point to avoid re-processing everything
  const summary = {};

  for (const conn of connections) {
    const since = conn.last_synced_at
      ? new Date(conn.last_synced_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default: last 30 days

    try {
      let results = [];
      if (conn.platform === 'garmin') results = await syncGarmin(userId, conn.access_token, since);
      if (conn.platform === 'strava') results = await syncStrava(userId, conn.access_token, since);
      // Apple Health is triggered on-device, not here

      summary[conn.platform] = {
        created: results.filter(r => r.status === 'created').length,
        linked:  results.filter(r => r.status === 'linked').length,
        skipped: results.filter(r => r.status === 'skipped').length,
      };

      // Update last sync timestamp
      await supabase
        .from('platform_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('platform', conn.platform);

    } catch (err) {
      console.error(`Sync failed for ${conn.platform}:`, err.message);
      summary[conn.platform] = { error: err.message };
    }
  }

  return summary;
}
```

### `platform_connections` table (required by syncManager)

```sql
create table platform_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  platform       text not null,       -- 'garmin' | 'strava' | 'apple'
  access_token   text,                -- encrypted in production
  refresh_token  text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at     timestamptz default now(),

  unique (user_id, platform)
);

alter table platform_connections enable row level security;

create policy "Users manage their own connections"
  on platform_connections for all
  using (user_id = auth.uid()::text);
```

---

## Edge Cases to Handle

| Scenario | Behaviour |
|---|---|
| Garmin imports first, Strava arrives later | Layer 2 links Strava source to existing activity. Garmin stays canonical. |
| Strava imports first, Garmin arrives later | Layer 2 links. `maybeUpgradeCanonicalSource` promotes Garmin as canonical and overwrites HR/distance. |
| Same activity imported twice from Garmin | Layer 1 blocks the second import immediately. |
| Back-to-back runs 3 min apart, same distance | Duration tolerance check (±10%) prevents false positive merge. |
| Activity edited on Strava after import | Not handled automatically — add a `needs_resync` flag and re-fetch on next sync if `updated_at` changed. |
| User disconnects a platform | Keep `activity_sources` rows. Activities remain; just stop syncing from that platform. |
| Token expiry | `syncManager` should catch 401 errors, mark connection as `requires_reauth`, surface to user in Settings. |

---

## Testing the Deduplication

Manual test sequence to verify correctness:

```js
// In a test script or Supabase edge function

// 1. Import from Garmin
const r1 = await importActivity('user123', 'garmin', 'garmin_001', {
  sport: 'running', title: 'Morning Run',
  started_at: '2026-04-22T07:00:00Z',
  duration_seconds: 2400, distance_km: 8.3,
});
console.log(r1.status); // → 'created'

// 2. Import the same activity from Strava (cross-platform duplicate)
const r2 = await importActivity('user123', 'strava', 'strava_999', {
  sport: 'running', title: 'Morning Run',
  started_at: '2026-04-22T07:01:00Z', // 1 min offset — within window
  duration_seconds: 2398,             // negligible difference
  distance_km: 8.3,
});
console.log(r2.status);              // → 'linked'
console.log(r2.activityId === r1.activityId); // → true

// 3. Import the Garmin activity again (exact re-import)
const r3 = await importActivity('user123', 'garmin', 'garmin_001', { /* same data */ });
console.log(r3.status); // → 'skipped'
```

Expected result: one row in `activities`, two rows in `activity_sources`.
