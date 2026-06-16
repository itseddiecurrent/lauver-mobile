-- =============================================================================
-- Lauver schema — Task 0
-- Existing tables (skip): activities, activity_sources, communities,
--                         platform_connections, profiles
-- Creates: posts, post_reactions, post_comments, groups, group_members,
--          events, event_rsvps, swipes
-- Adds:    profiles.display_name column
-- RPC:     increment_group_member_count
-- Note:    All user_id columns are TEXT to match Firebase UID pattern.
--          RLS uses (auth.uid())::text for uuid→text comparison.
-- =============================================================================

-- ─── profiles: add missing column ────────────────────────────────────────────

alter table profiles add column if not exists display_name text;

-- ─── posts ───────────────────────────────────────────────────────────────────

create table if not exists posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     text references profiles(id) on delete cascade not null,
  body        text not null,
  activity_id uuid references activities(id) on delete set null,
  photo_url   text,
  created_at  timestamptz default now()
);

alter table posts enable row level security;

drop policy if exists "posts are public"       on posts;
drop policy if exists "users create own posts" on posts;
drop policy if exists "users delete own posts" on posts;
create policy "posts are public"       on posts for select using (true);
create policy "users create own posts" on posts for insert with check ((auth.uid())::text = user_id);
create policy "users delete own posts" on posts for delete using ((auth.uid())::text = user_id);

-- ─── post_reactions ──────────────────────────────────────────────────────────

create table if not exists post_reactions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references posts(id) on delete cascade not null,
  user_id    text references profiles(id) on delete cascade not null,
  emoji      text not null,
  created_at timestamptz default now(),
  unique (post_id, user_id, emoji)
);

alter table post_reactions enable row level security;

drop policy if exists "reactions are public"       on post_reactions;
drop policy if exists "users manage own reactions" on post_reactions;
create policy "reactions are public"       on post_reactions for select using (true);
create policy "users manage own reactions" on post_reactions for all    using ((auth.uid())::text = user_id);

-- ─── post_comments ───────────────────────────────────────────────────────────

create table if not exists post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references posts(id) on delete cascade not null,
  user_id    text references profiles(id) on delete cascade not null,
  body       text not null,
  created_at timestamptz default now()
);

alter table post_comments enable row level security;

drop policy if exists "comments are public"       on post_comments;
drop policy if exists "users manage own comments" on post_comments;
create policy "comments are public"       on post_comments for select using (true);
create policy "users manage own comments" on post_comments for all    using ((auth.uid())::text = user_id);

-- ─── groups ──────────────────────────────────────────────────────────────────

create table if not exists groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  sport        text not null,
  icon         text not null,
  member_count integer default 0,
  created_at   timestamptz default now()
);

alter table groups enable row level security;

drop policy if exists "groups are public" on groups;
create policy "groups are public" on groups for select using (true);

create table if not exists group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid references groups(id) on delete cascade not null,
  user_id   text references profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

alter table group_members enable row level security;

drop policy if exists "memberships are public"      on group_members;
drop policy if exists "users manage own membership" on group_members;
create policy "memberships are public"      on group_members for select using (true);
create policy "users manage own membership" on group_members for all    using ((auth.uid())::text = user_id);

-- ─── events ──────────────────────────────────────────────────────────────────

create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  sport          text not null,
  starts_at      timestamptz not null,
  location_name  text,
  attendee_count integer default 0,
  created_at     timestamptz default now()
);

alter table events enable row level security;

drop policy if exists "events are public" on events;
create policy "events are public" on events for select using (true);

create table if not exists event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id) on delete cascade not null,
  user_id    text references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (event_id, user_id)
);

alter table event_rsvps enable row level security;

drop policy if exists "rsvps are public"       on event_rsvps;
drop policy if exists "users manage own rsvps" on event_rsvps;
create policy "rsvps are public"       on event_rsvps for select using (true);
create policy "users manage own rsvps" on event_rsvps for all    using ((auth.uid())::text = user_id);

-- ─── swipes ──────────────────────────────────────────────────────────────────

create table if not exists swipes (
  id         uuid primary key default gen_random_uuid(),
  user_id    text references profiles(id) on delete cascade not null,
  target_id  text references profiles(id) on delete cascade not null,
  action     text not null,
  created_at timestamptz default now(),
  unique (user_id, target_id)
);

alter table swipes enable row level security;

drop policy if exists "users manage own swipes"     on swipes;
drop policy if exists "swipes readable for matches" on swipes;
create policy "users manage own swipes"     on swipes for all    using ((auth.uid())::text = user_id);
create policy "swipes readable for matches" on swipes for select using (
  (auth.uid())::text = user_id or (auth.uid())::text = target_id
);

-- ─── RPC: increment_group_member_count ───────────────────────────────────────

create or replace function increment_group_member_count(group_id uuid)
returns void
language sql
security definer
as $$
  update groups set member_count = member_count + 1 where id = group_id;
$$;
