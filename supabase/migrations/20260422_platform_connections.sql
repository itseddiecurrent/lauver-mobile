-- platform_connections: stores OAuth tokens for each connected fitness platform
-- Run this in Supabase SQL editor

create table if not exists platform_connections (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        not null,
  platform         text        not null,        -- 'strava' | 'garmin' | 'apple'
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  requires_reauth  boolean     not null default false,
  meta             jsonb       default '{}'::jsonb,  -- athlete name, id, etc.
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),

  unique (user_id, platform)
);

alter table platform_connections enable row level security;

create policy "Users manage their own connections"
  on platform_connections for all
  using  (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

-- activity_sources: tracks which external platform each activity came from
-- Required for deduplication (see deduplicate.md)

create table if not exists activity_sources (
  id          uuid        primary key default gen_random_uuid(),
  activity_id uuid        not null references activities(id) on delete cascade,
  platform    text        not null,
  external_id text        not null,
  raw_data    jsonb,
  synced_at   timestamptz not null default now(),

  unique (platform, external_id)
);

create index if not exists activity_sources_activity_id_idx
  on activity_sources(activity_id);

alter table activity_sources enable row level security;

create policy "Users read their own sources"
  on activity_sources for select
  using (
    activity_id in (
      select id from activities where user_id = auth.uid()::text
    )
  );

-- Service role handles inserts (edge functions use service role key)
