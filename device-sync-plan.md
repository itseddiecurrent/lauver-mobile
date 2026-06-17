# Lauver — 设备同步与运动导入计划

> 目标：支持 Strava / Apple Health / Garmin / COROS 四路数据源，Dashboard 提供类 Strava 的"从设备同步"体验。

---

## 一、现状速查

| 模块 | 现状 | 缺什么 |
|------|------|--------|
| `importActivity.js` | ✅ 2 层去重（exact + temporal fingerprint）已完成 | — |
| `appleSync.js` | ✅ HK workout 类型映射 + 导入已完成 | 仅在首次 connect 时触发，无手动重同步 |
| `useAppleHealthConnect.js` | ✅ HealthKit 权限申请 + syncWorkouts 已完成 | 需 dev build，Expo Go 下不可用 |
| `useStravaConnect.js` | ✅ OAuth2 PKCE 流程已完成，token 传给 Edge Function | Edge Function 只做 auth，**没有 activity 拉取** |
| Garmin | ❌ Profile 里 UI stub，`setGarminConnected(true)` 假连接 | 全部 |
| COROS | ❌ 完全没有 | 全部 |
| Dashboard 同步入口 | ❌ 没有 | 全部 |

---

## 二、架构

```
手机 App
├── useStravaConnect   ─── OAuth PKCE ──► Supabase Edge Function: strava-auth
│                                         ├── 交换 code → access_token / refresh_token
│                                         ├── 存入 platform_connections 表
│                                         └── 触发首次 activity 拉取
│
├── useAppleHealthConnect ─── HealthKit API (本地, 无网络) ──► appleSync.js ──► importActivity
│
├── useGarminConnect  ─── OAuth1a ──► Supabase Edge Function: garmin-auth
│                                     ├── 注册 webhook (push-based)
│                                     └── Garmin 推送新活动 → Edge Function 写入
│
├── useCorosConnect   ─── OAuth2 ──► Supabase Edge Function: coros-auth
│                                    ├── 拉取最近活动列表
│                                    └── 逐条 importActivity
│
└── useSyncStatus     ─── 查 sync_log 表，暴露给 Dashboard 和 Profile
                           ├── lastSyncAt (per platform)
                           ├── importedCount (this sync)
                           └── isSyncing
```

**规则：所有 client_secret / API key 必须在 Supabase Edge Function 里，不能出现在 App bundle 里。**

---

## 三、数据库补充（Supabase SQL Editor）

```sql
-- 已有：platform_connections (user_id, platform, meta, requires_reauth)
-- 补充字段：
alter table platform_connections
  add column if not exists access_token  text,
  add column if not exists refresh_token text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_sync_at    timestamptz,
  add column if not exists webhook_id      text;

-- 同步日志（每次同步写一行）
create table if not exists sync_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  platform     text not null,          -- 'strava' | 'apple' | 'garmin' | 'coros'
  started_at   timestamptz default now(),
  finished_at  timestamptz,
  imported     integer default 0,
  skipped      integer default 0,
  linked       integer default 0,
  error        text,
  created_at   timestamptz default now()
);
alter table sync_log enable row level security;
create policy "users see own logs" on sync_log for select using ((auth.uid())::text = user_id);
create policy "users insert own logs" on sync_log for insert with check ((auth.uid())::text = user_id);
create policy "users update own logs" on sync_log for update using ((auth.uid())::text = user_id);
```

---

## 四、各平台详细方案

---

### 4-A  Strava ★ 最高优先级（OAuth 已完成，只差 activity 拉取）

**API：** REST，Bearer token，公开，无需 partnership
**难度：** 中

#### Edge Function：`supabase/functions/strava-auth/index.ts`（改造现有）

```
POST /strava-auth  { code, userId }
→ 交换 access_token + refresh_token
→ 写入 platform_connections
→ 立即调用 syncStravaActivities(userId, accessToken) 拉近 30 天
→ 返回 { athlete: {...}, imported: N }
```

```
POST /strava-sync  { userId }        ← 手动"立即同步"按钮触发
→ 从 platform_connections 拿 token（如过期先 refresh）
→ GET https://www.strava.com/api/v3/athlete/activities?per_page=50&after=<last_sync_unix>
→ 逐条 importActivity(userId, 'strava', activity.id, mapped)
→ 更新 platform_connections.last_sync_at
→ 写 sync_log
```

#### `src/lib/sync/stravaSync.js`（新建）

```js
const STRAVA_SPORT_MAP = {
  Run: 'running', Ride: 'cycling', Swim: 'swimming',
  Hike: 'hiking', Walk: 'hiking', RockClimbing: 'climbing',
  AlpineSki: 'skiing', NordicSki: 'skiing',
  WeightTraining: 'gym', Yoga: 'yoga', Workout: 'gym',
};

export function mapStravaActivity(a) {
  return {
    sport:            STRAVA_SPORT_MAP[a.type] ?? 'other',
    title:            a.name,
    started_at:       a.start_date,
    duration_seconds: a.moving_time,
    distance_km:      a.distance ? +(a.distance / 1000).toFixed(2) : null,
    avg_heart_rate:   a.average_heartrate ?? null,
    calories:         a.calories ?? null,
    elevation_gain_m: a.total_elevation_gain ?? null,
  };
}
```

#### UI 改动

- `useStravaConnect.js`：connect 成功后自动调用 `/strava-sync`
- Profile 卡片：加"同步中…"状态 + 上次同步时间
- Dashboard：加"从 Strava 同步"按钮（见第六节）

---

### 4-B  Apple Health ★ 现有功能完善

**API：** `react-native-health`（HealthKit 本地库），**需要 dev build**
**难度：** 低（代码基本完成）

#### 现有问题
1. `syncWorkouts()` 只在首次 connect 后触发一次
2. 无手动重同步入口
3. Dashboard 不知道 Apple Health 的同步状态

#### 改动

`useAppleHealthConnect.js`：
- `lastSyncAt` 存入 `AsyncStorage` (key: `@apple_last_sync`)
- `syncWorkouts()` 读 `lastSyncAt`，只拉比它新的 workouts（`startDate: lastSyncAt`）
- 同步完成后更新 `lastSyncAt` + 写 `sync_log`
- 暴露 `lastSyncAt` 供 Dashboard 展示

Dashboard sync 入口直接调用 `apple.syncWorkouts()`。

---

### 4-C  Garmin ★★ 中等优先级

**API：** Garmin Health API（push-based webhook）
**前置要求：** 申请 Garmin Developer Program（免费，但需填表审核，通常 1-2 周）
  → https://developer.garmin.com/gc-developer-program/overview/

**OAuth：** OAuth 1.0a（与 Strava 的 2.0 不同，稍复杂）

#### 工作方式（和 Strava 不同！）

Garmin 是 **push** 模式，不是 pull 模式：
1. 用户在 App 里 OAuth 授权 → Garmin 记录你的 webhook URL
2. 用户在 Garmin 设备上完成运动 → 数据同步到 Garmin Connect
3. **Garmin 主动 POST 到你的 webhook** → 你的 Edge Function 接收并写入 DB

```
Garmin Connect App (手机) → Garmin 服务器 → POST webhook → Edge Function: garmin-webhook
                                                                  └── importActivity(userId, 'garmin', ...)
```

#### Edge Functions 需要

| 函数 | 功能 |
|------|------|
| `garmin-auth` | OAuth 1.0a 签名交换 + 注册 webhook URL |
| `garmin-webhook` | 接收 Garmin push，解析 FIT-like JSON，写入 activities |

#### `src/lib/sync/garminSync.js`（新建）

```js
const GARMIN_SPORT_MAP = {
  RUNNING: 'running', CYCLING: 'cycling', SWIMMING: 'swimming',
  HIKING: 'hiking', WALKING: 'hiking', ROCK_CLIMBING: 'climbing',
  ALPINE_SKIING: 'skiing', YOGA: 'yoga', STRENGTH_TRAINING: 'gym',
};

export function mapGarminActivity(summary) {
  return {
    sport:            GARMIN_SPORT_MAP[summary.activityType] ?? 'other',
    title:            summary.activityName ?? summary.activityType,
    started_at:       new Date(summary.startTimeInSeconds * 1000).toISOString(),
    duration_seconds: summary.durationInSeconds,
    distance_km:      summary.distanceInMeters ? +(summary.distanceInMeters / 1000).toFixed(2) : null,
    avg_heart_rate:   summary.averageHeartRateInBeatsPerMinute ?? null,
    calories:         summary.activeKilocalories ?? null,
    elevation_gain_m: summary.totalElevationGainInMeters ?? null,
  };
}
```

#### 开发路线（考虑到审核周期）

- **Phase 1（现在可做）**：UI 框架 + `useGarminConnect` stub + Edge Function 占位 + 完整的 `garminSync.js`
- **Phase 2（拿到 API 权限后）**：接上真实 OAuth 1.0a + webhook

---

### 4-D  COROS ★★ 中等优先级

**API：** COROS Open API（需注册开发者账号）
  → https://open.coros.com/
**OAuth：** OAuth 2.0，和 Strava 类似（pull 模式）
**前置：** 在 https://developer.coros.com/ 申请 client_id + client_secret

#### 类似 Strava 的流程

```
POST /coros-auth  { code, userId }
→ POST https://open.coros.com/oauth2/accesstoken 换 token
→ GET  https://open.coros.com/v2/workout/list?after=<ts>  拉活动列表
→ 逐条 importActivity
```

#### `src/lib/sync/corosSync.js`（新建）

```js
const COROS_SPORT_MAP = {
  100: 'running',   // Outdoor Running
  101: 'running',   // Track Running
  102: 'hiking',    // Trail Running  (映射到hiking更接近)
  103: 'cycling',   // Outdoor Cycling
  104: 'cycling',   // Indoor Cycling
  200: 'swimming',  // Pool Swimming
  300: 'gym',       // Strength Training
  400: 'climbing',  // Mountaineering
  // ...更多见 COROS API 文档
};

export function mapCorosActivity(workout) {
  return {
    sport:            COROS_SPORT_MAP[workout.mode] ?? 'other',
    title:            workout.name,
    started_at:       new Date(workout.startTime * 1000).toISOString(),
    duration_seconds: workout.totalTime,
    distance_km:      workout.totalDistance ? +(workout.totalDistance / 100000).toFixed(2) : null,
    avg_heart_rate:   workout.avgHr ?? null,
    calories:         workout.calorie ?? null,
    elevation_gain_m: workout.totalAscent ? workout.totalAscent / 100 : null,
  };
}
```

---

## 五、同步状态 Hook：`useSyncStatus.js`

所有平台同步状态的统一读取层，Dashboard 和 Profile 都依赖它。

```js
export function useSyncStatus() {
  // 读 platform_connections 表，返回每个平台的 last_sync_at + 最新 sync_log
  return {
    platforms: {
      strava: { connected, lastSyncAt, lastImported, isSyncing },
      apple:  { connected, lastSyncAt, lastImported, isSyncing },
      garmin: { connected, lastSyncAt, lastImported, isSyncing },
      coros:  { connected, lastSyncAt, lastImported, isSyncing },
    },
    totalConnected,   // 已连接平台数
    anyConnected,     // boolean
    syncAll,          // 触发所有已连接平台同步
  };
}
```

---

## 六、Dashboard "从设备同步" UI

在 Dashboard 现有 RECENT ACTIVITIES 区块上方加一个 **SyncBar** 组件：

```
┌─────────────────────────────────────────────┐
│  ↻  同步  │ ◉ Strava  ◉ Apple  ○ Garmin    │
│           │ 上次同步：3 分钟前  +2 新活动    │
└─────────────────────────────────────────────┘
```

- 有已连接平台时显示，全未连接则不显示
- 点击 `↻ 同步` → 调用 `syncAll()`
- 同步中显示 spinner + "同步中…"
- 完成后刷新 recentActivities（调用 `refresh()`）
- 如果本次 imported > 0，短暂显示 "+N 个新活动" badge

**文件**：`src/components/SyncBar.js`（新建）+ `DashboardScreen.js` 引入

---

## 七、任务清单

| # | 任务 | 依赖 | 优先级 | 估时 |
|---|------|------|--------|------|
| S1 | `strava-auth` Edge Function（改造：加 token 存储 + 首次 activity 拉取） | Strava app 已注册 | 🔴 高 | 2h |
| S2 | `strava-sync` Edge Function（手动/增量同步） | S1 | 🔴 高 | 1h |
| S3 | `stravaSync.js` + sport map | — | 🔴 高 | 0.5h |
| S4 | `useStravaConnect.js` 接 strava-sync，暴露 lastSyncAt | S1, S2 | 🔴 高 | 1h |
| A1 | `useAppleHealthConnect.js` 增量同步（存 lastSyncAt 到 AsyncStorage） | — | 🟡 中 | 1h |
| A2 | Apple Health 写 sync_log | A1 | 🟡 中 | 0.5h |
| D1 | `sync_log` 数据库表创建 + platform_connections 补字段 | — | 🔴 高 | 0.5h |
| D2 | `useSyncStatus.js` hook | D1 | 🔴 高 | 1h |
| D3 | `SyncBar` 组件 + Dashboard 接入 | D2 | 🟡 中 | 1.5h |
| G1 | `garminSync.js` sport map（代码可提前写，不依赖 API 权限） | — | 🟢 低 | 0.5h |
| G2 | `useGarminConnect.js` stub + UI（连接按钮、"等待审核"状态） | — | 🟢 低 | 1h |
| G3 | `garmin-auth` + `garmin-webhook` Edge Function（拿到 API 权限后） | Garmin 开发者审核通过 | 🟢 低 | 3h |
| C1 | `corosSync.js` sport map | — | 🟢 低 | 0.5h |
| C2 | `useCorosConnect.js` + `coros-auth` Edge Function | COROS 开发者账号 | 🟢 低 | 2h |

### 推荐执行顺序

```
D1 (DB 补表)
    ↓
S1 → S2 → S3 → S4     ← Strava 先打通（API 最成熟，投入产出比最高）
    ↓
A1 → A2                ← Apple Health 完善（代码量少）
    ↓
D2 → D3                ← Dashboard SyncBar（此时已有两个平台数据）
    ↓
G1 → G2                ← Garmin UI 占位（等 API 审核）
C1 → C2                ← COROS（等开发者账号）
    ↓
G3                     ← Garmin 真实接入（拿到权限后）
```

---

## 八、前置事项（需要你操作的）

| 事项 | 在哪里操作 | 备注 |
|------|-----------|------|
| Strava App 注册 | https://www.strava.com/settings/api | 拿 client_id + client_secret |
| Strava Webhook 验证 token | Strava API 设置 | 可随便设一个字符串 |
| COROS 开发者账号 | https://developer.coros.com/ | 填表申请，通常几天 |
| Garmin 开发者计划 | https://developer.garmin.com/gc-developer-program/ | 需要描述 app 用途，1-2 周 |
| Supabase Edge Function 环境变量 | Dashboard → Settings → Edge Functions | STRAVA_CLIENT_SECRET, COROS_CLIENT_SECRET, GARMIN_CONSUMER_SECRET |
| platform_connections 加字段（D1）| Supabase SQL Editor | 见上方 DDL |

---

## 九、测试策略

| 层 | 测试内容 | 文件 |
|----|---------|------|
| 单元 | `stravaSync.mapStravaActivity` sport map 覆盖 | `__tests__/lib/sync/stravaSync.test.js` |
| 单元 | `garminSync.mapGarminActivity` | `__tests__/lib/sync/garminSync.test.js` |
| 单元 | `corosSync.mapCorosActivity` | `__tests__/lib/sync/corosSync.test.js` |
| 单元 | `importActivity` 去重逻辑（已有 28 个测试） | `__tests__/lib/sync/importActivity.test.js` |
| 集成 | Edge Function 测试（本地 `supabase functions serve`） | 手动 curl |
| E2E | Strava → importActivity → Dashboard 显示 | 真机手动 |
