-- Allow a pair to Match again after either user previously Unmatched.
-- The canonical matches row is reactivated so the unique pair constraint remains
-- intact and the old conversation history is retained behind the active match.

create or replace function get_match_candidates(
  uid       text,
  p_gender  text default 'all',
  p_max_km  integer default 25,
  p_sports  text[] default '{}'
)
returns table (
  id text, display_name text, first_name text, photos text[], gender text,
  sports text[], skill text, bio text, city text, distance_km double precision
)
language sql security definer set search_path = public as $$
  with me as (
    select latitude, longitude, sports as my_sports from profiles where id = uid
  )
  select p.id,
    coalesce(p.display_name, p.first_name, 'Athlete'), p.first_name,
    coalesce(p.photos, '{}'), p.gender, coalesce(p.sports, '{}'), p.skill, p.bio, p.city,
    case when p.latitude is null or (select latitude from me) is null then null
      else haversine_km((select latitude from me), (select longitude from me), p.latitude, p.longitude) end
  from profiles p, me
  where p.id <> uid and p.visible_in_match = true
    and (p_gender = 'all' or p.gender = p_gender)
    and not exists (
      select 1 from swipes s
      where s.swiper_id = uid and s.swiped_id = p.id
        and not exists (
          select 1 from matches old_match
          where old_match.user1_id = least(uid, p.id)
            and old_match.user2_id = greatest(uid, p.id)
            and old_match.unmatched_at is not null
        )
    )
    and (p_sports = '{}' or p_sports is null or p.sports && p_sports)
    and (p_max_km = 0 or p.latitude is null or (select latitude from me) is null
      or haversine_km((select latitude from me), (select longitude from me), p.latitude, p.longitude) <= p_max_km)
  order by distance_km asc nulls last,
    (select count(*) from unnest(coalesce(p.sports,'{}')) s
      where s = any(coalesce((select my_sports from me), '{}'))) desc
  limit 50;
$$;

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
      on conflict (user1_id, user2_id) do update
        set unmatched_by = null, unmatched_at = null, matched_at = now()
        where matches.unmatched_at is not null
      returning id into new_match_id;

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
