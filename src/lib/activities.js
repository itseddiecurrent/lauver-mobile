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
  const { monday, sunday } = getWeekBounds();
  const { data, error } = await supabase
    .from('activities')
    .select('distance_km, duration_seconds')
    .eq('user_id', userId)
    .gte('started_at', monday.toISOString())
    .lte('started_at', sunday.toISOString());

  if (error) throw error;

  return {
    count: data.length,
    totalDistanceKm:      parseFloat(data.reduce((s, a) => s + (a.distance_km      ?? 0), 0).toFixed(1)),
    totalDurationSeconds: data.reduce((s, a) => s + (a.duration_seconds ?? 0), 0),
  };
}

/**
 * Returns 7 buckets (Mon → Sun) with total minutes per day for the current week.
 * Each bucket: { day, mins, today }
 */
export async function getWeeklyChart(userId) {
  const { monday, sunday } = getWeekBounds();
  const { data, error } = await supabase
    .from('activities')
    .select('started_at, duration_seconds')
    .eq('user_id', userId)
    .gte('started_at', monday.toISOString())
    .lte('started_at', sunday.toISOString());

  if (error) throw error;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
  const buckets  = days.map((day, i) => ({ day, mins: 0, today: i === todayIdx }));

  for (const activity of data) {
    const d   = new Date(activity.started_at).getDay();
    const idx = d === 0 ? 6 : d - 1;
    buckets[idx].mins += Math.round((activity.duration_seconds ?? 0) / 60);
  }

  return buckets;
}

/**
 * Most recent N activities for the user.
 */
export async function getRecentActivities(userId, limit = 3) {
  const { data, error } = await supabase
    .from('activities')
    .select('id, title, sport, started_at, duration_seconds, distance_km, routes_count')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/**
 * All-time aggregate stats.
 * Returns { count, totalDistanceKm, longestKm, bestPaceSecPerKm }
 */
export async function getAllTimeStats(userId) {
  const { data, error } = await supabase
    .from('activities')
    .select('distance_km, duration_seconds, sport')
    .eq('user_id', userId);

  if (error) throw error;
  if (data.length === 0) return { count: 0, totalDistanceKm: 0, longestKm: null, bestPaceSecPerKm: null };

  const count            = data.length;
  const totalDistanceKm  = parseFloat(data.reduce((s, a) => s + (a.distance_km ?? 0), 0).toFixed(1));
  const withDist         = data.filter(a => a.distance_km > 0);
  const longestKm        = withDist.length > 0 ? Math.max(...withDist.map(a => a.distance_km)) : null;
  const runPace          = data.filter(a => a.sport === 'running' && a.distance_km > 0 && a.duration_seconds > 0);
  const bestPaceSecPerKm = runPace.length > 0
    ? Math.min(...runPace.map(a => a.duration_seconds / a.distance_km))
    : null;

  return { count, totalDistanceKm, longestKm, bestPaceSecPerKm };
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
    .from('activities')
    .select('started_at, distance_km')
    .eq('user_id', userId)
    .gte('started_at', startDate.toISOString())
    .order('started_at');

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
 * All activities for a user, optionally filtered by sport.
 */
export async function getActivitiesList(userId, sport = null) {
  let query = supabase
    .from('activities')
    .select('id, title, sport, started_at, duration_seconds, distance_km, routes_count, calories, avg_heart_rate')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (sport) query = query.eq('sport', sport);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Current calendar month totals.
 * Returns { count, totalDistanceKm }
 */
export async function getMonthStats(userId) {
  const { start, end } = getMonthBounds();
  const { data, error } = await supabase
    .from('activities')
    .select('distance_km')
    .eq('user_id', userId)
    .gte('started_at', start.toISOString())
    .lte('started_at', end.toISOString());

  if (error) throw error;

  return {
    count:           data.length,
    totalDistanceKm: Math.round(data.reduce((s, a) => s + (a.distance_km ?? 0), 0)),
  };
}
