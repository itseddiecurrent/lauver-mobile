/**
 * Supabase query functions for the Match feature.
 *
 * Profiles columns used (all exist in DB):
 *   skill        text    -- 'Beginner' | 'Intermediate' | 'Advanced'
 *   availability text[]  -- ['Weekends', 'Mornings', ...]
 *   city         text    -- location display name
 *   photos       text[]  -- uploaded photo URLs
 *   sports       text[]
 *   avatar_url   text
 *
 * Required swipes table (created via migration 20260616_initial_schema.sql):
 *   user_id/target_id are TEXT to match profiles.id (Firebase UID)
 *   RLS: (auth.uid())::text = user_id
 */

import { supabase } from './supabase';

// ─── Readiness check ──────────────────────────────────────────────────────────

/**
 * Returns an array of { key, label, done } requirement objects.
 * All must be done=true before matching is unlocked.
 */
export async function getMatchReadiness(user) {
  const checks = [
    { key: 'account', label: 'Account created', done: true },
  ];

  const { data: profile } = await supabase
    .from('profiles')
    .select('photos, avatar_url, sports, skill, city, availability')
    .eq('id', user.uid)
    .maybeSingle();

  checks.push(
    {
      key:   'photo',
      label: 'Profile photo uploaded',
      done:  (Array.isArray(profile?.photos) && profile.photos.length > 0) || !!profile?.avatar_url,
    },
    {
      key:   'sports',
      label: 'Sports & skill level set',
      done:  Array.isArray(profile?.sports) && profile.sports.length > 0 && !!profile?.skill,
    },
    {
      key:   'location',
      label: 'Location & availability set',
      done:  !!profile?.city && Array.isArray(profile?.availability) && profile.availability.length > 0,
    },
  );

  return checks;
}

// ─── Match candidates ─────────────────────────────────────────────────────────

/**
 * Fetch candidate profiles for the current user.
 * Excludes the user themselves and anyone already swiped.
 * Optionally filters by sports array overlap and skill_level.
 */
export async function getMatchCandidates(userId, { sports = [], skills = [] } = {}) {
  // IDs to exclude (self + already swiped)
  const { data: swiped } = await supabase
    .from('swipes')
    .select('target_id')
    .eq('user_id', userId);

  const excludeIds = [userId, ...(swiped || []).map(s => s.target_id)];

  let query = supabase
    .from('profiles')
    .select('id, display_name, avatar_url, photos, sports, skill, availability, city')
    .not('id', 'in', `(${excludeIds.join(',')})`)
    .limit(20);

  if (sports.length > 0) query = query.overlaps('sports', sports);
  if (skills.length > 0) query = query.in('skill', skills);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ─── Swipe ────────────────────────────────────────────────────────────────────

/**
 * Record a swipe action. action: 'pass' | 'like' | 'star'
 */
export async function recordSwipe(userId, targetId, action) {
  const { error } = await supabase
    .from('swipes')
    .upsert({ user_id: userId, target_id: targetId, action }, { onConflict: 'user_id,target_id' });
  if (error) throw error;
}

// ─── Mutual matches ───────────────────────────────────────────────────────────

/**
 * Returns profiles that the user liked/starred AND who liked/starred back.
 */
export async function getMutualMatches(userId) {
  // Everyone the current user liked or starred
  const { data: outgoing } = await supabase
    .from('swipes')
    .select('target_id')
    .eq('user_id', userId)
    .in('action', ['like', 'star']);

  const likedIds = (outgoing || []).map(s => s.target_id);
  if (likedIds.length === 0) return [];

  // Of those, who also liked/starred the current user back
  const { data: mutual, error } = await supabase
    .from('swipes')
    .select('user_id, profiles!user_id ( id, display_name, avatar_url )')
    .eq('target_id', userId)
    .in('user_id', likedIds)
    .in('action', ['like', 'star']);

  if (error) throw error;
  return (mutual || []).map(m => m.profiles).filter(Boolean);
}
