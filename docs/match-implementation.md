# Match Feature — 实现步骤

每一步都是独立可测试的。完成一步再进下一步。

---

## ✅ Step 1 — DB 迁移 `[DONE — 2026-06-19 · 65 tests passing]`

**做什么：** 在 Supabase SQL Editor 里跑三段 DDL，给 profiles 加字段，建 matches 表，建 messages 表。

**具体操作：**

```sql
-- 1a. profiles 加字段
alter table profiles
  add column if not exists visible_in_match    boolean          default false,
  add column if not exists gender              text,
  add column if not exists pref_gender         text             default 'all',
  add column if not exists pref_distance_km    integer          default 25,
  add column if not exists pref_sports         text[]           default '{}',
  add column if not exists latitude            double precision,
  add column if not exists longitude           double precision,
  add column if not exists location_updated_at timestamptz;

-- 1b. matches 表
create table if not exists matches (
  id            uuid    primary key default gen_random_uuid(),
  user1_id      text    not null,
  user2_id      text    not null,
  matched_at    timestamptz default now(),
  unmatched_by  text,
  unmatched_at  timestamptz,
  unique (user1_id, user2_id)
);
alter table matches enable row level security;

-- 1c. messages 表
create table if not exists messages (
  id        uuid    primary key default gen_random_uuid(),
  match_id  uuid    references matches(id) on delete cascade,
  sender_id text    not null,
  body      text    not null,
  sent_at   timestamptz default now(),
  read_at   timestamptz
);
alter table messages enable row level security;

-- 1d. swipes 表（如果还没建）
create table if not exists swipes (
  id          uuid    primary key default gen_random_uuid(),
  swiper_id   text    not null,
  swiped_id   text    not null,
  direction   text    not null check (direction in ('left', 'right')),
  created_at  timestamptz default now(),
  unique (swiper_id, swiped_id)
);
alter table swipes enable row level security;
```

**验收：** 在 Supabase Table Editor 里能看到这四张表，profiles 表有新字段。

---

## ✅ Step 2 — SECURITY DEFINER RPC 函数 `[DONE — 2026-06-19 · 88 tests passing]`

**做什么：** 由于 Firebase OIDC 还没配，RLS 的 `auth.uid()` 是 null，所以所有查询都要走 SECURITY DEFINER 函数（和 activities 一样的绕过方案）。

**具体操作（Supabase SQL Editor）：**

```sql
-- 2a. 获取 match 候选人（按距离排序，过滤掉已 swipe 过的）
create or replace function get_match_candidates(
  uid          text,
  p_gender     text    default 'all',
  p_max_km     integer default 25,
  p_sports     text[]  default '{}'
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
  select
    p.id,
    coalesce(p.display_name, p.first_name, 'Athlete') as display_name,
    p.first_name,
    coalesce(p.photos, '{}') as photos,
    p.gender,
    coalesce(p.sports, '{}') as sports,
    p.skill,
    p.bio,
    p.city,
    case
      when p.latitude is null or (
        select latitude from profiles where id = uid
      ) is null then null
      else round((
        point(p.longitude, p.latitude) <@>
        point(
          (select longitude from profiles where id = uid),
          (select latitude  from profiles where id = uid)
        )
      )::numeric * 1.60934, 1)
    end as distance_km
  from profiles p
  where p.id <> uid
    and p.visible_in_match = true
    and (p_gender = 'all' or p.gender = p_gender)
    and p.id not in (
      select swiped_id from swipes where swiper_id = uid
    )
    and (
      array_length(p_sports, 1) is null
      or p_sports = '{}'
      or p.sports && p_sports
    )
  order by
    distance_km asc nulls last,
    array_length(p.sports & coalesce(
      (select sports from profiles where id = uid), '{}'
    ), 1) desc nulls last
  limit 50;
$$;

-- 2b. 记录 swipe，如果是互相 right 则创建 match，返回是否 matched
-- 每天 right swipe 上限 15 次，超出返回 { error: 'daily_limit' }
create or replace function record_swipe(
  uid       text,
  target_id text,
  dir       text   -- 'left' | 'right'
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  mutual    boolean := false;
  match_id  uuid;
  today_likes integer;
begin
  -- 检查每日 like 上限
  if dir = 'right' then
    select count(*) into today_likes
    from swipes
    where swiper_id = uid
      and direction = 'right'
      and created_at >= date_trunc('day', now() at time zone 'UTC');

    if today_likes >= 15 then
      return json_build_object('error', 'daily_limit', 'matched', false);
    end if;
  end if;

  insert into swipes (swiper_id, swiped_id, direction)
  values (uid, target_id, dir)
  on conflict (swiper_id, swiped_id) do update set direction = excluded.direction;

  if dir = 'right' then
    select exists (
      select 1 from swipes
      where swiper_id = target_id and swiped_id = uid and direction = 'right'
    ) into mutual;

    if mutual then
      insert into matches (user1_id, user2_id)
      values (least(uid, target_id), greatest(uid, target_id))
      on conflict do nothing
      returning id into match_id;
    end if;
  end if;

  return json_build_object('matched', mutual, 'match_id', match_id);
end;
$$;

-- 2c. 获取当前用户的所有 match（附对方基本信息）
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
    m.id                                                        as match_id,
    m.matched_at,
    case when m.user1_id = uid then m.user2_id else m.user1_id end as other_id,
    coalesce(p.display_name, p.first_name, 'Athlete')          as display_name,
    coalesce(p.photos, '{}')                                   as photos,
    (select body    from messages where match_id = m.id order by sent_at desc limit 1) as last_message,
    (select sent_at from messages where match_id = m.id order by sent_at desc limit 1) as last_msg_at,
    (select count(*) from messages
     where match_id = m.id and sender_id <> uid and read_at is null)                  as unread_count
  from matches m
  join profiles p on p.id = case when m.user1_id = uid then m.user2_id else m.user1_id end
  where (m.user1_id = uid or m.user2_id = uid)
    and m.unmatched_by is null
  order by last_msg_at desc nulls last, m.matched_at desc;
$$;

-- 2d. 获取某个 match 的消息列表
create or replace function get_messages(uid text, p_match_id uuid)
returns setof messages
language sql security definer set search_path = public as $$
  select * from messages
  where match_id = p_match_id
    and match_id in (
      select id from matches
      where user1_id = uid or user2_id = uid
    )
  order by sent_at asc;
$$;

-- 2e. 发消息
create or replace function send_message(uid text, p_match_id uuid, p_body text)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  msg messages;
begin
  insert into messages (match_id, sender_id, body)
  values (p_match_id, uid, p_body)
  returning * into msg;
  return msg;
end;
$$;

-- 2f. 标记消息已读
create or replace function mark_messages_read(uid text, p_match_id uuid)
returns void
language sql security definer set search_path = public as $$
  update messages
  set read_at = now()
  where match_id = p_match_id
    and sender_id <> uid
    and read_at is null;
$$;

-- 2g. Unmatch
create or replace function do_unmatch(uid text, p_match_id uuid)
returns void
language sql security definer set search_path = public as $$
  update matches
  set unmatched_by = uid, unmatched_at = now()
  where id = p_match_id
    and (user1_id = uid or user2_id = uid)
    and unmatched_by is null;
$$;
```

**验收：** 在 Supabase SQL Editor 里调用 `select get_match_candidates('some-uid')` 不报错。

---

## ✅ Step 3 — Mock 种子数据 `[DONE — 2026-06-19]`

**做什么：** 插入 10 个假用户到 profiles 表，用于在真实 app 里测试 Match 流程，不需要额外账号。

**具体操作（Supabase SQL Editor）：**

```sql
-- 先插入 auth.users 占位行（Firebase uid 格式）
-- 注意：这些是 mock 用户，不会真的能登录
insert into profiles (
  id, first_name, display_name, gender, sports, skill, bio, city,
  photos, visible_in_match, latitude, longitude
) values
  ('mock-sarah-001',  'Sarah',   'Sarah K.',   'female', array['running','yoga'],               'Intermediate', 'Morning runner, yoga enthusiast.', 'New York',      array['https://randomuser.me/api/portraits/women/1.jpg'], true,  40.7128,  -74.0060),
  ('mock-alex-002',   'Alex',    'Alex M.',    'male',   array['cycling','triathlon'],           'Advanced',     'Cat 2 cyclist, Ironman finisher.',  'New York',      array['https://randomuser.me/api/portraits/men/2.jpg'],   true,  40.7209,  -73.9950),
  ('mock-mei-003',    'Mei',     'Mei L.',     'female', array['climbing','hiking'],             'Advanced',     'Rock climber, weekend hiker.',      'New York',      array['https://randomuser.me/api/portraits/women/3.jpg'], true,  40.7282,  -73.9942),
  ('mock-jordan-004', 'Jordan',  'Jordan T.',  'other',  array['running','hiit'],               'Beginner',     'Just started running this year!',   'New York',      array['https://randomuser.me/api/portraits/men/4.jpg'],   true,  40.7489,  -73.9680),
  ('mock-chris-005',  'Chris',   'Chris B.',   'male',   array['swimming','open water'],        'Elite',        'Open water swimmer and coach.',     'New York',      array['https://randomuser.me/api/portraits/men/5.jpg'],   true,  40.7831,  -73.9712),
  ('mock-rina-006',   'Rina',    'Rina O.',    'female', array['trail running','skiing'],       'Advanced',     'Trail runner and powder chaser.',   'New York',      array['https://randomuser.me/api/portraits/women/6.jpg'], true,  40.7549,  -74.0020),
  ('mock-tom-007',    'Tom',     'Tom H.',     'male',   array['gym','strength training'],      'Intermediate', 'Powerlifter. Gym is life.',         'New York',      array['https://randomuser.me/api/portraits/men/7.jpg'],   true,  40.7120,  -74.0055),
  ('mock-priya-008',  'Priya',   'Priya S.',   'female', array['yoga','pilates'],               'Beginner',     'Yoga teacher, love the outdoors.',  'New York',      array['https://randomuser.me/api/portraits/women/8.jpg'], true,  40.7614,  -73.9776),
  ('mock-diego-009',  'Diego',   'Diego R.',   'male',   array['soccer','basketball'],          'Intermediate', 'Weekend warrior, team sports guy.', 'New York',      array['https://randomuser.me/api/portraits/men/9.jpg'],   true,  40.6892,  -74.0445),
  ('mock-liu-010',    'Liu',     'Liu Y.',     'female', array['running','cycling'],            'Advanced',     'Triathlete in training.',           'New York',      array['https://randomuser.me/api/portraits/women/10.jpg'],false, 40.7308,  -73.9973)
on conflict (id) do update set
  first_name   = excluded.first_name,
  display_name = excluded.display_name,
  gender       = excluded.gender,
  sports       = excluded.sports,
  skill        = excluded.skill,
  bio          = excluded.bio,
  city         = excluded.city,
  photos       = excluded.photos,
  visible_in_match = excluded.visible_in_match,
  latitude     = excluded.latitude,
  longitude    = excluded.longitude;

-- 预设 Sarah 已经 right-swipe 了当前测试账号（替换成你自己的 uid）
-- 运行这条之前先把 YOUR_UID 替换成真实值
insert into swipes (swiper_id, swiped_id, direction)
values ('mock-sarah-001', 'YOUR_UID', 'right')
on conflict (swiper_id, swiped_id) do nothing;
```

**验收：** Match 屏调用 `get_match_candidates` 能返回 Sarah、Alex、Mei 等人（Liu 因为 visible_in_match=false 不显示）。

---

## ✅ Step 4 — `src/lib/match.js` 扩展 `[DONE — 2026-06-19]`

**做什么：** 在现有的 `match.js` 里加入新的查询函数，全部走 RPC。

**需要新增的函数：**

```
getMatchCandidates(userId, { gender, maxKm, sports })
  → 调用 get_match_candidates RPC
  → 返回候选人数组

recordSwipe(userId, targetId, direction)
  → 调用 record_swipe RPC
  → 返回 { matched: boolean, matchId: string | null }

getMyMatches(userId)
  → 调用 get_my_matches RPC
  → 返回 match 列表（含对方头像、最新消息、未读数）

unmatch(userId, matchId)
  → 调用 do_unmatch RPC

updateMatchPrefs(userId, { visibleInMatch, gender, prefGender, prefDistanceKm, prefSports })
  → supabase.from('profiles').upsert(...)
  → 不需要 RPC，直接写（仅写自己的行）

updateLocation(userId, { latitude, longitude })
  → supabase.from('profiles').upsert({ id: userId, latitude, longitude, location_updated_at })
```

**验收：** 写一个临时 test 文件或直接在 JS console 里调用，能正确返回候选人列表。

---

## ✅ Step 5 — `src/lib/chat.js`（新文件）`[DONE — 2026-06-19]`

**做什么：** 封装消息相关的所有查询，单独放一个文件。

**需要实现的函数：**

```
getMessages(userId, matchId)
  → 调用 get_messages RPC
  → 返回消息数组

sendMessage(userId, matchId, body)
  → 调用 send_message RPC
  → 返回新消息对象

markRead(userId, matchId)
  → 调用 mark_messages_read RPC

subscribeToMessages(matchId, callback)
  → supabase.channel('messages:' + matchId)
      .on('postgres_changes', { event: 'INSERT', table: 'messages', filter: `match_id=eq.${matchId}` }, callback)
      .subscribe()
  → 返回 channel（用于 unsubscribe）
```

**验收：** 能成功发消息并通过 Supabase Dashboard 的 Table Editor 看到这条消息。

---

## ✅ Step 6 — `src/hooks/useMatch.js` 重写 `[DONE — 2026-06-19]`

**做什么：** 替换原来的 stub，实现真正的状态管理。

**这个 hook 需要管理的状态：**

```
candidates        — 候选人列表（经过 filter）
matches           — 已 match 列表
filters           — { gender, maxKm, sports }（从 AsyncStorage 持久化）
location          — { lat, lng } | null
locationPermission — 'granted' | 'denied' | 'undetermined'
loading
swiping           — 正在记录 swipe 时 true，防重复点击
lastMatchResult   — { matched: true, matchedWith: { id, name, photo } } | null（Match Toast 用）
likesRemaining    — 今日剩余 like 次数（0-15），显示在 Like 按钮旁
dailyLimitHit     — boolean，true 时 Like 按钮 disabled + 显示「Come back tomorrow」
```

**需要暴露的方法：**

```
swipeRight(targetId)
  → 检查 likesRemaining，如果 = 0 直接 setDailyLimitHit(true)，不发请求
  → 调用 recordSwipe
  → 如果返回 { error: 'daily_limit' }，setDailyLimitHit(true)
  → 如果 matched=true，setLastMatchResult(...)
  → likesRemaining - 1

swipeLeft(targetId)
  → 调用 recordSwipe（不消耗 like 次数）

applyFilters(filters)
  → 保存到 AsyncStorage
  → 重新拉 candidates

requestLocation()
  → expo-location requestForegroundPermissionsAsync()
  → 获取坐标，调用 updateLocation 写入 profiles
  → 重新拉 candidates（现在有坐标，distance 排序生效）

dismissMatchResult()
  → 清空 lastMatchResult
```

**初始化时：**
- 从 AsyncStorage 读取 filters
- 调用 requestLocation()
- count 今天已用的 like 数，算出 likesRemaining = max(0, 15 - used)

**验收：** 在 MatchScreen 里 console.log candidates，能看到 mock 用户列表。

---

## ✅ Step 7 — `src/hooks/useChat.js`（新文件）`[DONE — 2026-06-19]`

**做什么：** 封装单个 chat 会话的状态，供 ChatScreen 使用。

**接受参数：** `matchId`

**需要管理的状态：**

```
messages        — 消息列表
sending         — 正在发送时 true
inputText       — 输入框内容
```

**需要暴露的方法：**

```
send()           → 调用 sendMessage，乐观更新本地列表，失败回滚
setInputText(v)
```

**生命周期：**
- mount 时：getMessages 加载历史 + markRead + subscribeToMessages
- 每次新消息到来：追加到列表末尾 + 触发 markRead
- unmount 时：取消 Realtime 订阅

**验收：** 两个不同的设备或 tab 能互相发消息并即时显示。

---

## ✅ Step 8 — Profile Settings 加 Visibility Toggle `[DONE — 2026-06-19]`

**做什么：** 在 ProfileScreen 的 Settings Modal 里加一个 MATCHING 区块，让用户控制自己是否出现在 Match 列表里，同时设置自己的性别。

**UI 位置：** Settings Modal → 最顶部新增一个 section（在 APPEARANCE 之前）

**UI 内容：**

```
MATCHING
┌──────────────────────────────────────┐
│ Show me in the community    [switch] │
│ Turn off to become invisible         │
├──────────────────────────────────────┤
│ My gender                            │
│ [Man]  [Woman]  [Other]              │
└──────────────────────────────────────┘
```

- Switch 改变时立即调用 `updateMatchPrefs({ visibleInMatch })`，不等「Save」
- 性别选择同理，立即保存
- 不需要单独的 Save 按钮（参考 Tinder 的设计）

**验收：** 关掉 visible_in_match 后，通过 SQL 查询确认该用户不再出现在 `get_match_candidates` 结果里。

---

## ✅ Step 9 — MatchScreen 重写（主界面）`[DONE — 2026-06-19]`

**做什么：** 把 MatchScreen 从 stub 变成真正可用的界面。分三个区域：

### 9a. Onboarding Gate

第一次进入 Match 屏，如果用户没设置过 `pref_gender`，显示一个引导卡片：

```
┌────────────────────────────────┐
│  Who are you looking for?      │
│                                │
│  [Men]  [Women]  [Everyone]    │
│                                │
│  [Continue →]                  │
└────────────────────────────────┘
```

点击 Continue 后保存偏好，显示主界面。

### 9b. 主界面布局

```
┌─────────────────────────────────┐
│  DISCOVER              [Filter] │
│                                 │
│  ┌───────────────────────────┐  │
│  │  [Photo]                  │  │
│  │  Sarah K.  · 1.2 km       │  │
│  │  Running · Yoga            │  │
│  │  Intermediate · New York   │  │
│  └───────────────────────────┘  │
│                                 │
│   [✕]              [♥ Like]     │
│                                 │
│  ─────── MY MATCHES ──────────  │
│  [Sarah] [Mei]                  │
└─────────────────────────────────┘
```

- 候选人卡片显示：第一张照片、名字、距离、运动标签、Skill
- 每次操作后（Like 或 Pass）自动切到下一个候选人
- Like 按钮下方显示「12 likes left today」，`likesRemaining` 为 0 时按钮变灰，显示「Come back tomorrow ✦」
- 候选人看完时显示「All caught up! Check back later」

### 9c. Match Toast

当 swipeRight 返回 `matched: true`，在屏幕中央显示一个覆盖层：

```
┌──────────────────────┐
│                      │
│   It's a match! ♥    │
│                      │
│   You and Sarah      │
│   both liked each    │
│   other              │
│                      │
│  [Say Hi]  [Keep     │
│            swiping]  │
└──────────────────────┘
```

- Say Hi → 跳转到 ChatScreen
- Keep swiping → 关闭 toast，继续浏览

### 9d. Filter Sheet

点击右上角 [Filter] 按钮，弹出 bottom sheet：

```
┌──────────────────────┐
│  Filters         [✕] │
│                      │
│  Show me             │
│  [Men][Women][All]   │
│                      │
│  Max Distance        │
│  [5km][10km][25km]   │
│  [50km][Any]         │
│  (if no location:    │
│   greyed out +       │
│   Enable Location    │
│   button)            │
│                      │
│  Sports              │
│  [Running] [Cycling] │
│  [Swimming]...       │
│  (multi-select)      │
│                      │
│  [Apply Filters]     │
└──────────────────────┘
```

**验收：**
- 初次进入看到 Onboarding Gate
- 设置后看到候选人列表
- Like Sarah → 出现 Match Toast（因为 Step 3 预设了 Sarah 已经 like 了你）
- Pass Alex → Alex 消失
- Filter 改成只看 Climbing → 只剩 Mei

---

## ✅ Step 10 — ChatScreen（新文件）`[DONE — 2026-06-19]`

**做什么：** 实现私聊界面。从 MatchScreen 的 matches 列表点击进入。

**导航：** 需要在 navigation/index.js 里加一个 Stack.Screen

```
Main (Stack)
 └── Tabs
      └── Match (Tab)
           └── [点击 match] → ChatScreen (push)
```

**UI 结构：**

```
┌─────────────────────────────────┐
│ ←  Sarah K.              [···]  │  ← 右上角 ··· 是 Unmatch 入口
│                                 │
│              [头像]              │
│          Sarah K.               │
│     Matched on June 19          │
│                                 │
│  ┌──────────────────────┐       │
│  │ Hey! Love your        │       │  ← 对方消息，左对齐
│  │ running stats 👟      │  10:30 │
│  └──────────────────────┘       │
│                                 │
│       ┌──────────────────────┐  │
│ 10:31 │ Thanks! Do you run   │  │  ← 自己消息，右对齐
│       │ in Central Park?     │  │
│       └──────────────────────┘  │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Type a message...  [Send →] │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**消息气泡细节：**
- 自己：右对齐，橙色背景 (`c.ORANGE`)，白色文字
- 对方：左对齐，卡片背景 (`c.CARD_BG`)，正常文字颜色
- 同一人连续消息：只有最后一条显示时间戳
- 超过 24 小时的消息显示日期分隔线

**Unmatch 流程：**
1. 右上角 `···` → Alert「Unmatch Sarah? This cannot be undone.」
2. 确认 → 调用 `unmatch` → 返回上一页 → matches 列表刷新

**验收：**
- 能发消息
- 消息实时显示（Realtime 订阅工作）
- Unmatch 后返回 MatchScreen，Sarah 从 matches 列表消失

---

## Step 11 — 集成测试（完整流程跑通）⬅ 待手动验收

**做什么：** 按照下面的顺序，人工在真机/模拟器上测一遍。

```
测试 A — 可见性
  1. Profile → Settings → 关闭「Show me」
  2. 另一台设备登录 mock 账号，调用 get_match_candidates
  3. 确认你不在候选列表里
  4. 重新打开，确认重新出现

测试 B — Filter
  1. 进入 Match 屏，设置 gender=Female、distance=5km、sports=Running
  2. 确认只显示 Sarah（1.2km, female, running）
  3. 改成 All sports，确认 Sarah 和 Rina（也是 female, 15km 但超出 5km）只显示 Sarah
  4. 改成 distance=Any，Rina 出现

测试 C — Match 流程
  1. Like Sarah → Match Toast 出现（Sarah 预设已 like 你）
  2. Toast 点「Say Hi」→ 进入 ChatScreen
  3. 发一条消息
  4. 确认消息显示正确
  5. 返回 MatchScreen，Sarah 在 matches 列表里

测试 D — Unmatch
  1. 进入 Sarah 的 Chat
  2. 点 ··· → Unmatch
  3. 确认返回 MatchScreen，Sarah 消失
  4. 确认再次进入 Match 屏，Sarah 不会再出现在候选列表（已被 swipe）

测试 E — Pass 逻辑
  1. Pass Alex
  2. Alex 从候选列表消失
  3. 重启 app，Alex 仍然不出现（swipe 已持久化）

测试 F — 无定位时的 Filter
  1. 拒绝定位权限
  2. Filter Sheet 里 distance 选项 greyed out
  3. 候选人没有 distance_km 字段（显示城市名代替）
```

---

## 文件变更清单

完成后，新增/修改的文件如下：

```
新增：
  src/lib/chat.js
  src/hooks/useChat.js
  src/screens/match/ChatScreen.js

修改：
  src/lib/match.js              ← 加新函数
  src/hooks/useMatch.js         ← 完整重写
  src/screens/match/MatchScreen.js  ← 完整重写
  src/screens/profile/ProfileScreen.js  ← Settings 加 Visibility Toggle
  src/navigation/index.js       ← 加 ChatScreen route

SQL（手动跑）：
  Step 1 DDL
  Step 2 RPC 函数
  Step 3 seed 数据
```

---

## 已确认决策

| # | 问题 | 决定 | 影响 |
|---|------|------|------|
| 1 | Like 上限 | **每天 15 次**，午夜重置 | `swipes` 表加 `date` 字段；每次 swipeRight 前先 count 当天的 right swipe 数 |
| 2 | 已读状态 | **对方可以看到「已读」** | `messages.read_at` 不为 null 时，发送方气泡显示「已读」而不是「✓」 |
| 3 | Unmatch 后记录 | **软删除**，数据保留但双方不可见 | `matches.unmatched_by` + `unmatched_at` 打标记；`get_my_matches` 过滤掉 `unmatched_by IS NOT NULL` 的行；消息记录物理上还在 DB，只是无法访问 |
| 4 | Match Toast | **手动关闭**，两个按钮：「Say Hi → Chat」和「Keep Swiping → 关闭」 | `lastMatchResult` 状态保持直到用户主动点击其中一个按钮 |
| 5 | 定位更新 | **每次打开 app 时更新一次** | `useMatch` 在 mount 时调用 `requestLocation()`，写入 `profiles.latitude/longitude` |
