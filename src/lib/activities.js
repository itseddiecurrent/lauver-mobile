/**
 * Supabase query functions for the activities feature.
 *
 * Required table — run in Supabase SQL editor:
 *
 *   create table activities (
 *     id               uuid primary key default gen_random_uuid(),
 *     user_id          uuid references auth.users(id) on delete cascade not null,
 *     title            text not null,
 *     sport            text not null,          -- 'running' | 'cycling' | 'swimming' | 'climbing' | 'hiking' | 'skiing' | 'gym' | 'yoga' | ...
 *     started_at       timestamptz not null,
 *     duration_seconds integer not null,
 *     distance_km      numeric(6,2),           -- null for non-distance sports (gym, yoga, climbing)
 *     routes_count     integer,                -- climbing only
 *     calories         integer,
 *     avg_heart_rate   integer,
 *     source           text default 'manual',  -- 'manual' | 'garmin' | 'apple_watch' | ...
 *     notes            text,
 *     created_at       timestamptz default now()
 *   );
 *
 *   alter table activities enable row level security;
 *   create policy "users see own activities" on activities for all using (auth.uid() = user_id);
 */

import { supabase } from './supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun … 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Aggregate stats for the current Mon–Sun week.
 * Returns { count, totalDistanceKm, totalDurationSeconds }
 */
export async function getWeekStats(userId) {
  const { data, error } = await supabase
    .rpc('get_week_stats_for_user', { uid: userId });

  if (error) throw error;

  const row = data ?? {};
  return {
    count:                row.count ?? 0,
    totalDistanceKm:      parseFloat((row.totalDistanceKm ?? row.totaldistancekm ?? 0).toFixed(1)),
    totalDurationSeconds: row.totalDurationSeconds ?? row.totaldurationseconds ?? 0,
  };
}

/**
 * Returns 7 buckets (Mon → Sun) with total minutes per day for the current week.
 * Each bucket: { day, mins, today }
 */
export async function getWeeklyChart(userId) {
  const { data, error } = await supabase
    .rpc('get_weekly_chart_for_user', { uid: userId });

  if (error) throw error;
  return (data ?? []).map(b => ({
    day:   b.day,
    mins:  Math.round(b.mins ?? 0),
    today: b.today ?? false,
  }));
}

/**
 * Most recent N activities for the user.
 */
export async function getRecentActivities(userId, limit = 3) {
  const { data, error } = await supabase
    .rpc('get_recent_activities_for_user', { uid: userId, lim: limit });

  if (error) throw error;
  return data ?? [];
}

/**
 * All-time aggregate stats.
 * Returns { count, totalDistanceKm, longestKm, bestPaceSecPerKm }
 */
export async function getAllTimeStats(userId) {
  const { data, error } = await supabase
    .rpc('get_all_time_stats_for_user', { uid: userId });

  if (error) throw error;

  const row = data ?? {};
  return {
    count:             row.count ?? 0,
    totalDistanceKm:   parseFloat((row.totalDistanceKm ?? row.totaldistancekm ?? 0).toFixed(1)),
    longestKm:         row.longestKm ?? row.longestkm ?? null,
    bestPaceSecPerKm:  row.bestPaceSecPerKm ?? row.bestpacesecperkm ?? null,
  };
}

/**
 * Distance per bucket for the chart.
 * period: 'Month' (4 weeks) | '3 Months' (12 weeks) | 'Year' (12 months)
 * Returns [{ label, km }]
 */
export async function getDistanceChartData(userId, period) {
  const now   = new Date();
  const weeks = period === 'Month' ? 4 : 12;
  const byMonth = period === 'Year';

  const startDate = new Date(now);
  if (byMonth) startDate.setFullYear(now.getFullYear() - 1);
  else         startDate.setDate(now.getDate() - weeks * 7);

  const { data, error } = await supabase
    .rpc('get_activities_for_chart', { uid: userId, start_date: startDate.toISOString() });

  if (error) throw error;

  if (byMonth) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { label: MONTHS[d.getMonth()], km: 0, y: d.getFullYear(), m: d.getMonth() };
    });
    for (const a of data) {
      const d = new Date(a.started_at);
      const b = buckets.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
      if (b) b.km += (a.distance_km ?? 0);
    }
    return buckets.map(b => ({ label: b.label, km: parseFloat(b.km.toFixed(1)) }));
  }

  // weekly buckets
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(now);
    start.setDate(now.getDate() + diffToMonday - (weeks - 1 - i) * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { label: `W${i + 1}`, km: 0, start, end };
  });
  for (const a of data) {
    const d = new Date(a.started_at);
    const b = buckets.find(x => d >= x.start && d <= x.end);
    if (b) b.km += (a.distance_km ?? 0);
  }
  return buckets.map(b => ({ label: b.label, km: parseFloat(b.km.toFixed(1)) }));
}

/**
 * Fetch a single activity by its UUID.
 * Returns the full row or throws on error / not found.
 */
export async function getActivityById(activityId) {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .single();
  if (error) throw new Error(error.message || 'Activity not found');
  return data;
}

/**
 * Insert a new manually-logged activity.
 * fields: { title, sport, startedAt (Date), durationSeconds, distanceKm?, routesCount?, calories?, notes? }
 * Returns the new row's id.
 */
export async function insertActivity(userId, fields) {
  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id:          userId,
      title:            fields.title,
      sport:            fields.sport,
      started_at:       fields.startedAt instanceof Date
                          ? fields.startedAt.toISOString()
                          : fields.startedAt,
      duration_seconds: fields.durationSeconds,
      distance_km:      fields.distanceKm   ?? null,
      routes_count:     fields.routesCount  ?? null,
      calories:         fields.calories     ?? null,
      notes:            fields.notes        ?? null,
      canonical_source: 'manual',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message || 'Failed to insert activity');
  return data;
}

/**
 * All activities for a user, optionally filtered by sport.
 */
export async function getActivitiesList(userId, sport = null) {
  const { data, error } = await supabase
    .rpc('get_activities_list_for_user', { uid: userId, sport_filter: sport ?? null });

  if (error) throw error;
  return data ?? [];
}

/**
 * Current calendar month totals.
 * Returns { count, totalDistanceKm }
 */
export async function getMonthStats(userId) {
  const { data, error } = await supabase
    .rpc('get_month_stats_for_user', { uid: userId });

  if (error) throw error;

  const row = data ?? {};
  return {
    count:           row.count ?? 0,
    totalDistanceKm: Math.round(row.totalDistanceKm ?? row.totaldistancekm ?? 0),
  };
}
