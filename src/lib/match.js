/**
 * Supabase query functions for the Match feature.
 *
 * Additional columns needed on the profiles table:
 *
 *   alter table profiles add column if not exists skill_level   text;          -- 'Beginner' | 'Intermediate' | 'Advanced'
 *   alter table profiles add column if not exists availability  text[];        -- ['Weekends', 'Mornings', ...]
 *   alter table profiles add column if not exists location_name text;
 *
 * Required swipes table:
 *
 *   create table swipes (
 *     id         uuid primary key default gen_random_uuid(),
 *     user_id    uuid references profiles(id) on delete cascade not null,
 *     target_id  uuid references profiles(id) on delete cascade not null,
 *     action     text not null,   -- 'pass' | 'like' | 'star'
 *     created_at timestamptz default now(),
 *     unique (user_id, target_id)
 *   );
 *   alter table swipes enable row level security;
 *   create policy "users manage own swipes" on swipes for all using (auth.uid() = user_id);
 *   create policy "swipes readable for matches" on swipes for select using (
 *     auth.uid() = user_id or auth.uid() = target_id
 *   );
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
    .select('avatar_url, sports, skill_level, location_name, availability')
    .eq('id', user.id)
    .maybeSingle();

  checks.push(
    {
      key:   'photo',
      label: 'Profile photo uploaded',
      done:  !!profile?.avatar_url,
    },
    {
      key:   'sports',
      label: 'Sports & skill level set',
      done:  Array.isArray(profile?.sports) && profile.sports.length > 0 && !!profile?.skill_level,
    },
    {
      key:   'location',
      label: 'Location & availability set',
      done:  !!profile?.location_name && Array.isArray(profile?.availability) && profile.availability.length > 0,
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
    .select('id, display_name, avatar_url, sports, skill_level, availability, location_name')
    .not('id', 'in', `(${excludeIds.join(',')})`)
    .limit(20);

  if (sports.length > 0) query = query.overlaps('sports', sports);
  if (skills.length > 0) query = query.in('skill_level', skills);

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
