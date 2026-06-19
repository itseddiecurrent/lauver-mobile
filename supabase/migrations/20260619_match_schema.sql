-- =============================================================================
-- Match feature schema
-- Adds:  profiles match-related columns (visibility, gender, prefs, location)
--        swipes column rename (user_id→swiper_id, target_id→swiped_id, action→direction)
--        matches table
--        messages table
-- =============================================================================

-- ─── profiles: match columns ─────────────────────────────────────────────────

alter table profiles
  add column if not exists visible_in_match    boolean          default false,
  add column if not exists gender              text,
  add column if not exists pref_gender         text             default 'all',
  add column if not exists pref_distance_km    integer          default 25,
  add column if not exists pref_sports         text[]           default '{}',
  add column if not exists latitude            double precision,
  add column if not exists longitude           double precision,
  add column if not exists location_updated_at timestamptz;

-- ─── swipes: rename columns to match plan ────────────────────────────────────
-- Table was created with user_id / target_id / action (no data yet).
-- Rename to swiper_id / swiped_id / direction and add check constraint.

alter table swipes rename column user_id   to swiper_id;
alter table swipes rename column target_id to swiped_id;
alter table swipes rename column action    to direction;

alter table swipes
  add constraint swipes_direction_check check (direction in ('left', 'right'));

-- ─── matches ─────────────────────────────────────────────────────────────────

create table if not exists matches (
  id            uuid        primary key default gen_random_uuid(),
  user1_id      text        not null references profiles(id) on delete cascade,
  user2_id      text        not null references profiles(id) on delete cascade,
  matched_at    timestamptz default now(),
  unmatched_by  text,
  unmatched_at  timestamptz,
  unique (user1_id, user2_id),
  check (user1_id < user2_id)   -- canonical ordering: user1 always < user2
);

alter table matches enable row level security;

-- ─── messages ────────────────────────────────────────────────────────────────

create table if not exists messages (
  id         uuid        primary key default gen_random_uuid(),
  match_id   uuid        not null references matches(id) on delete cascade,
  sender_id  text        not null references profiles(id) on delete cascade,
  body       text        not null,
  sent_at    timestamptz default now(),
  read_at    timestamptz
);

alter table messages enable row level security;

-- index for fast message retrieval per match
create index if not exists messages_match_id_sent_at_idx on messages (match_id, sent_at);

-- index for unread count queries
create index if not exists messages_unread_idx on messages (match_id, sender_id, read_at)
  where read_at is null;
