/**
 * Supabase query functions for the Match feature.
 * All read queries go through SECURITY DEFINER RPC functions (Firebase OIDC bypass).
 * Write operations (updateMatchPrefs, updateLocation) upsert directly — safe since
 * they only touch the caller's own row and don't depend on auth.uid().
 *
 * DB schema: see supabase/migrations/20260619_match_schema.sql
 * RPC funcs:  see supabase/migrations/20260619_match_rpc.sql
 */

import { supabase } from './supabase';

// ─── Candidates ───────────────────────────────────────────────────────────────

/**
 * Returns up to 50 visible profiles matching the given filters, sorted by
 * distance then sports overlap. Excludes anyone already swiped.
 *
 * @param {string} userId - Firebase UID
 * @param {{ gender?: string, maxKm?: number, sports?: string[] }} filters
 *   gender  — 'male' | 'female' | 'other' | 'all'  (default 'all')
 *   maxKm   — max distance in km; 0 = no limit      (default 0)
 *   sports  — array of sport strings; [] = no filter (default [])
 */
export async function getMatchCandidates(userId, { gender = 'all', maxKm = 0, sports = [] } = {}) {
  const { data, error } = await supabase.rpc('get_match_candidates', {
    uid:      userId,
    p_gender: gender,
    p_max_km: maxKm,
    p_sports: sports.length > 0 ? sports : [],
  });
  if (error) throw error;
  return data ?? [];
}

// ─── Swipe ────────────────────────────────────────────────────────────────────

/**
 * Records a swipe and checks for a mutual match.
 * Enforces 15 right-swipes per UTC day.
 *
 * @param {string} userId
 * @param {string} targetId
 * @param {'left'|'right'} direction
 * @returns {{ matched: boolean, matchId: string|null, error: string|null }}
 *   error = 'daily_limit' when the 15/day cap is hit
 */
export async function recordSwipe(userId, targetId, direction) {
  const { data, error } = await supabase.rpc('record_swipe', {
    uid:       userId,
    target_id: targetId,
    dir:       direction,
  });
  if (error) throw error;
  return {
    matched: data?.matched ?? false,
    matchId: data?.match_id ?? null,
    error:   data?.error   ?? null,
  };
}

// ─── Daily like count ─────────────────────────────────────────────────────────

/**
 * Returns how many right-swipes the user has made today (UTC).
 * Used on hook mount to initialise likesRemaining.
 */
export async function getTodayLikesCount(userId) {
  const { data, error } = await supabase.rpc('get_today_likes_count', { uid: userId });
  if (error) throw error;
  return data ?? 0;
}

// ─── Matches list ─────────────────────────────────────────────────────────────

/**
 * Returns all active matches for the user, with the other person's info,
 * last message preview, and unread count. Sorted by last message date.
 */
export async function getMyMatches(userId) {
  const { data, error } = await supabase.rpc('get_my_matches', { uid: userId });
  if (error) throw error;
  return data ?? [];
}

// ─── Unmatch ──────────────────────────────────────────────────────────────────

/**
 * Soft-deletes the match. Both users lose access; messages remain in DB.
 */
export async function unmatch(userId, matchId) {
  const { error } = await supabase.rpc('do_unmatch', {
    uid:        userId,
    p_match_id: matchId,
  });
  if (error) throw error;
}

// ─── Match preferences ────────────────────────────────────────────────────────

/**
 * Updates the user's match preferences and/or visibility.
 * All fields are optional — only provided keys are written.
 *
 * @param {string} userId
 * @param {{
 *   visibleInMatch?: boolean,
 *   gender?:         string,
 *   prefGender?:     string,
 *   prefDistanceKm?: number,
 *   prefSports?:     string[],
 * }} prefs
 */
export async function updateMatchPrefs(userId, prefs) {
  const patch = { id: userId };
  if (prefs.visibleInMatch !== undefined) patch.visible_in_match  = prefs.visibleInMatch;
  if (prefs.gender         !== undefined) patch.gender            = prefs.gender;
  if (prefs.prefGender     !== undefined) patch.pref_gender       = prefs.prefGender;
  if (prefs.prefDistanceKm !== undefined) patch.pref_distance_km  = prefs.prefDistanceKm;
  if (prefs.prefSports     !== undefined) patch.pref_sports       = prefs.prefSports;

  const { error } = await supabase.from('profiles').upsert(patch);
  if (error) throw error;
}

// ─── Location ─────────────────────────────────────────────────────────────────

/**
 * Writes the user's current lat/lng to their profile.
 * Called after expo-location permission is granted.
 */
export async function updateLocation(userId, { latitude, longitude }) {
  const { error } = await supabase.rpc('update_location', {
    uid: userId,
    lat: latitude,
    lng: longitude,
  });
  if (error) throw error;
}
