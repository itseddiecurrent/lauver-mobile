-- Rename last_synced_at → last_sync_at to match edge function column names
alter table platform_connections
  rename column last_synced_at to last_sync_at;

-- sync_log: records every sync attempt for auditing and UI status display
create table if not exists sync_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  platform    text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  imported    int         default 0,
  linked      int         default 0,
  skipped     int         default 0,
  error_msg   text
);

create index if not exists sync_log_user_platform_idx
  on sync_log(user_id, platform, started_at desc);

alter table sync_log enable row level security;

create policy "Users read their own sync logs"
  on sync_log for select
  using (user_id = auth.uid()::text);

-- Service role handles inserts/updates (edge functions use service role key)
