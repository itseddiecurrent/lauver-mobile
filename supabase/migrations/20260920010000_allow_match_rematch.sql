-- Allow a pair to Match again after either user previously Unmatched.
-- The canonical matches row is reactivated so the unique pair constraint remains
-- intact and the old conversation history is retained behind the active match.

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
