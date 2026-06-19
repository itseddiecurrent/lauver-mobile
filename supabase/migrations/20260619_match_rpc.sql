-- =============================================================================
-- Match feature RPC functions (SECURITY DEFINER — Firebase OIDC bypass)
-- All functions accept uid text (Firebase UID) and bypass RLS.
-- =============================================================================

-- ─── Haversine helper ────────────────────────────────────────────────────────

create or replace function haversine_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql immutable security definer set search_path = public as $$
  select round((
    2 * 6371 * asin(sqrt(
      pow(sin(radians((lat2 - lat1) / 2)), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      pow(sin(radians((lon2 - lon1) / 2)), 2)
    ))
  )::numeric, 1)::double precision;
$$;

-- ─── 2a. get_match_candidates ─────────────────────────────────────────────────
-- Returns visible profiles filtered by gender/distance/sports, excluding
-- anyone the user already swiped. Sorted by distance asc, sports overlap desc.
-- p_max_km = 0 means no distance limit.

create or replace function get_match_candidates(
  uid       text,
  p_gender  text    default 'all',
  p_max_km  integer default 25,
  p_sports  text[]  default '{}'
)
returns table (
  id           text,
  display_name text,
  first_name   text,
  photos       text[],
  gender       text,
  sports       text[],
  skill        text,
  bio          text,
  city         text,
  distance_km  double precision
)
language sql security definer set search_path = public as $$
  with me as (
    select latitude, longitude, sports as my_sports
    from profiles where id = uid
  )
  select
    p.id,
    coalesce(p.display_name, p.first_name, 'Athlete') as display_name,
    p.first_name,
    coalesce(p.photos, '{}')                           as photos,
    p.gender,
    coalesce(p.sports, '{}')                           as sports,
    p.skill,
    p.bio,
    p.city,
    case
      when p.latitude is null or (select latitude from me) is null then null
      else haversine_km(
        (select latitude  from me), (select longitude from me),
        p.latitude,                  p.longitude
      )
    end as distance_km
  from profiles p, me
  where p.id <> uid
    and p.visible_in_match = true
    and (p_gender = 'all' or p.gender = p_gender)
    and p.id not in (
      select swiped_id from swipes where swiper_id = uid
    )
    and (
      p_sports = '{}' or p_sports is null
      or p.sports && p_sports
    )
    and (
      p_max_km = 0
      or p.latitude is null
      or (select latitude from me) is null
      or haversine_km(
           (select latitude from me), (select longitude from me),
           p.latitude, p.longitude
         ) <= p_max_km
    )
  order by
    distance_km asc nulls last,
    (
      select count(*) from unnest(coalesce(p.sports,'{}')) s
      where s = any(coalesce((select my_sports from me), '{}'))
    ) desc
  limit 50;
$$;

-- ─── 2b. record_swipe ────────────────────────────────────────────────────────
-- Records a swipe. For 'right': enforces 15/day limit, checks mutual like,
-- creates match if mutual. Returns { matched, match_id, error? }.

create or replace function record_swipe(
  uid       text,
  target_id text,
  dir       text
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  today_likes integer;
  mutual      boolean := false;
  new_match_id uuid;
begin
  if dir = 'right' then
    select count(*) into today_likes
    from swipes
    where swiper_id = uid
      and direction = 'right'
      and created_at >= date_trunc('day', now() at time zone 'UTC');

    if today_likes >= 15 then
      return json_build_object('matched', false, 'match_id', null, 'error', 'daily_limit');
    end if;
  end if;

  insert into swipes (swiper_id, swiped_id, direction)
  values (uid, target_id, dir)
  on conflict (swiper_id, swiped_id)
  do update set direction = excluded.direction, created_at = now();

  if dir = 'right' then
    select exists(
      select 1 from swipes
      where swiper_id = target_id and swiped_id = uid and direction = 'right'
    ) into mutual;

    if mutual then
      insert into matches (user1_id, user2_id)
      values (least(uid, target_id), greatest(uid, target_id))
      on conflict (user1_id, user2_id) do nothing
      returning id into new_match_id;

      -- fetch id if the row already existed (conflict path)
      if new_match_id is null then
        select id into new_match_id from matches
        where user1_id = least(uid, target_id)
          and user2_id = greatest(uid, target_id);
      end if;
    end if;
  end if;

  return json_build_object('matched', mutual, 'match_id', new_match_id, 'error', null);
end;
$$;

-- ─── 2c. get_today_likes_count ────────────────────────────────────────────────
-- Returns how many right-swipes the user has made today (UTC day).
-- Hook uses this on mount to initialize likesRemaining = 15 - count.

create or replace function get_today_likes_count(uid text)
returns integer
language sql security definer set search_path = public as $$
  select count(*)::integer
  from swipes
  where swiper_id = uid
    and direction = 'right'
    and created_at >= date_trunc('day', now() at time zone 'UTC');
$$;

-- ─── 2d. get_my_matches ───────────────────────────────────────────────────────
-- Returns all active matches (unmatched_by is null) with other user info,
-- last message preview, and unread count.

create or replace function get_my_matches(uid text)
returns table (
  match_id     uuid,
  matched_at   timestamptz,
  other_id     text,
  display_name text,
  photos       text[],
  last_message text,
  last_msg_at  timestamptz,
  unread_count bigint
)
language sql security definer set search_path = public as $$
  select
    m.id                                                              as match_id,
    m.matched_at,
    case when m.user1_id = uid then m.user2_id else m.user1_id end   as other_id,
    coalesce(p.display_name, p.first_name, 'Athlete')                as display_name,
    coalesce(p.photos, '{}')                                         as photos,
    (select body    from messages msg where msg.match_id = m.id order by sent_at desc limit 1) as last_message,
    (select sent_at from messages msg where msg.match_id = m.id order by sent_at desc limit 1) as last_msg_at,
    (select count(*) from messages msg
     where msg.match_id = m.id and msg.sender_id <> uid and msg.read_at is null) as unread_count
  from matches m
  join profiles p
    on p.id = case when m.user1_id = uid then m.user2_id else m.user1_id end
  where (m.user1_id = uid or m.user2_id = uid)
    and m.unmatched_by is null
  order by last_msg_at desc nulls last, m.matched_at desc;
$$;

-- ─── 2e. get_messages ─────────────────────────────────────────────────────────
-- Returns all messages for a match, verified the caller is a participant.

create or replace function get_messages(uid text, p_match_id uuid)
returns setof messages
language sql security definer set search_path = public as $$
  select * from messages
  where match_id = p_match_id
    and match_id in (
      select id from matches
      where (user1_id = uid or user2_id = uid) and unmatched_by is null
    )
  order by sent_at asc;
$$;

-- ─── 2f. send_message ─────────────────────────────────────────────────────────
-- Inserts a message, verified caller is a participant of an active match.

create or replace function send_message(uid text, p_match_id uuid, p_body text)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  msg messages;
begin
  if not exists (
    select 1 from matches
    where id = p_match_id
      and (user1_id = uid or user2_id = uid)
      and unmatched_by is null
  ) then
    raise exception 'not a participant or match is inactive';
  end if;

  insert into messages (match_id, sender_id, body)
  values (p_match_id, uid, p_body)
  returning * into msg;

  return msg;
end;
$$;

-- ─── 2g. mark_messages_read ───────────────────────────────────────────────────
-- Marks all unread messages from the other person as read.

create or replace function mark_messages_read(uid text, p_match_id uuid)
returns void
language sql security definer set search_path = public as $$
  update messages
  set read_at = now()
  where match_id = p_match_id
    and sender_id <> uid
    and read_at is null;
$$;

-- ─── 2h. do_unmatch ───────────────────────────────────────────────────────────
-- Soft-deletes the match by setting unmatched_by/unmatched_at.
-- Both users lose access to the match and messages.

create or replace function do_unmatch(uid text, p_match_id uuid)
returns void
language sql security definer set search_path = public as $$
  update matches
  set unmatched_by = uid, unmatched_at = now()
  where id = p_match_id
    and (user1_id = uid or user2_id = uid)
    and unmatched_by is null;
$$;

-- ─── 2i. update_location ─────────────────────────────────────────────────────
-- Upserts the user's lat/lng. Called by useMatch on mount after location grant.

create or replace function update_location(
  uid  text,
  lat  double precision,
  lng  double precision
)
returns void
language sql security definer set search_path = public as $$
  update profiles
  set latitude = lat, longitude = lng, location_updated_at = now()
  where id = uid;
$$;
