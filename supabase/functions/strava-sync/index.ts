// supabase/functions/strava-sync/index.ts
//
// Fetches recent Strava activities and imports them into the activities table.
// Uses two-layer dedup (importActivity) to avoid double-counting cross-platform.
//
// POST /functions/v1/strava-sync
// Body: { userId: string, since?: string }   // since = ISO date string, defaults to 30 days ago
// Returns: { imported, linked, skipped, errors }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRAVA_API = 'https://www.strava.com/api/v3';
const TEMPORAL_WINDOW_MS = 5 * 60 * 1000;
const DURATION_TOLERANCE = 0.10;
const SOURCE_PRIORITY    = ['garmin', 'coros', 'apple', 'strava', 'manual'];

// ─── Strava → Lauver sport map ────────────────────────────────────────────────

const SPORT_MAP: Record<string, string> = {
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

function mapStravaActivity(a: Record<string, unknown>) {
  return {
    sport:            SPORT_MAP[a.sport_type as string] ?? SPORT_MAP[a.type as string] ?? 'other',
    title:            (a.name as string) || 'Strava activity',
    started_at:       a.start_date as string,
    duration_seconds: (a.moving_time as number) ?? (a.elapsed_time as number) ?? 0,
    distance_km:      a.distance ? +((a.distance as number) / 1000).toFixed(2) : null,
    avg_heart_rate:   a.average_heartrate != null ? Math.round(a.average_heartrate as number) : null,
    calories:         (a.calories as number | null) ?? null,
    elevation_gain_m: (a.total_elevation_gain as number | null) ?? null,
  };
}

// ─── importActivity (inline — Edge Functions can't import from src/lib) ───────

async function importActivity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  platform: string,
  externalId: string,
  data: ReturnType<typeof mapStravaActivity>,
) {
  // Layer 1: exact match
  const { data: existing } = await supabase
    .from('activity_sources')
    .select('activity_id')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existing) return 'skipped';

  // Layer 2: temporal fingerprint
  const startedAt   = new Date(data.started_at).getTime();
  const windowStart = new Date(startedAt - TEMPORAL_WINDOW_MS).toISOString();
  const windowEnd   = new Date(startedAt + TEMPORAL_WINDOW_MS).toISOString();

  const { data: match } = await supabase
    .from('activities')
    .select('id, duration_seconds, canonical_source')
    .eq('user_id', userId)
    .eq('sport', data.sport)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .maybeSingle();

  if (match && data.duration_seconds) {
    const ratio = data.duration_seconds / (match.duration_seconds || 1);
    if (ratio >= 1 - DURATION_TOLERANCE && ratio <= 1 + DURATION_TOLERANCE) {
      await supabase.from('activity_sources').insert({
        activity_id: match.id, platform, external_id: externalId,
      });
      // Upgrade canonical source if higher priority
      const currPri = SOURCE_PRIORITY.indexOf(match.canonical_source as string);
      const inPri   = SOURCE_PRIORITY.indexOf(platform);
      if (inPri < currPri || currPri === -1) {
        await supabase.from('activities').update({
          canonical_source: platform,
          ...(data.avg_heart_rate   != null && { avg_heart_rate:   data.avg_heart_rate }),
          ...(data.distance_km      != null && { distance_km:      data.distance_km }),
          ...(data.elevation_gain_m != null && { elevation_gain_m: data.elevation_gain_m }),
        }).eq('id', match.id);
      }
      return 'linked';
    }
  }

  // New activity
  const { data: newAct, error } = await supabase
    .from('activities')
    .insert({ user_id: userId, canonical_source: platform, ...data })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  await supabase.from('activity_sources').insert({
    activity_id: newAct.id, platform, external_id: externalId,
  });
  return 'created';
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  const { userId, since } = await req.json();
  if (!userId) return json({ error: 'Missing userId' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Ensure token is fresh ─────────────────────────────────────────────────
  const refreshRes = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/strava-refresh`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body:    JSON.stringify({ userId }),
    },
  );
  if (!refreshRes.ok) {
    const err = await refreshRes.json();
    return json({ error: err.error ?? 'Token refresh failed' }, 401);
  }

  // ── Fetch access token ───────────────────────────────────────────────────
  const { data: conn, error: connErr } = await supabase
    .from('platform_connections')
    .select('access_token, last_sync_at')
    .eq('user_id', userId)
    .eq('platform', 'strava')
    .single();

  if (connErr || !conn) return json({ error: 'No Strava connection' }, 404);

  // ── Determine since timestamp ────────────────────────────────────────────
  const sinceDate = since
    ? new Date(since)
    : conn.last_sync_at
      ? new Date(conn.last_sync_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days default

  const afterUnix = Math.floor(sinceDate.getTime() / 1000);

  // ── Write sync_log start entry ───────────────────────────────────────────
  const { data: logEntry } = await supabase
    .from('sync_log')
    .insert({ user_id: userId, platform: 'strava' })
    .select('id')
    .single();
  const logId = logEntry?.id;

  // ── Fetch activities from Strava (up to 200, paginated) ──────────────────
  const allActivities: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const url = `${STRAVA_API}/athlete/activities?per_page=50&page=${page}&after=${afterUnix}`;
    const res  = await fetch(url, {
      headers: { Authorization: `Bearer ${conn.access_token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Strava API error:', err);
      break;
    }
    const batch: Record<string, unknown>[] = await res.json();
    if (!batch.length) break;
    allActivities.push(...batch);
    if (batch.length < 50 || allActivities.length >= 200) break;
    page++;
  }

  // ── Import each activity ─────────────────────────────────────────────────
  const counts = { imported: 0, linked: 0, skipped: 0, errors: 0 };
  const errorDetails: string[] = [];

  for (const a of allActivities) {
    try {
      const mapped = mapStravaActivity(a);
      const result = await importActivity(supabase, userId, 'strava', String(a.id), mapped);
      if (result === 'created') counts.imported++;
      else if (result === 'linked')  counts.linked++;
      else                           counts.skipped++;
    } catch (e) {
      const msg = `${a.id} (${a.sport_type ?? a.type}): ${(e as Error).message}`;
      console.error('Failed to import activity', msg);
      errorDetails.push(msg);
      counts.errors++;
    }
  }

  // ── Update last_sync_at + sync_log ───────────────────────────────────────
  const now = new Date().toISOString();
  await supabase
    .from('platform_connections')
    .update({ last_sync_at: now })
    .eq('user_id', userId)
    .eq('platform', 'strava');

  if (logId) {
    await supabase.from('sync_log').update({
      finished_at: now,
      imported:    counts.imported,
      linked:      counts.linked,
      skipped:     counts.skipped,
    }).eq('id', logId);
  }

  return json({ ok: true, ...counts, total: allActivities.length, errorDetails });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
