# Match Feature — Product & Engineering Plan

## Overview

Match 是 Lauver 的运动伴侣发现功能。用户主动选择加入 dating pool，设置自己的偏好 filter，然后浏览符合条件的候选人，可以互相 like → 形成 match → 开启私聊。

---

## 1. 产品流程

### 1.1 能见度控制（Visibility Toggle）

用户首先决定自己是否愿意出现在别人的 Match 列表里。

- 默认：**不可见**（opt-in 模型，保护隐私）
- 入口：Profile → Settings → 「Show me in the Lauver community」Switch
- 如果关闭：用户的 profile 完全从所有人的候选池中消失，也不会收到任何 like，但已经建立的 match/chat 不受影响

```
Profile → Settings Modal
  ┌────────────────────────────────┐
  │ MATCHING                       │
  │ Show me to other athletes  [●] │
  │ Turn off to become invisible   │
  └────────────────────────────────┘
```

---

### 1.2 Match Screen — Filter 设置

用户第一次进入 Match 屏会被引导先设置偏好（Onboarding Gate）。之后可以随时通过右上角 Filter 按钮修改。

#### Filter 选项

| Filter | 类型 | 选项 |
|--------|------|------|
| 显示性别 | 单选 | 男性 / 女性 / 所有人 |
| 最大距离 | 单选 | 5km / 10km / 25km / 50km / 不限 |
| 运动类型 | 多选 | 见下方完整列表 |

> **距离 filter 需要定位权限。** 如果用户未授权，距离选项 greyed out，并显示「Enable location to filter by distance」提示，点击跳转系统权限弹窗。

#### 支持的运动类型（来自 Garmin / Strava / Apple Health 生态）

```
跑步类：  Running · Trail Running · Virtual Run · Track Running
骑行类：  Road Cycling · Mountain Biking · Gravel Cycling · Indoor Cycling · Virtual Ride
游泳类：  Pool Swimming · Open Water Swimming
登山类：  Hiking · Trail Hiking · Climbing · Bouldering
冬季运动：Skiing · Snowboarding · Cross-Country Skiing · Backcountry Skiing
水上运动：Rowing · Kayaking · Stand-Up Paddleboarding · Surfing
球类运动：Tennis · Pickleball · Golf · Soccer · Basketball
综合训练：Gym · Strength Training · HIIT · CrossFit · Yoga · Pilates · Martial Arts
其他：    Triathlon · Duathlon · Walking · Dance
```

---

### 1.3 候选人排序逻辑

Filter 应用后，候选池按以下权重排序：

1. **距离**（若有定位）：从近到远
2. **运动重叠度**：shared sports 数量多的优先
3. **活跃度**：最近 30 天内有同步活动的优先
4. **注册时间**：较新的用户降权（防止新用户被忽略，给早期用户更多曝光）

---

### 1.4 浏览 & 操作

```
Match Screen
  ┌──────────────────────────────────┐
  │  [Filter]          DISCOVER  [⚙] │
  │                                  │
  │  ┌────────────────────────────┐  │
  │  │  [Photo]                   │  │
  │  │  Sarah, 28 · 2.3 km away   │  │
  │  │  Running · Cycling         │  │
  │  │  Intermediate              │  │
  │  └────────────────────────────┘  │
  │                                  │
  │     [✕ Pass]      [♥ Like]       │
  │                                  │
  │  ─────── MATCHES (3) ──────────  │
  │  [Alex] [Mei] [Jordan]           │
  └──────────────────────────────────┘
```

- **Like** → 存入 `swipes` 表（direction: 'right'），检查对方是否也 like 了你
- **Pass** → 存入 `swipes`（direction: 'left'），当天不再出现
- **Mutual Like** → 触发 match，卡片动画 + toast「It's a match!」，双方进入 matches 列表
- **Unmatch** → 从 Match 详情页可以 unmatch，双方从对方 match 列表消失，聊天记录清除（软删除）

---

### 1.5 Match 后 — 私聊

Match 建立后，双方可以开启私聊。

```
Matches Tab → 点击头像 → Chat Screen
  ┌──────────────────────────────────┐
  │ ← Sarah                    [···] │
  │                                  │
  │       Hey! Love your Strava      │
  │       stats, do you run in       │
  │       Central Park?          [✓] │
  │                                  │
  │  Sure do! Every morning 7am ─┐   │
  │                               │   │
  │ ┌────────────────────────────┘   │
  │ [Type a message...]    [Send]    │
  └──────────────────────────────────┘
```

**消息功能（MVP）：**
- 文字消息
- 已读回执（单勾 = 发出，双勾 = 已读）
- 时间戳（超过 24 小时显示日期）
- Unmatch 入口（右上角 `···` 菜单）

**消息功能（后续迭代）：**
- 分享活动（「我刚完成了一个 15km 的 run，一起去？」）
- 语音消息
- 图片

---

## 2. 数据模型

### 2.1 新增 / 修改表

```sql
-- profiles 表新增字段
alter table profiles
  add column if not exists visible_in_match  boolean  default false,
  add column if not exists gender            text,                    -- 'male' | 'female' | 'other'
  add column if not exists pref_gender       text     default 'all', -- 'male' | 'female' | 'all'
  add column if not exists pref_distance_km  integer  default 25,
  add column if not exists pref_sports       text[]   default '{}',
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  add column if not exists location_updated_at timestamptz;

-- swipes 表（已存在，确认字段）
-- id, swiper_id, swiped_id, direction ('left'|'right'), created_at

-- matches 表（新建）
create table if not exists matches (
  id          uuid primary key default gen_random_uuid(),
  user1_id    text not null,
  user2_id    text not null,
  matched_at  timestamptz default now(),
  unmatched_by text,               -- uid of who unmatched, null = still matched
  unmatched_at timestamptz,
  unique (user1_id, user2_id)
);

-- messages 表（新建）
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid references matches(id) on delete cascade,
  sender_id   text not null,
  body        text not null,
  sent_at     timestamptz default now(),
  read_at     timestamptz
);
```

### 2.2 RLS 策略

```sql
-- matches: 只能看到自己参与的 match
create policy "users see own matches" on matches
  for select using (user1_id = auth.uid()::text or user2_id = auth.uid()::text);

-- messages: 只能看到自己参与的 match 里的消息
create policy "users see own messages" on messages
  for select using (
    match_id in (
      select id from matches
      where user1_id = auth.uid()::text or user2_id = auth.uid()::text
    )
  );
```

> **注意：** 和 activities 一样，auth.uid() 在 Firebase OIDC 未配置前为 null。matches/messages 需要同样的 SECURITY DEFINER RPC 绕过方案，或者等 Firebase Third-Party Auth 配好之后用正常 RLS。

---

## 3. 定位方案

使用 `expo-location`：

1. 进入 Match 屏时请求 `requestForegroundPermissionsAsync()`
2. 获取到坐标后 upsert 到 `profiles.latitude/longitude/location_updated_at`
3. 距离计算在 Postgres 侧用 `earth_distance` 或 Haversine 公式（SECURITY DEFINER RPC）
4. 坐标精度：存 4 位小数（~11m 精度），足够距离排序，不暴露精确位置

---

## 4. Mock 数据计划（用于测试）

在开发阶段使用 seed 数据，不依赖真实用户。

### 4.1 Mock 用户列表（10 人）

| # | Name | Gender | Sports | Distance from you | Status |
|---|------|--------|--------|-------------------|--------|
| 1 | Sarah K. | Female | Running, Yoga | 1.2 km | will like you back → **test mutual match** |
| 2 | Alex M. | Male | Cycling, Triathlon | 3.5 km | will pass you → test no match |
| 3 | Mei L. | Female | Climbing, Hiking | 5.1 km | you like, she likes → **test match + unmatch** |
| 4 | Jordan T. | Other | Running, HIIT | 8.3 km | you like, no response → test pending like |
| 5 | Chris B. | Male | Swimming, Open Water | 12 km | outside distance filter → test filter |
| 6 | Rina O. | Female | Trail Running, Skiing | 15 km | matches your sports exactly |
| 7 | Tom H. | Male | Gym, Strength Training | 0.8 km | nearest user |
| 8 | Priya S. | Female | Yoga, Pilates | 22 km | edge of distance filter |
| 9 | Diego R. | Male | Soccer, Basketball | 30 km | different sports → test sport filter |
| 10 | Liu Y. | Female | Running, Cycling | invisible (opted out) | test visibility toggle |

### 4.2 测试场景

```
场景 A — 基础流程
1. 打开 Match 屏，看到 Filter Onboarding Gate
2. 选择偏好：All genders · 10km · Running
3. 看到候选人按距离排序（Tom 0.8km 最先）
4. Like Sarah → 立即 match（她预设会 like 你）
5. 验证 matches 列表显示 Sarah

场景 B — Filter 测试
1. 改 distance filter 为 5km → Chris (12km) 消失
2. 改 sport filter 为 Climbing → 只剩 Mei
3. 改 gender filter 为 Female → Alex, Tom, Jordan 消失

场景 C — Match + Unmatch
1. Like Mei → match 建立
2. 点击 Mei 的头像 → 进入 Chat
3. 发送消息「Hey Mei!」
4. 收到回复（mock auto-reply）
5. 点击右上角 ··· → Unmatch
6. 确认 Mei 从 matches 列表消失
7. 确认聊天记录不再可访问

场景 D — 私聊功能
1. 点击 Sarah 进入 Chat
2. 发送几条消息
3. 验证时间戳、消息气泡左右布局正确
4. 验证 Realtime 订阅（新消息即时出现）

场景 E — Visibility Toggle
1. Profile → Settings → 关闭「Show me」
2. 退出到 Match 屏
3. 用另一个账号（或 mock）验证你不再出现在候选列表中
4. 重新开启 → 重新出现
```

---

## 5. 实现顺序

### Phase 1 — 基础架构（无 UI）
- [ ] DB 迁移：profiles 新字段 + matches + messages 表
- [ ] `src/lib/match.js` 扩展：`getMatchCandidates`, `recordSwipe`, `getMatches`, `unmatch`
- [ ] `src/lib/chat.js`（新）：`getMessages`, `sendMessage`, Realtime 订阅
- [ ] Mock seed 数据脚本

### Phase 2 — Match UI
- [ ] Visibility toggle 加入 Profile → Settings
- [ ] Filter Sheet（bottom sheet modal）
- [ ] 候选人卡片组件（photo, name, age, distance, sports chips）
- [ ] Like / Pass 按钮（MVP，先不做 swipe gesture）
- [ ] Match toast / 动画
- [ ] Matches 列表（横向头像 row）

### Phase 3 — Chat UI
- [ ] Chat Screen（消息气泡，输入框，发送）
- [ ] Realtime 消息订阅
- [ ] Unmatch 流程
- [ ] 已读回执

### Phase 4 — 打磨
- [ ] Swipe gesture（expo-gesture-handler）
- [ ] 分享活动消息类型
- [ ] Push notification（match 通知 + 新消息通知）
- [ ] 举报 / 屏蔽用户

---

## 6. 技术决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 消息实时性 | Supabase Realtime (postgres_changes on messages) | 已有 community 的实现可复用 |
| 距离计算 | Postgres Haversine RPC | 避免把所有用户坐标下载到客户端 |
| 地理位置存储 | profiles 表直接存 lat/lng | 简单，后续可迁移到 PostGIS |
| 卡片手势 | Phase 1 用按钮，Phase 4 加 swipe | 优先验证产品逻辑，手势是体验层 |
| 消息已读 | 客户端进入 chat 时批量 update read_at | 简单有效，不需要 WebSocket 双向确认 |

---

## 7. 开放问题（需要决策）

1. **Like 上限**：是否给每日 like 数量加限制（免费 N 次，付费无限）？
2. **Match 通知**：match 后是否立即发 push notification？需要集成 Expo Notifications + FCM
3. **消息已读回执**：是否对对方公开「已读」状态？（隐私敏感）
4. **照片发送**：Chat 里能不能发照片？需要 Storage bucket
5. **地理位置更新频率**：每次打开 app 更新，还是后台定期更新？
