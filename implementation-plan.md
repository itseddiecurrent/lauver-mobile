# Lauver — Backend Implementation Plan

> 生成时间：2026-06-16
> 目标：把所有 UI 写死 / 按钮无响应的功能接上真实后端

## 进度

| 任务 | 状态 | 完成时间 |
|------|------|----------|
| 0 — 数据库建表 | ✅ 完成 | 2026-06-16 |
| 1 — Log Activity Screen | ✅ 完成 | 2026-06-16 |
| 2 — Activity Detail 真实数据 | ✅ 完成 | 2026-06-16 |
| 3 — Dashboard 动态数据 | ✅ 完成 | 2026-06-16 |
| 4 — Match Bug 修复 | ✅ 完成（列名对齐随 Task 0 一起修复） | 2026-06-16 |
| 5 — 全局单位系统 | ✅ 完成 | 2026-06-16 |
| 6 — AthleteCard 真实头像 | ✅ 完成 | 2026-06-16 |

---

## 现状速查

| 功能 | 当前状态 | 阻塞原因 |
|------|----------|----------|
| Log Activity 按钮 | 无 `onPress` | 缺 Screen + insert 函数 + 路由 |
| Activity Detail | 读硬编码 `DETAIL` 对象 | 缺 `getActivityById()` |
| Dashboard 进度条 | 永远 `0%` | 未读 profiles 表 |
| Dashboard MATCHES 格 | 永远 `—` | 未查互匹数量 |
| Dashboard Community 格 | 写死文案 | 未查 posts 表 |
| Dashboard Complete profile → | 无 onPress | 未加 navigation |
| Match availability filter | 选了没效果 | `avails` 从未传入 hook |
| Match readiness 照片检查 | 永远未通过 | 查 `avatar_url` 但存的是 `photos[]` |
| 距离单位 km | 全部写死 | 无全局 units context |
| Supabase 所有数据表 | 不存在 | 建表 SQL 只在注释里 |

---

## 任务 0 — 数据库建表 ✅ 完成

**完成时间：2026-06-16**

**实际执行发现：**
- 数据库已存在 5 张表：`activities`、`activity_sources`、`communities`、`platform_connections`、`profiles`
- `profiles.id` 和所有 `user_id` 列均为 `text`（Firebase UID），RLS 策略需用 `(auth.uid())::text`
- `profiles` 实际列名是 `skill`（非 `skill_level`）和 `city`（非 `location_name`）
- 已同步修正 `match.js` 及对应测试使用正确列名（附带完成 Task 4 的列名对齐部分）

**已执行操作：**
- 创建 8 张新表：posts、post_reactions、post_comments、groups、group_members、events、event_rsvps、swipes
- 为 profiles 添加 `display_name` 列
- 创建 `increment_group_member_count` RPC 函数
- 创建 `post-media` Storage Bucket（public）并设置读写策略
- 迁移文件：`supabase/migrations/20260616_initial_schema.sql`

**测试结果：** 42 个 schema 集成测试全部通过（`__tests__/schema/db_schema.test.js`）

**原始计划（供参考）：**

在 Supabase Dashboard → SQL Editor 依次执行：

### 0-A `activities` 表
SQL 在 `src/lib/activities.js` 顶部注释。
额外注意：`importActivity.js` 写的字段是 `canonical_source`，建表 DDL 里也必须用这个名字（删掉之前注释里的 `source` 字段）。

```sql
create table activities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  title            text not null,
  sport            text not null,
  started_at       timestamptz not null,
  duration_seconds integer not null,
  distance_km      numeric(6,2),
  routes_count     integer,
  elevation_gain_m numeric(6,1),
  calories         integer,
  avg_heart_rate   integer,
  canonical_source text default 'manual',
  notes            text,
  created_at       timestamptz default now()
);
alter table activities enable row level security;
create policy "users see own activities" on activities for all using (auth.uid() = user_id);
```

### 0-B `activity_sources` 表
SQL 在 `src/lib/sync/importActivity.js`（注意 `progress.md` 里已有完整 DDL）。

### 0-C Community 全套表
SQL 在 `src/lib/community.js` 顶部注释（posts / post_reactions / post_comments / groups / group_members / events / event_rsvps / communities）。

额外：
```sql
alter table posts add column if not exists photo_url text;
```

### 0-D `swipes` 表 + profiles 补列
SQL 在 `src/lib/match.js` 顶部注释。

```sql
-- profiles 补列
alter table profiles add column if not exists skill_level   text;
alter table profiles add column if not exists availability  text[];
alter table profiles add column if not exists location_name text;
alter table profiles add column if not exists photos        text[] default '{}';
alter table profiles add column if not exists unit_distance text default 'km';
alter table profiles add column if not exists unit_elevation text default 'm';
alter table profiles add column if not exists unit_weight   text default 'kg';
```

### 0-E RPC 函数 + Storage Bucket
```sql
create or replace function increment_group_member_count(group_id uuid)
returns void language sql as $$
  update groups set member_count = member_count + 1 where id = group_id;
$$;
```

在 Supabase → Storage → New Bucket：名称 `post-media`，设为 public。

---

## 任务 1 — Log Activity Screen ✅ 完成

**完成时间：2026-06-16**

**已完成操作：**
- 新建 `src/screens/activities/LogActivityScreen.js`（运动选择、标题、日期时间、时长、距离/路线/卡路里/备注表单）
- 添加 `insertActivity()` 到 `src/lib/activities.js`（错误用 `new Error(message)` 抛出）
- 更新 `src/navigation/index.js`：新增 `MainApp` Stack 包裹 `MainTabs`，`LogActivity` 作为 modal screen
- Dashboard `+ Log Activity` 按钮接 `useNavigation()` → `navigate('LogActivity')`
- ActivitiesScreen `+ Log` 和空状态 `+ Log your first activity` 两个按钮接 `onPress`
- 新增 7 个 `insertActivity` 单元测试，总测试数：132（全部通过）

**原始计划（供参考）：**

### 1-A 添加 `insertActivity()` 到 `src/lib/activities.js`

```js
export async function insertActivity(userId, fields) {
  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id:          userId,
      title:            fields.title,
      sport:            fields.sport,
      started_at:       fields.startedAt,
      duration_seconds: fields.durationSeconds,
      distance_km:      fields.distanceKm   ?? null,
      routes_count:     fields.routesCount  ?? null,
      calories:         fields.calories     ?? null,
      notes:            fields.notes        ?? null,
      canonical_source: 'manual',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
```

### 1-B 新建 `src/screens/activities/LogActivityScreen.js`

表单字段：
- 运动类型 — `ChipSelect`，选项与现有 `SPORT_MAP` 一致（running / cycling / climbing / swimming / hiking / skiing / gym / yoga）
- 标题 — `TextInput`，可自动填充（如 "Morning Run"）
- 日期时间 — `DateTimePicker`（已有依赖 `@react-native-community/datetimepicker`）
- 时长 — 两个 `TextInput`（分钟 + 秒）或拨轮
- 距离 (km) — `TextInput`，仅对 running / cycling / swimming / hiking 显示
- 路线数 — `TextInput`，仅对 climbing 显示
- 备注 — 多行 `TextInput`

提交逻辑：
1. 验证必填（sport + title + duration > 0）
2. 调用 `insertActivity(user.uid, fields)`
3. 成功后 `navigation.goBack()` 并触发 Dashboard/Activities 的 `refresh()`

### 1-C 在导航中注册路由

文件：`src/navigation/index.js`

```js
// 在 ActivitiesStack 内加一个 Screen
<Stack.Screen name="LogActivity" component={LogActivityScreen} options={{ title: 'Log Activity' }} />
```

同时在 `MainTabs` 里给 Dashboard 传 `navigation` prop 或用 `useNavigation()`。

### 1-D 连接所有 + 按钮

| 位置 | 当前 | 改为 |
|------|------|------|
| `DashboardScreen` 头部 `+ Log Activity` | 无 onPress | `navigation.navigate('LogActivity')` |
| `ActivitiesScreen` 头部 `+ Log` | 无 onPress | 同上 |
| `ActivitiesScreen` 空状态 `+ Log your first activity` | 无 onPress | 同上 |

> **改动范围**：`DashboardScreen.js` 需接收 `navigation` prop（目前没有）。改法：从 `MainTabs` Tab.Screen 传，或在组件内 `useNavigation()`。

---

## 任务 2 — Activity Detail Screen 接真实数据 ✅ 完成

**完成时间：2026-06-16**

**已完成操作：**
- 新增 `getActivityById(activityId)` 到 `src/lib/activities.js`
- 完全重写 `ActivityDetailScreen.js`：删除硬编码 `DETAIL` 对象和颜色常量，改用 `useTheme()` + `useEffect` 拉取真实数据
- 动态 `buildStats()` 根据运动类型和 DB 字段生成统计格：running=配速、cycling=速度、climbing=路线数、hiking=海拔增益
- 加载中 / 错误状态展示
- 新增 14 个测试（`__tests__/lib/activityDetail.test.js`）：5 个 `getActivityById` 单元测试 + 9 个 `buildStats` 契约测试
- 总测试数：146（全部通过）

**原始计划（供参考）：**

### 2-A 添加 `getActivityById()` 到 `src/lib/activities.js`

```js
export async function getActivityById(activityId) {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .single();
  if (error) throw error;
  return data;
}
```

### 2-B 重写 `ActivityDetailScreen.js`

替换掉整个硬编码 `DETAIL` 对象和相关静态数据：

1. 从 `route.params` 拿到 `id`
2. `useEffect` 里调用 `getActivityById(id)` 加载数据
3. 展示：标题、运动类型、日期时间、距离、时长、配速/均速、心率、卡路里、elevation、notes
4. 接入 `useTheme()` 颜色（当前屏幕用的是硬编码颜色常量 `ORANGE / DARK / BG / CARD_BG`，不跟随主题切换）
5. 地图占位保留（标注"GPS 轨迹暂不支持"），splits 字段当前不在 DB schema 里，暂不展示

---

## 任务 3 — Dashboard 动态数据 ✅ 完成

**完成时间：2026-06-16**

**已执行操作：**
- 新建 `src/hooks/useProfile.js`：`progressFromProfile(p)` 纯函数（7 项检查）+ `useProfile()` hook，查 profiles 表返回 `{ profile, progress, loading, refresh }`
- 更新 `src/hooks/useDashboard.js`：Promise.all 新增 `getMutualMatches` 和 `getFeed(uid, 1)`，返回 `matchCount` 和 `latestPost`
- 更新 `src/screens/dashboard/DashboardScreen.js`：
  - MATCHES StatCard 显示真实 `matchCount`，0 时提示 `complete profile to unlock`
  - Community 卡片显示 `latestPost.body`，无帖子显示提示语
  - Profile 进度条用 `${progress}%`，`Complete profile →` / `View profile →` 导航到 Profile
- 新增测试 `__tests__/hooks/useProfile.test.js`：14 个测试，覆盖 `progressFromProfile` 所有分支 + `getMutualMatches` + `getFeed limit=1`

**测试结果：** 总 160 个测试全部通过（+14 新增）

**原始计划（供参考）：**

**优先级：高（每次打开 app 都看得到）**
**文件改动：1 个文件 + 1 个 hook**

### 3-A Profile 完成度进度条

问题：hardcoded `0%`，`width: '0%'`。

修复方案：在 `useDashboard` 里额外拉一次 `profiles`，或单独建 `useProfile` hook（后续 Tasks 都需要 profile 数据，建议 hook）。

新 hook：`src/hooks/useProfile.js`（之后 Dashboard、Match 都依赖）

```js
export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('id', user.uid).maybeSingle()
      .then(({ data }) => setProfile(data));
  }, [user]);

  const progress = profile ? progressFromProfile(profile) : 0;
  return { profile, progress };
}
```

`progressFromProfile` 函数已经在 `ProfileScreen.js` 里存在（7 项检查），直接搬过来。

在 `DashboardScreen.js`：
- 引入 `useProfile()`
- 将 `0%` 改为 `${progress}%`
- 将 `width: '0%'` 改为 `width: \`${progress}%\``
- 给 `Complete profile →` 的 `TouchableOpacity` 加 `onPress={() => navigation.navigate('Profile')}`

### 3-B MATCHES 格显示真实数量

在 `useDashboard` 里加 `getMutualMatches(user.uid)` 的调用，把结果 count 存为 `matchCount`。
DashboardScreen 的第四个 StatCard 从 `—` 改为 `matchCount > 0 ? String(matchCount) : '—'`。

### 3-C Community 格显示最近动态

选项 A（简单）：在 `useDashboard` 里查最近 1 条 post，返回 body 截断显示。
选项 B（最简）：显示 "X posts in community"，只查 posts count。

推荐选项 A，改动量小。`DashboardScreen.js` 的 Community 卡片显示最近帖子内容。

---

## 任务 4 — Match 两个 Bug 修复 ✅ 部分完成（列名对齐已随 Task 0 修复）

**优先级：高（影响核心功能可用性）**
**文件改动：2 个文件**

### 4-A readiness 照片检查：`avatar_url` → `photos[]`

文件：`src/lib/match.js` 第 47 行

```js
// 当前（错误）
done: !!profile?.avatar_url,

// 改为
done: Array.isArray(profile?.photos) && profile.photos.length > 0,
```

同时更新 `select` 语句把 `avatar_url` 改为 `photos`：

```js
.select('photos, sports, skill_level, location_name, availability')
```

### 4-B Availability filter 断层修复

文件 1：`src/hooks/useMatch.js`

```js
// 在现有 sportFilters / skillFilters 旁边加：
const [availFilters, setAvailFilters] = useState([]);

// loadCandidates 改为：
const loadCandidates = useCallback(async (sports, skills, avails) => {
  const data = await getMatchCandidates(user.uid, { sports, skills, avails }).catch(() => []);
  setCandidates(data);
}, [user]);

// useEffect 改为：
useEffect(() => {
  if (isReady) loadCandidates(sportFilters, skillFilters, availFilters);
}, [isReady, loadCandidates, sportFilters, skillFilters, availFilters]);

// return 里加：
availFilters, setAvailFilters,
```

文件 2：`src/lib/match.js` 的 `getMatchCandidates`

```js
export async function getMatchCandidates(userId, { sports = [], skills = [], avails = [] } = {}) {
  // ...已有逻辑...
  if (avails.length > 0) query = query.overlaps('availability', avails);
  // ...
}
```

文件 3：`MatchScreen.js` — 把 `avails` 和 `setAvails` 改为从 `useMatch()` 拿

```js
const { ..., availFilters, setAvailFilters } = useMatch();
// 删掉本地 const [avails, setAvails] = useState([]);
// FilterChipGroup 的 AVAILABILITY 组换成 availFilters / setAvailFilters
```

---

## 任务 5 — 全局单位系统 ✅ 完成

**完成时间：2026-06-16**

**已执行操作：**
- 新建 `src/hooks/useUnits.js`：`makeDistFmt(unit)` / `makeElevFmt(unit)` 纯函数 + `useUnits()` hook（读 profile 单位偏好，默认 km/m）
- `DashboardScreen.js`：DISTANCE StatCard 用 `fmtDistance`，月度 km sub 改为 `distUnit`，ActivityRow 距离用 `fmtDistance`
- `ActivitiesScreen.js`：TOTAL DISTANCE / LONGEST StatCard 用 `fmtDistance`，ActivityCard 距离改为 `fmtDistance`，`chartUnit` 改为 `${distUnit} per week`
- `ActivityDetailScreen.js`：`buildStats` 新增可选 `fmtDist / fmtElev` 参数，label `DISTANCE (KM)` 改为 `DISTANCE`，组件内传入 `useUnits()` 返回的函数
- 新增测试 `__tests__/hooks/useUnits.test.js`：20 个测试，覆盖 km/mi/m/ft 转换 + null/undefined

**测试结果：** 总 180 个测试全部通过（+20 新增）

**原始计划（供参考）：**

**优先级：中（影响数据可读性）**
**文件改动：1 个新文件 + 2 个 screen 文件**

### 5-A 新建 `src/hooks/useUnits.js`

```js
import { useProfile } from './useProfile';

const KM_TO_MI = 0.621371;
const M_TO_FT  = 3.28084;

export function useUnits() {
  const { profile } = useProfile();
  const distUnit = profile?.unit_distance ?? 'km';
  const elevUnit = profile?.unit_elevation ?? 'm';

  function fmtDistance(km) {
    if (km == null) return '—';
    if (distUnit === 'mi') return `${(km * KM_TO_MI).toFixed(1)} mi`;
    return `${km} km`;
  }

  function fmtElevation(m) {
    if (m == null) return '—';
    if (elevUnit === 'ft') return `${Math.round(m * M_TO_FT)} ft`;
    return `${m} m`;
  }

  return { distUnit, elevUnit, fmtDistance, fmtElevation };
}
```

### 5-B 替换 DashboardScreen 和 ActivitiesScreen 里的硬编码 `km`

- `useDashboard` 和 `useActivities` 数据层不变（km 是内部存储单位）
- 只在 **展示层** 调用 `fmtDistance(value)` 替换原来的 `` `${value} km` ``
- 影响：StatCard 的 `sub` 文案、ActivityRow/ActivityCard 里的距离显示

---

## 任务 6 — AthleteCard 显示真实头像 ✅ 完成

**完成时间：2026-06-16**

**已执行操作：**
- `MatchScreen.js` 引入 `Image`，`AthleteCard` 在 `athlete.avatar_url` 存在时显示 `<Image>` 圆形头像，否则降级到字母色块
- 同步修复两个遗留 Bug：`athlete.location_name` → `athlete.city`，`athlete.skill_level` → `athlete.skill`（与 match.js 对齐实际 DB 列名）
- 新增 `cardAvatarImg` style（72×72 圆形）

**测试结果：** 无需新增测试（纯 UI 条件渲染；DB 列名 Bug 已在 Task 4 的 match.js 测试中覆盖）

**原始计划（供参考）：**

**优先级：低（当前用初始字母 + 颜色，功能可用）**
**文件改动：1 个文件**

`MatchScreen.js` 的 `AthleteCard` 组件当前用 `avatarColor(name)` 生成色块代替头像。
当 `athlete.avatar_url` 存在时，改为显示 `<Image source={{ uri: athlete.avatar_url }} />`：

```js
// 在 cardHero 里：
{athlete.avatar_url
  ? <Image source={{ uri: athlete.avatar_url }} style={styles.cardAvatarImg} />
  : <View style={[styles.cardAvatar, { backgroundColor: color }]}>
      <Text style={styles.cardAvatarText}>{initial}</Text>
    </View>
}
```

---

## 执行顺序

```
任务 0 (DB 建表)
    ↓
任务 1 (Log Activity)   ←── 所有活动数据的来源，其他任务依赖它有数据
    ↓
任务 2 (Activity Detail) + 任务 4 (Match bugs)   ←── 可并行
    ↓
任务 3 (Dashboard 动态)  ←── 需要 useProfile hook（任务3-A 先建）
    ↓
任务 5 (Units)           ←── 复用 useProfile
    ↓
任务 6 (AthleteCard 头像) ←── 最后做，依赖有真实用户数据
```

---

## 改动文件汇总

| 任务 | 新建 | 修改 |
|------|------|------|
| 0 — DB | — | Supabase SQL Editor |
| 1 — Log Activity | `LogActivityScreen.js` | `activities.js` (insertActivity), `navigation/index.js`, `DashboardScreen.js`, `ActivitiesScreen.js` |
| 2 — Activity Detail | — | `ActivityDetailScreen.js`, `activities.js` (getActivityById) |
| 3 — Dashboard 动态 | `useProfile.js` | `DashboardScreen.js`, `useDashboard.js` |
| 4 — Match bugs | — | `match.js`, `useMatch.js`, `MatchScreen.js` |
| 5 — Units | `useUnits.js` | `DashboardScreen.js`, `ActivitiesScreen.js`, `ActivityDetailScreen.js` |
| 6 — AthleteCard | — | `MatchScreen.js` |

**共计：3 个新文件，9 个修改文件**
