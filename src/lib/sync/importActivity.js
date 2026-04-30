import { supabase } from '../supabase';

const TEMPORAL_WINDOW_MS  = 5 * 60 * 1000; // 5 minutes
const DURATION_TOLERANCE  = 0.10;           // 10%
const SOURCE_PRIORITY     = ['garmin', 'apple', 'strava', 'manual'];

export async function importActivity(userId, platform, externalId, data, rawData = null) {

  // Layer 1: exact match — already imported this platform+id?
  const { data: existingSource } = await supabase
    .from('activity_sources')
    .select('activity_id')
    .eq('platform', platform)
    .eq('external_id', String(externalId))
    .maybeSingle();

  if (existingSource) {
    return { status: 'skipped', activityId: existingSource.activity_id };
  }

  // Layer 2: temporal fingerprint — same workout from a different platform?
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

  if (temporalMatch && data.duration_seconds) {
    const ratio = data.duration_seconds / (temporalMatch.duration_seconds || 1);
    const durationMatch = ratio >= (1 - DURATION_TOLERANCE) && ratio <= (1 + DURATION_TOLERANCE);

    if (durationMatch) {
      await supabase.from('activity_sources').insert({
        activity_id: temporalMatch.id,
        platform,
        external_id: String(externalId),
        raw_data:    rawData,
      });
      await maybeUpgradeCanonicalSource(temporalMatch.id, temporalMatch.canonical_source, platform, data);
      return { status: 'linked', activityId: temporalMatch.id };
    }
  }

  // No duplicate — create new activity
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
    external_id: String(externalId),
    raw_data:    rawData,
  });

  return { status: 'created', activityId: newActivity.id };
}

async function maybeUpgradeCanonicalSource(activityId, currentSource, incomingPlatform, data) {
  const currentPriority  = SOURCE_PRIORITY.indexOf(currentSource);
  const incomingPriority = SOURCE_PRIORITY.indexOf(incomingPlatform);

  if (incomingPriority < currentPriority || currentPriority === -1) {
    await supabase
      .from('activities')
      .update({
        canonical_source: incomingPlatform,
        ...(data.avg_heart_rate   != null && { avg_heart_rate:   data.avg_heart_rate }),
        ...(data.distance_km      != null && { distance_km:      data.distance_km }),
        ...(data.elevation_gain_m != null && { elevation_gain_m: data.elevation_gain_m }),
      })
      .eq('id', activityId);
  }
}
