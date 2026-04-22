/**
 * Supabase query functions for the Community feature.
 *
 * Required tables — run in Supabase SQL editor:
 *
 *   -- User profiles (1-to-1 with auth.users)
 *   create table profiles (
 *     id           uuid primary key references auth.users(id) on delete cascade,
 *     display_name text,
 *     avatar_url   text,
 *     sports       text[],
 *     bio          text,
 *     created_at   timestamptz default now()
 *   );
 *   alter table profiles enable row level security;
 *   create policy "profiles are public" on profiles for select using (true);
 *   create policy "users manage own profile" on profiles for all using (auth.uid() = id);
 *
 *   -- Community posts
 *   create table posts (
 *     id          uuid primary key default gen_random_uuid(),
 *     user_id     uuid references profiles(id) on delete cascade not null,
 *     body        text not null,
 *     activity_id uuid references activities(id) on delete set null,
 *     created_at  timestamptz default now()
 *   );
 *   alter table posts enable row level security;
 *   create policy "posts are public"      on posts for select using (true);
 *   create policy "users create own posts" on posts for insert with check (auth.uid() = user_id);
 *   create policy "users delete own posts" on posts for delete using (auth.uid() = user_id);
 *
 *   -- Post reactions (one per user per emoji per post)
 *   create table post_reactions (
 *     id         uuid primary key default gen_random_uuid(),
 *     post_id    uuid references posts(id) on delete cascade not null,
 *     user_id    uuid references profiles(id) on delete cascade not null,
 *     emoji      text not null,
 *     created_at timestamptz default now(),
 *     unique (post_id, user_id, emoji)
 *   );
 *   alter table post_reactions enable row level security;
 *   create policy "reactions are public"       on post_reactions for select using (true);
 *   create policy "users manage own reactions" on post_reactions for all using (auth.uid() = user_id);
 *
 *   -- Post comments
 *   create table post_comments (
 *     id         uuid primary key default gen_random_uuid(),
 *     post_id    uuid references posts(id) on delete cascade not null,
 *     user_id    uuid references profiles(id) on delete cascade not null,
 *     body       text not null,
 *     created_at timestamptz default now()
 *   );
 *   alter table post_comments enable row level security;
 *   create policy "comments are public"       on post_comments for select using (true);
 *   create policy "users manage own comments" on post_comments for all using (auth.uid() = user_id);
 *
 *   -- Groups
 *   create table groups (
 *     id           uuid primary key default gen_random_uuid(),
 *     name         text not null,
 *     sport        text not null,
 *     icon         text not null,
 *     member_count integer default 0,
 *     created_at   timestamptz default now()
 *   );
 *   alter table groups enable row level security;
 *   create policy "groups are public" on groups for select using (true);
 *
 *   create table group_members (
 *     id        uuid primary key default gen_random_uuid(),
 *     group_id  uuid references groups(id) on delete cascade not null,
 *     user_id   uuid references profiles(id) on delete cascade not null,
 *     joined_at timestamptz default now(),
 *     unique (group_id, user_id)
 *   );
 *   alter table group_members enable row level security;
 *   create policy "memberships are public"      on group_members for select using (true);
 *   create policy "users manage own membership" on group_members for all using (auth.uid() = user_id);
 *
 *   -- Events
 *   create table events (
 *     id             uuid primary key default gen_random_uuid(),
 *     name           text not null,
 *     sport          text not null,
 *     starts_at      timestamptz not null,
 *     location_name  text,
 *     attendee_count integer default 0,
 *     created_at     timestamptz default now()
 *   );
 *   alter table events enable row level security;
 *   create policy "events are public" on events for select using (true);
 *
 *   create table event_rsvps (
 *     id         uuid primary key default gen_random_uuid(),
 *     event_id   uuid references events(id) on delete cascade not null,
 *     user_id    uuid references profiles(id) on delete cascade not null,
 *     created_at timestamptz default now(),
 *     unique (event_id, user_id)
 *   );
 *   alter table event_rsvps enable row level security;
 *   create policy "rsvps are public"        on event_rsvps for select using (true);
 *   create policy "users manage own rsvps"  on event_rsvps for all using (auth.uid() = user_id);
 */

/**
 * Additional table for user-created communities:
 *
 *   create table communities (
 *     id             uuid primary key default gen_random_uuid(),
 *     name           text not null,
 *     contact        text,
 *     founders       text,
 *     location       text,
 *     cause          text,
 *     community_type text not null default 'in-person',  -- 'online' | 'in-person' | 'hybrid'
 *     privacy        text not null default 'public',     -- 'public' | 'private'
 *     join_policy    text not null default 'open',       -- 'open' | 'approval' | 'invite'
 *     tags           text[] default '{}',
 *     creator_id     uuid references profiles(id) on delete cascade not null,
 *     member_count   integer default 1,
 *     created_at     timestamptz default now()
 *   );
 *   alter table communities enable row level security;
 *   create policy "communities are public"      on communities for select using (true);
 *   create policy "users create communities"    on communities for insert with check (auth.uid() = creator_id);
 *   create policy "creators manage communities" on communities for all using (auth.uid() = creator_id);
 */

import { supabase } from './supabase';

// ─── Feed ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the community feed with author info, reactions, and comment count.
 * Returns posts enriched with reactionCounts {emoji: count} and userReactions [emoji].
 */
export async function getFeed(userId, limit = 20) {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      id, body, created_at,
      author:profiles!user_id ( id, display_name, avatar_url ),
      activity:activities!activity_id ( title, sport, distance_km, duration_seconds ),
      post_reactions ( emoji, user_id ),
      post_comments ( id )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(post => {
    const reactionCounts = {};
    for (const r of post.post_reactions) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
    }
    return {
      ...post,
      commentCount:   post.post_comments.length,
      reactionCounts,
      userReactions:  post.post_reactions.filter(r => r.user_id === userId).map(r => r.emoji),
    };
  });
}

/**
 * Create a new post, optionally attached to an activity.
 */
export async function createPost(userId, body, activityId = null) {
  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id: userId, body, activity_id: activityId || undefined })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Toggle a reaction emoji on a post. Returns true if added, false if removed.
 */
export async function toggleReaction(userId, postId, emoji) {
  const { data: existing } = await supabase
    .from('post_reactions')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from('post_reactions').delete().eq('id', existing.id);
    return false;
  }
  await supabase.from('post_reactions').insert({ user_id: userId, post_id: postId, emoji });
  return true;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

/**
 * Groups the user has not yet joined, ordered by member count.
 */
export async function getSuggestedGroups(userId, limit = 5) {
  const { data: joined } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);

  const joinedIds = (joined || []).map(g => g.group_id);

  let query = supabase
    .from('groups')
    .select('id, name, sport, icon, member_count')
    .order('member_count', { ascending: false })
    .limit(limit);

  if (joinedIds.length > 0) {
    query = query.not('id', 'in', `(${joinedIds.join(',')})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Join a group and increment its member count.
 */
export async function joinGroup(userId, groupId) {
  await supabase.from('group_members').insert({ user_id: userId, group_id: groupId });
  await supabase.rpc('increment_group_member_count', { group_id: groupId }).catch(() => {});
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Upcoming events (future starts_at), with whether the user has RSVP'd.
 */
export async function getUpcomingEvents(userId, limit = 5) {
  const [eventsRes, rsvpsRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, sport, starts_at, location_name, attendee_count')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(limit),
    supabase
      .from('event_rsvps')
      .select('event_id')
      .eq('user_id', userId),
  ]);

  if (eventsRes.error) throw eventsRes.error;

  const rsvpedIds = new Set((rsvpsRes.data || []).map(r => r.event_id));
  return (eventsRes.data || []).map(e => ({ ...e, hasRsvp: rsvpedIds.has(e.id) }));
}

// ─── Communities ──────────────────────────────────────────────────────────────

/**
 * Create a new community.
 */
export async function createCommunity(fields) {
  const { data, error } = await supabase
    .from('communities')
    .insert(fields)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Toggle RSVP for an event. Returns true if added, false if removed.
 */
export async function toggleRsvp(userId, eventId) {
  const { data: existing } = await supabase
    .from('event_rsvps')
    .select('id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing) {
    await supabase.from('event_rsvps').delete().eq('id', existing.id);
    return false;
  }
  await supabase.from('event_rsvps').insert({ user_id: userId, event_id: eventId });
  return true;
}
