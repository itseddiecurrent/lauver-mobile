// src/lib/sync/stravaSync.js
//
// Shared Strava sport map and activity mapper — used by:
//   - supabase/functions/strava-sync/index.ts  (inline copy — Edge Fn can't import from src/)
//   - __tests__/hooks/stravaSync.test.js
//
// Keep in sync with the Edge Function's SPORT_MAP manually.

export const STRAVA_SPORT_MAP = {
  Run:              'running',
  VirtualRun:       'running',
  TrailRun:         'running',
  Ride:             'cycling',
  VirtualRide:      'cycling',
  EBikeRide:        'cycling',
  MountainBikeRide: 'cycling',
  GravelRide:       'cycling',
  Swim:             'swimming',
  Hike:             'hiking',
  Walk:             'hiking',
  RockClimbing:     'climbing',
  AlpineSki:        'skiing',
  BackcountrySki:   'skiing',
  NordicSki:        'skiing',
  Snowboard:        'skiing',
  WeightTraining:   'gym',
  Crossfit:         'gym',
  Workout:          'gym',
  Yoga:             'yoga',
  Pilates:          'yoga',
  Rowing:           'swimming',
  Kayaking:         'other',
  Surfing:          'other',
};

export function mapStravaActivity(a) {
  return {
    sport:            STRAVA_SPORT_MAP[a.sport_type] ?? STRAVA_SPORT_MAP[a.type] ?? 'other',
    title:            a.name || 'Strava activity',
    started_at:       a.start_date,
    duration_seconds: a.moving_time ?? a.elapsed_time ?? 0,
    distance_km:      a.distance != null ? +((a.distance / 1000).toFixed(2)) : null,
    avg_heart_rate:   a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    calories:         a.calories ?? null,
    elevation_gain_m: a.total_elevation_gain ?? null,
  };
}
