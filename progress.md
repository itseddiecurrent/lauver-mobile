# Lauver — 产品进度文档

> 最后更新：2026-05-20

---

## 这是什么 App？

**Lauver** 是一款面向运动爱好者的 AI 驱动社交 + 运动追踪移动应用（iOS / Android）。

核心定位：**帮助运动员找到与自己配速、日程、运动类型都匹配的训练伙伴。**

类比理解：「运动版 Tinder + Strava 的结合体」，但用 AI 做匹配，而不是纯地理距离。

---

## 技术架构详解

### 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                   React Native App                   │
│              (Expo SDK 54, New Architecture)          │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │Navigation│  │  Screens │  │  Custom Hooks    │   │
│  │(RN Nav)  │  │(5 tabs + │  │ useAuth          │   │
│  │Stack +   │  │ Landing) │  │ useDashboard     │   │
│  │BottomTab │  │          │  │ useActivities    │   │
│  └──────────┘  └──────────┘  │ useMatch         │   │
│                               │ useCommunity     │   │
│  ┌──────────────────────┐    │ useStravaConnect  │   │
│  │   ThemeContext       │    │ useAppleHealth    │   │
│  │ (Light/Dark tokens)  │    └──────────────────┘   │
│  └──────────────────────┘                            │
└───────────────┬─────────────────────┬────────────────┘
                │                     │
       ┌────────▼──────┐    ┌─────────▼────────┐
       │  Firebase     │    │    Supabase       │
       │  (Auth only)  │    │ (DB + Storage +   │
       │               │    │  Edge Functions)  │
       └───────────────┘    └──────────────────┘
```

---

### 1. 运行时 & 框架层

#### Expo SDK 54 (React Native 0.81.5, React 19)
- **新架构已开启**：`newArchEnabled: true`，使用 JSI 桥接，性能更好
- **Expo Go 兼容**：基础功能可用 Expo Go 扫码调试；Apple Health 等原生模块需要 `expo-dev-client` 构建的 dev build
- 入口：`index.js` → `App.js` → `ThemeProvider` → `RootNavigator`

---

### 2. 导航层（React Navigation 7）

文件：`src/navigation/index.js`

```
RootNavigator (Stack, headerShown: false, animation: 'fade')
├── Login  → LoginScreen           # 未登录时
└── Main   → MainTabs (BottomTab)  # 已登录时
    ├── Dashboard   → DashboardScreen       (headerShown: false)
    ├── Activities  → ActivitiesStack       (headerShown: false)
    │   ├── ActivitiesList → ActivitiesScreen
    │   └── ActivityDetail → ActivityDetailScreen
    ├── Community   → CommunityScreen
    ├── Match       → MatchScreen
    └── Profile     → ProfileScreen
```

- **认证门控**：`useAuth()` 监听 Firebase `onAuthStateChanged`，返回 `{ user, loading }`，Navigator 根据此决定渲染哪棵 Stack
- **主题适配**：`NavigationContainer` 传入动态 `theme` 对象，让系统 Header / TabBar 颜色跟随 ThemeContext

---

### 3. 认证层（Firebase Auth + Supabase 双 session）

文件：`src/lib/firebase.js`、`src/lib/supabase.js`、`src/hooks/useAuth.js`

#### 为什么用两个认证服务？

Firebase 负责用户认证（注册/登录/注销），Supabase 负责数据库和文件存储，Supabase 的行级安全策略（RLS）需要知道当前用户 UID，所以必须保持两者 session 同步。

#### 认证流程

```
用户登录 (Firebase Auth)
    ↓
onAuthStateChanged 触发
    ↓
firebaseUser.getIdToken()  →  获取 Firebase ID Token (JWT)
    ↓
supabase.auth.signInWithIdToken({ provider: 'firebase', token })
    ↓
Supabase 建立自己的 session，auth.uid() = Firebase UID
    ↓
两个 session 同步完成，RLS 策略生效
```

#### Firebase 配置要点
- 使用 `initializeAuth` + `getReactNativePersistence(AsyncStorage)` 做持久化
- 防止热重载时重复初始化：`getApps().length === 0` 判断

#### Supabase 客户端配置
- `storage`：自定义 `ExpoSecureStoreAdapter`（基于 `expo-secure-store`），比 AsyncStorage 更安全（存在 Keychain / Keystore）
- `detectSessionInUrl: false`：禁用 URL 深链检测，因为没有 OAuth deep-link 回调流程（Strava 用的是 Expo Auth Session 代理）
- `autoRefreshToken: true`：token 过期自动刷新

---

### 4. 数据库层（Supabase / PostgreSQL）

#### 连接方式
- 客户端直连 Supabase REST API（`@supabase/supabase-js v2`）
- 环境变量：`EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（均以 `EXPO_PUBLIC_` 前缀暴露给客户端）

#### 行级安全（RLS）
所有表都启用 RLS，策略基于 `auth.uid()`（即 Firebase UID）控制读写权限，例如：
- `profiles`：只能读写自己的行
- `swipes`：只能写自己发出的滑动，可读自己收到的（用于互匹判断）
- `activities`：只能读写自己的活动

#### 实时订阅（计划中）
Supabase 支持 `supabase.channel('posts').on('postgres_changes', ...)` 做 Feed 实时更新，Community 模块后续接入。

#### 已用 / 已规划的表

| 表名 | 状态 | 核心字段 |
|------|------|---------|
| `profiles` | 使用中（部分列待 ALTER） | id, first_name, bio, city, radius, sports[], skill, availability[], photos[], date_of_birth, unit_* |
| `activities` | 使用中 | id, user_id, sport, title, started_at, duration_seconds, distance_km, avg_heart_rate, calories, elevation_gain_m, canonical_source |
| `activity_sources` | 使用中 | activity_id, platform, external_id, raw_data |
| `platform_connections` | 使用中（Strava） | user_id, platform, meta(JSON), requires_reauth |
| `swipes` | 待建（SQL 在 match.js 注释） | user_id, target_id, action('pass'\|'like'\|'star') |
| `posts` | 待建 | user_id, body, activity_id |
| `reactions` | 待建 | post_id, user_id, emoji |
| `comments` | 待建 | post_id, user_id, body |
| `groups` | 待建 | name, icon, member_count, community_type, privacy, join_policy |
| `group_members` | 待建 | group_id, user_id |
| `events` | 待建 | name, starts_at, attendee_count |
| `event_rsvps` | 待建 | event_id, user_id |

---

### 5. 文件存储层（Supabase Storage）

- **Bucket `avatars`**：存储用户个人照片，路径格式 `{uid}/photo_{slotIndex}_{timestamp}.{ext}`
- 上传流程：`expo-image-picker` → base64 → `decode(base64)` (base64-arraybuffer) → `supabase.storage.upload()` → 取 `publicUrl`
- Profile 最多 6 张照片，URL 数组存在 `profiles.photos` 列
- 计划中：`post-media` bucket 存帖子图片

---

### 6. 后端逻辑层（Supabase Edge Functions）

文件引用：`useStravaConnect.js` 中调用 `${SUPABASE_URL}/functions/v1/strava-auth`

**已有 Edge Function：`strava-auth`**
- 接收 `{ code, userId }`
- 用 Strava client_secret（不能放客户端）向 Strava 换取 access_token + refresh_token
- 将 token 写入 Supabase `platform_connections` 表
- 返回 `{ athlete: { name } }`

**计划中的 Edge Functions：**
- `strava-sync`：用保存的 refresh_token 拉取用户最新活动，通过 `importActivity` 逻辑入库
- `send-notification`：互匹时触发推送（调用 FCM API）

---

### 7. 第三方数据同步层

文件：`src/lib/sync/importActivity.js`、`src/lib/sync/appleSync.js`、`src/hooks/useStravaConnect.js`、`src/hooks/useAppleHealthConnect.js`

#### 去重策略（importActivity.js）

同一次锻炼可能从多个平台同步进来（比如 Garmin 手表 + Apple Health 都记录了同一次跑步），通过两层去重避免重复：

```
Layer 1 — 精确匹配：
  查 activity_sources 表，platform + external_id 完全一致 → 跳过

Layer 2 — 时间指纹匹配：
  同一 sport + 开始时间在 ±5 分钟内 + 时长误差 <10% → 认定为同一活动
  → 新增一条 activity_sources 记录（多来源引用同一 activity）
  → 判断新来源优先级是否更高，若是则升级 canonical_source 并补充更精确的数据字段

优先级（高→低）：garmin > apple > strava > manual
```

#### Strava OAuth 流程

```
用户点击 Connect
    ↓
expo-auth-session useAuthRequest() → 打开 Strava 授权页（系统浏览器）
    ↓
用户授权 → 跳回 App（scheme: lauver://oauthredirect）
    ↓
获得 code
    ↓
POST /functions/v1/strava-auth  { code, userId }
    ↓
Edge Function 用 client_secret 换 token（保密在服务端）
    ↓
tokens 存入 platform_connections 表
    ↓
前端 setConnected(true)
```

#### Apple Health 权限模型

- 读取权限：Workout, HeartRate, DistanceWalkingRunning, DistanceCycling, DistanceSwimming, ActiveEnergyBurned, FlightsClimbed
- 写入权限：无（只读）
- 限制：`react-native-health` 需要 native 模块，Expo Go 不支持，必须用 `expo-dev-client` 构建
- 同步范围：最近 30 天，最多 100 条，按时间倒序
- Apple 运动类型通过 `APPLE_SPORT_MAP` 映射到 App 内部类型（running / cycling / swimming 等）

---

### 8. 主题系统

文件：`src/context/ThemeContext.js`

- 两套完整颜色 palette：`LIGHT`（暖白）和 `DARK`（暖炭黑，非冷灰）
- 持久化：用 `AsyncStorage` 存 `@lauver_theme` key，下次启动恢复
- 所有 Screen 通过 `useTheme()` 获取 `colors` 对象，传入 `makeStyles(c)` 工厂函数生成 StyleSheet
- 颜色 token 完整列表：

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| `BG` | `#F0EDE8` | `#161412` | 屏幕背景 |
| `CARD_BG` | `#EAE6DF` | `#201D1A` | 卡片背景 |
| `ELEVATED` | `#FFFFFF` | `#2C2825` | 浮层/输入框背景 |
| `TEXT` | `#1C1A18` | `#EDE9E3` | 主文字 |
| `TEXT_SUB` | `#555555` | `#B0A498` | 次级文字 |
| `TEXT_MUTED` | `#999999` | `#9A8E84` | 辅助文字 |
| `TEXT_FAINT` | `#BBBBBB` | `#5A5048` | placeholder |
| `ORANGE` | `#E8602C` | `#E8602C` | 主强调色（不变） |
| `DARK_ORANGE` | `#C04E1E` | `#F4875A` | 标题强调色 |
| `DIVIDER` | `#D9D0C7` | `#2E2A26` | 分割线 |
| `INPUT_BG` | `#FFFFFF` | `#2C2825` | 输入框背景 |
| `BAR_ACTIVE` | `#D9C9B4` | `#4A3F36` | 图表已有数据条 |
| `BAR_EMPTY` | `#E8E3DC` | `#252220` | 图表空数据条 |

---

### 9. 关键 npm 依赖清单

#### 核心运行时
| 包 | 版本 | 用途 |
|----|------|------|
| `expo` | ~54.0.33 | 基础 SDK |
| `react-native` | 0.81.5 | RN 运行时 |
| `react` | 19.1.0 | React |

#### 导航
| 包 | 用途 |
|----|------|
| `@react-navigation/native` | 导航容器 |
| `@react-navigation/native-stack` | Stack 导航 |
| `@react-navigation/bottom-tabs` | BottomTab 导航 |
| `react-native-screens` | 原生 Screen 容器（性能） |
| `react-native-safe-area-context` | 安全区域适配（刘海/底部条） |

#### 后端服务
| 包 | 用途 |
|----|------|
| `@supabase/supabase-js` | Supabase 客户端（DB + Storage + Auth） |
| `firebase` | Firebase SDK（仅用 Auth 模块） |

#### 存储 & 安全
| 包 | 用途 |
|----|------|
| `expo-secure-store` | 安全存储 Supabase session（Keychain/Keystore） |
| `@react-native-async-storage/async-storage` | Firebase session 持久化 + 主题偏好存储 |

#### OAuth & 浏览器
| 包 | 用途 |
|----|------|
| `expo-auth-session` | Strava OAuth2 PKCE 流程 |
| `expo-web-browser` | 打开系统浏览器（OAuth 授权页） |
| `expo-linking` | 处理 deep link 回调 |
| `expo-crypto` | PKCE code_verifier 生成 |

#### 媒体 & 文件
| 包 | 用途 |
|----|------|
| `expo-image-picker` | 选取/拍摄照片（Profile 图片上传） |
| `expo-file-system` | 文件读写（预留） |
| `base64-arraybuffer` | base64 转 ArrayBuffer（Supabase Storage 上传需要） |

#### UI 辅助
| 包 | 用途 |
|----|------|
| `expo-linear-gradient` | Profile 预览卡片渐变叠加层 |
| `@react-native-community/datetimepicker` | 出生日期选择器 |
| `expo-status-bar` | 状态栏颜色控制 |

#### 健康数据
| 包 | 用途 |
|----|------|
| `react-native-health` | Apple HealthKit 读取（需 dev build） |

#### 开发工具
| 包 | 用途 |
|----|------|
| `expo-dev-client` | 自定义 dev build（支持原生模块调试） |
| `@expo/ngrok` | 内网穿透（本地开发时测试 OAuth 回调） |
| `typescript` | 类型支持（devDependency） |

---

### 10. 环境变量

所有变量以 `EXPO_PUBLIC_` 前缀暴露（Expo 构建时注入，客户端可读）：

```bash
# Supabase
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_SUPABASE_ANON_KEY=        # Edge Function 调用用

# Firebase
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=

# Strava
EXPO_PUBLIC_STRAVA_CLIENT_ID=
# Strava client_secret 只存在 Supabase Edge Function 环境变量中，不在客户端
```

---

## 功能模块全景

| 模块 | 定位 | 当前状态 |
|------|------|----------|
| Landing | 品牌落地页 | 完整 |
| 登录 / 注册 | Firebase Auth | 完整 |
| Dashboard | 个人运动总览 | 完整（UI + 后端） |
| Activities | 活动记录 & 统计 | UI 完整，Log 入口待实现 |
| Activity Detail | 单次活动详情 | 仅 stub |
| Match | AI 运动员匹配 | UI 完整，后端基本可用 |
| Community | 社区动态 / 群组 / 活动 | UI 完整，部分后端待接入 |
| Profile | 个人资料 + 设置 | 完整（含图片上传、第三方连接） |
| 主题系统 | 深色 / 浅色模式 | 完整 |

---

## 已实现功能详解

### Landing Screen
- 深色 Hero 区 + 暖色调底部卡片，品牌 slogan「Find Your Pack」
- 8 种运动标签横向滚动（跑步、骑行、游泳、攀岩等）
- 3 个价值主张（Smart Matching / Local Community / Track Everything）
- 两个 CTA：「Try the App」直接进主界面 / 「Sign In」跳登录页

### 登录 / 注册
- Firebase Auth 邮箱 + 密码
- `expo-secure-store` 持久化 session
- 认证状态驱动导航：已登录 → Main Tab，未登录 → Login

### Dashboard（主页）
- 自定义 Header（Logo 左，`+ Log Activity` 按钮右）
- 2×2 统计卡片：本周活动数、本周距离(km)、活跃时长、匹配数（待解锁）
- 周活跃条形图：7 天，今日高亮橙色，从 Supabase 实时拉取
- 最近活动列表（空状态有引导文案）
- 月度汇总卡：月总活动数 + 总距离
- 资料完成进度条：0% → 100% 解锁匹配功能入口

### Activities（活动记录）
- 横向滚动统计卡（总距离、总时长、活动数）
- 距离折线图，支持 Week / Month / Year 切换
- 运动类型筛选 Chip（All / Running / Cycling 等）
- 活动列表（空状态）

### Match（运动员匹配）
- 解锁门控：资料未完成时显示 Checklist，引导完善 Profile
- 候选运动员卡片：姓名、城市、运动标签、技能等级、可用时段
- 三种操作：X Pass / ★ Star / ♥ Like
- 过滤面板：运动类型 / 技能等级 / 可用时段
- 互相 Like 的运动员显示在「Your Matches」区域
- 后端：`swipes` 表记录滑动，`getMutualMatches` 查询互匹

### Community（社区）
- 发帖 Compose Box（Photo / Route / Activity / Goal 附件按钮，UI 已有）
- 帖子 Feed：帖子卡含作者头像、正文、附加活动、Reaction 表情、评论 / 分享入口
- 推荐群组列表（Join 按钮）
- 附近运动员区域（需位置权限，当前为空状态）
- 即将举办的活动列表（RSVP 按钮，已 / 未报名状态切换）
- 「创建社区」弹窗：名称、联系人、创始人、位置、简介、类型（线下/线上/混合）、隐私（公开/私密）、加入方式（开放/审核/邀请）、标签

### Profile（个人资料）
- 照片网格：最多 6 张，首张为主照，支持排序（点击选中后点击目标位置互换）、删除，上传至 Supabase Storage
- 资料完整度进度条（7 项：账户 / 邮箱 / 照片 / 运动 / 城市 / 简介 / 可用时间）
- 基本信息：名字、出生日期（设置后锁定）、年龄（自动计算）、简介
- 位置与时间：城市、搜索半径（5/10/25/50 km）、可用时段多选
- 运动 & 技能：多选运动、技能等级、寻找目标（训练伙伴/群组/跑步伙伴/教练）
- 资料预览 Modal：完全模拟匹配卡片效果（渐变叠加、运动标签、技能徽章）
- Settings Modal：
  - 深色 / 浅色模式切换
  - 单位设置（距离：km/mi，海拔：m/ft，体重：kg/lb）
  - 第三方连接：Apple Health（需 dev build）/ Garmin（UI mock）/ Strava（OAuth）
- 退出登录

### 第三方同步（框架已搭）
- **Strava**：`expo-auth-session` OAuth2，连接 / 断开 / 重连检测
- **Apple Health**：`react-native-health`，需 dev build，读取运动数据框架已有
- **Garmin**：UI 展示已有，逻辑待实现

### 主题系统
- `ThemeContext` 支持深色 / 浅色两套颜色 token
- 所有 Screen 使用 `makeStyles(colors)` 工厂函数动态生成样式

---

## 部分实现的功能（代码已有但尚不能运行）

这些功能不是空白，而是前后端代码都已写好，但卡在某一个环节（通常是数据库表未建、某个 API 密钥未配、或逻辑存在断层）。

---

### 1. Community 社区 — 后端完整，数据库未建

**已实现的代码**

`src/lib/community.js` 包含完整的 Supabase 查询函数：

| 函数 | 功能 | 状态 |
|------|------|------|
| `getFeed(userId)` | 拉取帖子列表，含作者信息、附加活动、reaction 汇总、评论数 | 完整 |
| `createPost(userId, body, activityId?, photoUrl?)` | 发新帖，可附加活动或图片 | 完整 |
| `toggleReaction(userId, postId, emoji)` | 添加/取消 reaction，幂等操作 | 完整 |
| `getSuggestedGroups(userId)` | 查询用户未加入的群组，按成员数排序 | 完整 |
| `joinGroup(userId, groupId)` | 加入群组 + 调用 RPC 递增 member_count | 完整 |
| `getUpcomingEvents(userId)` | 查询未来活动，标注用户是否已 RSVP | 完整 |
| `toggleRsvp(userId, eventId)` | 报名/取消报名，幂等操作 | 完整 |
| `createCommunity(fields)` | 创建新社区（完整字段） | 完整 |
| `getComments(postId)` | 获取帖子评论列表（按时间升序） | 完整 |
| `createComment(userId, postId, body)` | 发表评论，返回含作者信息的新行 | 完整 |
| `deleteComment(userId, commentId)` | 删除自己的评论（RLS 保护） | 完整 |

`src/hooks/useCommunity.js` 已实现：
- 乐观更新：Reaction / 加入群组 / RSVP 本地先改 state，后台异步写 DB
- 评论数同步：`handleAddComment` / `handleDeleteComment` 在评论增删时更新帖子列表的 `commentCount`
- **实时订阅**：`supabase.channel('community-posts')` 监听 `posts` 表 INSERT 事件，自动刷新 Feed

`src/screens/community/CommunityScreen.js` 已实现：
- **CommentsModal**：点击"X comments"打开，FlatList 展示评论，底部 KeyboardAvoidingView 输入框，支持发表和删除自己的评论
- **ActivityPickerModal**：从用户活动列表选择附加到帖子（FlatList + 运动 emoji）
- **图片附件**：Photo 按钮调用 `expo-image-picker`，上传到 Supabase `post-media` bucket，附件 chip 显示在 compose 区域
- 附件预览 chip：可独立移除活动或图片附件

**卡在哪里（仅剩数据库层）**

1. 所有 SQL 建表语句写在 `community.js` 顶部注释里，**需要在 Supabase SQL 编辑器中手动执行**
2. `joinGroup` 调用 `supabase.rpc('increment_group_member_count', ...)` — 需要单独创建：
   ```sql
   create or replace function increment_group_member_count(group_id uuid)
   returns void language sql as $$
     update groups set member_count = member_count + 1 where id = group_id;
   $$;
   ```
3. 图片附件需要在 Supabase Storage 创建 `post-media` bucket（公开读取），并对 `posts` 表执行：
   ```sql
   alter table posts add column if not exists photo_url text;
   ```

---

### 2. Match 匹配 — 逻辑完整，数据库未建 + 过滤器断层

**已实现的代码**

`src/lib/match.js` 实现了完整的匹配查询逻辑：
- `getMatchReadiness(user)`：查 Profile，检查 avatar_url / sports / skill_level / location_name / availability 是否填完
- `getMatchCandidates(userId, { sports, skills })`：排除自己和已滑动的人，支持 `sports` 数组重叠过滤和 `skill_level` 过滤，返回最多 20 个候选人
- `recordSwipe(userId, targetId, action)`：写 `swipes` 表，`upsert` 保证幂等
- `getMutualMatches(userId)`：两次查询取交集——自己 like/star 的人里，也 like/star 了自己的

`src/hooks/useMatch.js` 滑动后**立即从本地列表移除候选人**，异步写 DB，like/star 后异步刷新互匹列表。

**卡在哪里**

1. **`swipes` 表未建**，SQL 在 `src/lib/match.js` 顶部注释，需手动执行：
   ```sql
   create table swipes (
     id         uuid primary key default gen_random_uuid(),
     user_id    uuid references profiles(id) on delete cascade not null,
     target_id  uuid references profiles(id) on delete cascade not null,
     action     text not null,
     created_at timestamptz default now(),
     unique (user_id, target_id)
   );
   alter table swipes enable row level security;
   create policy "users manage own swipes" on swipes
     for all using (auth.uid() = user_id);
   create policy "swipes readable for matches" on swipes
     for select using (auth.uid() = user_id or auth.uid() = target_id);
   ```

2. **可用时段过滤器（Availability）存在断层**：
   - `MatchScreen.js` 有 `avails` state 和 `FilterChipGroup` UI
   - 但 `avails` **从未传入** `useMatch` hook，`loadCandidates` 只用了 `sportFilters` 和 `skillFilters`
   - 需要在 `useMatch` 中新增 `availFilters` state，并在 `getMatchCandidates` 查询里加 `.overlaps('availability', avails)`

3. **avatar_url vs photos[] 字段不一致**：
   - `getMatchReadiness` 检查 `profile.avatar_url` 是否存在来判断「有照片」
   - 但 `ProfileScreen` 保存的是 `photos[]` 数组（Supabase Storage URL），并不写 `avatar_url`
   - 结果：用户上传了照片，匹配门控仍显示「Profile photo uploaded」未完成
   - 修复：`getMatchReadiness` 改为检查 `photos?.length > 0`，或在保存时把 `photos[0]` 同步写入 `avatar_url`

4. **`user.id` vs `user.uid` bug（已修复）**：`useAuth()` 返回 Firebase User 对象，正确字段是 `.uid` 而非 `.id`。已全局修复 `useDashboard`、`useActivities`、`useMatch`、`useCommunity`、`lib/match.js`。

5. **Profile 列缺失**：`profiles` 表需要补充这些列（SQL 在 match.js 注释中）：
   ```sql
   alter table profiles add column if not exists skill_level   text;
   alter table profiles add column if not exists availability  text[];
   alter table profiles add column if not exists location_name text;
   ```

---

### 3. Activities 数据层 — 查询完整，数据库未建 + 无写入入口

**已实现的代码**

`src/lib/activities.js` 实现了所有查询函数：

| 函数 | 功能 |
|------|------|
| `getWeekStats(userId)` | 本周（Mon-Sun）活动数、总距离、总时长 |
| `getWeeklyChart(userId)` | 周图 7 个桶（每天分钟数） |
| `getRecentActivities(userId, limit)` | 最近 N 条活动 |
| `getAllTimeStats(userId)` | 全时段：总数、总距离、最长单次、最佳配速（跑步） |
| `getDistanceChartData(userId, period)` | 距离图：Month(4周) / 3 Months(12周) / Year(12月) |
| `getActivitiesList(userId, sport?)` | 全部活动列表，可按运动类型筛选 |
| `getMonthStats(userId)` | 本月活动数 + 总距离 |

**卡在哪里**

1. **`activities` 表未建**，SQL 在 `activities.js` 顶部注释，需手动执行（含 RLS 策略）

2. **没有写入入口**：7 个查询函数都有，但没有 INSERT 函数，也没有 LogActivity 页面。数据库是空的，所有统计卡都显示 0

3. **`activity_sources` 表未建**：`importActivity.js` 依赖这张表做去重，但建表 SQL 不在现有注释里，需要自行补充：
   ```sql
   create table activity_sources (
     id          uuid primary key default gen_random_uuid(),
     activity_id uuid references activities(id) on delete cascade not null,
     platform    text not null,
     external_id text not null,
     raw_data    jsonb,
     created_at  timestamptz default now(),
     unique (platform, external_id)
   );
   ```

4. **字段不一致**：`activities.js` 建表 DDL 里有 `source text`，但 `importActivity.js` 写入的是 `canonical_source text`，两者字段名不同，需统一

---

### 4. Strava 同步 — OAuth 完整，活动同步未实现

**已实现的代码**

- `useStravaConnect.js`：完整的 OAuth2 PKCE 授权流程，支持连接/断开/重连检测
- 授权后 access_token + refresh_token 存入 Supabase `platform_connections` 表（通过 Edge Function）
- `platform_connections` 表已在 hook 中被读取（检查连接状态和 `requires_reauth`）

**卡在哪里**

1. **Edge Function `strava-auth` 需要部署**到 Supabase，并在 Supabase Dashboard 设置 `STRAVA_CLIENT_SECRET` 环境变量（这个 secret 不能放客户端）

2. **连接之后没有同步**：OAuth 成功只是存了 token，没有拉取历史活动。需要一个 `strava-sync` Edge Function（或定时任务）：
   - 读取 `platform_connections` 里的 refresh_token
   - 调用 Strava API 拉取活动列表
   - 逐条调用 `importActivity()` 入库

3. **redirect URI 配置**：`makeRedirectUri({ scheme: 'lauver', path: 'oauthredirect' })` 生成的 URI 必须在 Strava 开发者后台手动注册，本地开发和生产的 URI 不同

---

### 5. Apple Health 同步 — 逻辑完整，运行环境受限

**已实现的代码**

- `useAppleHealthConnect.js`：请求 HealthKit 权限、读取最近 30 天最多 100 条 Workout 记录、调用 `syncAppleHealth`
- `src/lib/sync/appleSync.js`：将 Apple HKWorkoutActivityType 映射到 App 内部运动类型，调用 `importActivity` 入库
- 读取权限：Workout / HeartRate / DistanceWalkingRunning / DistanceCycling / DistanceSwimming / ActiveEnergyBurned / FlightsClimbed

**卡在哪里**

1. **Expo Go 不支持**：`react-native-health` 是原生模块，在 Expo Go 中 `require` 会被 catch 掉，`available` 为 false，按钮显示「Requires dev build」
2. **需要 `expo-dev-client` 构建**：`npx expo run:ios` 或通过 EAS Build 生成 dev build
3. **`app.json` 需要添加 HealthKit 权限说明**（`NSHealthShareUsageDescription`），否则 App Store 审核会拒绝
4. 同上，依赖 `activity_sources` 表存在

---

### 6. 单位设置 — 已保存到 DB，未在展示层生效

**已实现的代码**

- `ProfileScreen` Settings Modal 中有完整的 km/mi、m/ft、kg/lb 切换 UI
- 用户偏好保存到 Supabase `profiles` 表的 `unit_distance`、`unit_elevation`、`unit_weight` 列
- 保存逻辑在 `handleSave()` 中，与整体 Profile 一起 upsert

**卡在哪里**

- `DashboardScreen`、`ActivitiesScreen` 中所有距离单位均**硬编码为「km」**
- 没有全局的单位 Context 或 hook，各 Screen 无法读取用户偏好
- 数字换算（1 km = 0.621371 mi）也尚未实现

---

## 待实现功能 & 具体实现步骤

### 1. 活动记录（Log Activity）— 最高优先级

**问题**：Dashboard 的「+ Log Activity」按钮当前无任何操作。

**实现步骤**：

1. 新建 `src/screens/activities/LogActivityScreen.js`
   - 表单字段：运动类型（Chip 选择）、标题、距离、时长（分:秒 picker）、日期时间、备注
   - 提交后写入 Supabase `activities` 表（`src/lib/activities.js` 已有 insert 函数框架）
2. 在 `ActivitiesStack`（`src/navigation/index.js`）中注册 `LogActivity` 路由
3. 将 Dashboard Header 的 `+ Log Activity` 按钮 `onPress` 改为 `navigation.navigate('LogActivity')`
4. 同步更新 Dashboard 和 Activities 的数据 hook，在写入后刷新统计

**可选增强**：
- 从 Apple Health 一键导入最近一次锻炼
- 从 Strava 拉取最新活动并预填表单

---

### 2. Activity Detail Screen — 高优先级

**问题**：`ActivityDetailScreen.js` 当前是空 stub，活动列表点击没有内容。

**实现步骤**：

1. 补全 `ActivityDetailScreen.js`，从路由 params 或 Supabase 加载单条活动数据
2. 展示内容：
   - 顶部 Hero：运动类型、标题、日期时间
   - 核心数据：距离、时长、均速/配速、海拔
   - 心率区间（如有）、卡路里（如有）
   - 地图轨迹（如有 GPS 数据，用 `react-native-maps`）
   - 配速/心率折线图（可用 Victory Native 或手绘 SVG）
3. 添加「分享到社区」按钮，跳转 Community compose 并预附加该活动

---

### 3. 社区 Feed 后端接入 — 高优先级

**问题**：帖子 Feed 当前为空状态，数据层 hook 骨架已在 `src/hooks/useCommunity.js` 中，但 Supabase 表结构未建齐。

**实现步骤**：

1. Supabase 建表：
   ```sql
   create table posts (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid references profiles(id) on delete cascade,
     body        text not null,
     activity_id uuid references activities(id),
     created_at  timestamptz default now()
   );
   create table reactions (
     id       uuid primary key default gen_random_uuid(),
     post_id  uuid references posts(id) on delete cascade,
     user_id  uuid references profiles(id) on delete cascade,
     emoji    text not null,
     unique (post_id, user_id, emoji)
   );
   create table comments (
     id         uuid primary key default gen_random_uuid(),
     post_id    uuid references posts(id) on delete cascade,
     user_id    uuid references profiles(id) on delete cascade,
     body       text not null,
     created_at timestamptz default now()
   );
   ```
2. 完善 `src/lib/community.js` 中的 `fetchPosts`、`createPost`、`toggleReaction`
3. 在 `useCommunity` hook 中接入实时订阅（`supabase.channel`）实现 Feed 实时更新
4. 实现评论页面（新 Screen 或底部弹窗）

---

### 4. 帖子附件（Photo / Route / Activity）— 中优先级

**问题**：Compose Box 的 Photo / Route / Activity / Goal 按钮点击无响应。

**实现步骤**：

1. **Photo**：调用 `expo-image-picker`，上传至 Supabase Storage `post-media` bucket，帖子存储 URL
2. **Activity**：弹出当前用户活动列表，选中后附加 `activity_id` 到帖子
3. **Route / Goal**：设计数据结构后实现（可作为 v2 功能）

---

### 5. 附近运动员（Community - Nearby Athletes）— 中优先级

**问题**：点击「Enable Location」无实际效果。

**实现步骤**：

1. 安装 `expo-location`，请求 `foregroundPermissionsAsync`
2. 获取坐标后，写入用户 profile 的 `lat` / `lng` 字段（Supabase）
3. 用 PostGIS 的 `ST_DWithin` 或手动计算球面距离，查询附近用户
4. 渲染附近运动员卡片列表，点击可进入其公开 Profile 页

---

### 6. Garmin 集成 — 中优先级

**问题**：Settings 中 Garmin Connect 仅为 UI mock，按钮点击只改变本地 state。

**实现步骤**：

1. 调研 Garmin Health API（需申请开发者账号）或 Garmin Connect IQ SDK
2. 实现 OAuth2 授权流程（同 Strava 的 `useStravaConnect` 模式）
3. 拉取历史活动数据，通过 `src/lib/sync/importActivity.js` 统一入库

---

### 7. 完善 Match 功能 — 中优先级

**当前问题**：
- Supabase `swipes` 表和 Profile 列需要手动建（注释中已有 SQL）
- 可用时段过滤（Availability filter）只改 UI state，未传入查询
- 无推送通知（互匹时无提醒）

**实现步骤**：

1. 执行 `src/lib/match.js` 顶部注释中的 SQL 建表语句
2. 将 `avails`（可用时段）filter 传入 `getMatchCandidates`，在 Supabase 查询中加 `overlaps('availability', avails)`
3. 互匹时通过 Expo Notifications 发送本地推送（或接入 FCM）
4. 在 Match 卡片加入距离信息（依赖 Nearby Athletes 的位置数据）

---

### 8. 推送通知 — 低优先级

- 新匹配、新评论、新活动邀请等场景
- 使用 `expo-notifications` + Firebase Cloud Messaging (FCM)
- 在 Supabase 存储 push token，后端 trigger 发送

---

### 9. 单位换算全局生效 — 低优先级

**问题**：Profile Settings 中已有 km/mi、m/ft、kg/lb 切换，但其他 Screen（Dashboard、Activities）的数据展示仍硬编码为 km。

**实现步骤**：

1. 将单位 preference 从 Profile screen 本地 state 提升到全局 Context 或从 Supabase profile 实时读取
2. 创建 `useUnits()` hook，暴露 `fmtDistance(km)`、`fmtElevation(m)` 等格式化函数
3. 替换各 Screen 中硬编码的单位字符串

---

### 10. Apple Health 真实同步 — 低优先级（需 dev build）

**问题**：`useAppleHealthConnect.js` 框架已有，但 `react-native-health` 需要 native dev build（Expo Go 不支持）。

**实现步骤**：

1. 配置 `app.json` 的 `NSHealthShareUsageDescription` 权限说明
2. 用 `expo-dev-client` 构建 dev build 后测试
3. 在 `src/lib/sync/appleSync.js` 中实现 `syncAppleWorkouts()`，读取近期锻炼写入 Supabase

---

## 数据库表结构概览（Supabase）

| 表名 | 状态 | 说明 |
|------|------|------|
| `profiles` | 已用，部分列需 `ALTER` | 用户资料、运动偏好、位置 |
| `activities` | 已有框架 | 活动记录 |
| `swipes` | 需建（SQL 在代码注释里） | Match 滑动记录 |
| `posts` | 需建 | 社区帖子 |
| `reactions` | 需建 | 帖子 Reaction |
| `comments` | 需建 | 帖子评论 |
| `groups` | 需建 | 社区群组 |
| `events` | 需建 | 活动 / 赛事 |
| `event_rsvps` | 需建 | 活动报名 |
| `group_members` | 需建 | 群组成员 |

---

## 品牌 Token（颜色）

```
ORANGE    = '#E8602C'   // 主强调色，按钮、高亮
DARK      = '#1C1A18'   // 标题、深色背景
BG        = '#F0EDE8'   // 屏幕背景（暖白）
CARD_BG   = '#EAE6DF'   // 卡片背景
```

Logo 文件：`assets/lauver-logo.png`，使用时需 `resizeMode="contain"`，3:1 比例。

---

## 测试与发布流程

### 前置条件

在任何测试/发布流程开始前，确保以下都已完成：

```bash
# 安装依赖
npm install

# 创建 .env 文件（从环境变量模板复制后填入真实值）
# 参考本文档「环境变量」章节
```

需要的账号：
- Apple Developer 账号（$99/年，上架 App Store 必须）
- Expo 账号（免费，EAS Build 需要）
- Firebase 控制台项目
- Supabase 项目
- Strava API 应用（如需测试 Strava 连接）

---

### 一、本地开发测试（Expo Go）

**适用场景**：日常 UI 开发、逻辑调试，不涉及原生模块（Apple Health、推送通知等）

#### 启动开发服务器

```bash
npm start
# 或者
npx expo start
```

启动后会显示二维码和菜单选项。

#### 在模拟器上测试

```bash
# iOS 模拟器（需要 Xcode，仅 macOS）
npm run ios
# 或在 expo start 后按 i

# Android 模拟器（需要 Android Studio + AVD）
npm run android
# 或在 expo start 后按 a
```

#### 在真机上用 Expo Go 测试

1. iPhone/Android 安装 **Expo Go** App（App Store / Google Play）
2. 确保手机和电脑在同一 Wi-Fi 下
3. iPhone：用相机扫 `npm start` 显示的二维码
4. Android：在 Expo Go 里扫码

**Expo Go 的限制**：
- 不支持 `react-native-health`（Apple Health）
- 不支持 `expo-dev-client` 扩展的原生模块
- 不支持自定义 URL scheme（Strava OAuth 回调会失败）
- 推送通知受限

---

### 二、真机完整测试（Dev Build）

**适用场景**：测试 Apple Health、Strava OAuth、推送通知等需要原生模块的功能

Dev Build = 用 `expo-dev-client` 编译的开发版 App，包含所有原生模块，行为与生产包一致，但仍连接本地开发服务器。

#### 方式 A：本地编译（需要 Mac + Xcode）

```bash
# 安装 EAS CLI（如未安装）
npm install -g eas-cli

# 登录 Expo 账号
eas login

# 初始化 EAS 配置（首次）
eas build:configure

# 本地编译 iOS dev build（编译在本机，不消耗 EAS 云额度）
npx expo run:ios --device

# 本地编译 Android dev build
npx expo run:android --device
```

`npx expo run:ios` 会：
1. 生成 `ios/` 目录（如不存在）
2. 用 Xcode 工具链编译
3. 自动安装到连接的 iPhone（需信任开发者证书）

#### 方式 B：EAS Cloud Build（推荐，不需要 Mac 本地 Xcode）

```bash
# 云端构建 iOS dev build
eas build --profile development --platform ios

# 云端构建 Android dev build
eas build --profile development --platform android
```

构建完成后：
- iOS：下载 `.ipa` 文件，用 Apple Configurator 2 或 Xcode Devices 安装到真机
- Android：下载 `.apk` 直接安装

构建完成后启动开发服务器：

```bash
npx expo start --dev-client
```

打开 Dev Build App，扫码或输入服务器地址连接。

#### EAS 配置文件（eas.json）

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

#### Strava OAuth 本地测试注意事项

Strava 回调 URI 格式是 `lauver://oauthredirect`，需要：
1. 在 `app.json` 配置 `scheme: "lauver"`
2. 在 Strava 开发者后台（strava.com/settings/api）把回调 URI 注册为 `lauver://oauthredirect`
3. Expo Go 不支持自定义 scheme，**必须用 Dev Build 测试**
4. 本地测试时 Edge Function 调用的是 Supabase 云端，不需要本地启动服务

---

### 三、内部分发测试（Preview Build）

**适用场景**：给团队成员或内测用户测试，不需要通过 App Store 审核

#### 构建 Preview 包

```bash
# iOS（分发给内部设备）
eas build --profile preview --platform ios

# Android（生成 APK，任意设备可装）
eas build --profile preview --platform android
```

#### iOS 内部分发方式

**Ad Hoc 分发**（最多 100 台设备）：

1. 在 Apple Developer 后台注册测试设备的 UDID（设备 → 添加设备）
2. `eas.json` 的 preview profile 设置 `distribution: "internal"`
3. EAS Build 会自动生成对应的 Provisioning Profile
4. 构建完成后通过 EAS 链接安装，或用 Apple Configurator 2

**获取 iPhone UDID 的方式**：
- 连接 Mac，打开 Finder → 选中设备 → 点击序列号可切换显示 UDID
- 或在 Expo Dashboard 的 Device Management 页面扫码注册

#### Android 内部分发

APK 文件直接发给测试者，在 Android 设置中允许「未知来源」安装即可。

---

### 四、TestFlight 内测

**适用场景**：App Store 上架前的最终测试，最多 10,000 名外部测试者，测试者需安装 TestFlight App

#### 前置准备

1. **Apple Developer 账号**已加入 App Store Connect
2. **Bundle ID** 在 Apple Developer Portal 注册（在 `app.json` 的 `ios.bundleIdentifier` 中设置）
3. **App Store Connect** 中已创建对应 App 记录

#### 步骤

**1. 配置 app.json**

```json
{
  "expo": {
    "name": "Lauver",
    "slug": "lauver-mobile-app",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.lauver.app",
      "buildNumber": "1"
    },
    "android": {
      "package": "com.lauver.app",
      "versionCode": 1
    }
  }
}
```

**2. 构建生产包**

```bash
# 构建 iOS 生产包（.ipa）并自动提交到 App Store Connect
eas build --profile production --platform ios

# 或只构建不提交
eas build --profile production --platform ios --no-wait
```

EAS 会：
- 用生产证书（Distribution Certificate）和 App Store Provisioning Profile 签名
- 自动管理证书（如果让 EAS 托管的话）

**3. 提交到 App Store Connect**

```bash
# 构建完成后提交
eas submit --platform ios

# 或构建时直接提交
eas build --profile production --platform ios --auto-submit
```

**4. 在 App Store Connect 发布 TestFlight**

1. 打开 appstoreconnect.apple.com
2. 选择 App → TestFlight → 等待构建处理完成（通常 15-30 分钟）
3. 填写测试信息（What to Test）
4. **内部测试**（Internal Testing）：直接发给 App Store Connect 用户（最多 100 人），无需审核
5. **外部测试**（External Testing）：需要 Apple 审核（通常 1-2 天），审核通过后可邀请最多 10,000 名测试者

**5. 邀请测试者**

- 内部：在 TestFlight → Internal Group 添加 Apple ID
- 外部：生成邀请链接或通过邮件邀请，测试者安装 TestFlight App 后接受邀请

---

### 五、App Store 正式上线

#### 前置检查清单

- [ ] 所有核心功能已测试通过
- [ ] 隐私政策 URL 已准备（App Store 强制要求）
- [ ] 用户协议 URL 已准备
- [ ] App 图标（1024×1024 PNG，无圆角，无透明度）
- [ ] 截图已准备（各尺寸 iPhone + iPad，如果支持 iPad）
- [ ] App 描述、关键词、分类已写好
- [ ] 年龄评级已填写
- [ ] 第三方 SDK 隐私清单（Privacy Manifest）已配置（iOS 17+ 要求）
- [ ] 如用了 Apple Health，`NSHealthShareUsageDescription` 已填写且准确
- [ ] 构建包已通过 TestFlight 测试

#### 截图尺寸要求

| 设备 | 分辨率 | 必须 |
|------|--------|------|
| iPhone 6.9" (iPhone 16 Pro Max) | 1320×2868 | 是 |
| iPhone 6.5" (iPhone 11 Pro Max) | 1242×2688 | 是（如不提供 6.9"） |
| iPhone 5.5" (iPhone 8 Plus) | 1242×2208 | 可选 |
| iPad Pro 13" | 2064×2752 | iPad 版必须 |

最简单的做法：用 iOS 模拟器截图，或用 Sketch / Figma 生成设计稿截图。

#### 提交流程

**1. 在 App Store Connect 创建新版本**

1. 打开 App Store Connect → 选择 App → App Store → + Version
2. 填写版本号（与 `app.json` 的 `version` 一致）

**2. 填写元数据**

- **名称**：App Store 上显示的名字（最多 30 字符）
- **副标题**：（最多 30 字符）
- **描述**：（最多 4000 字符）
- **关键词**：逗号分隔，影响搜索排名（最多 100 字符）
- **支持 URL**：必填
- **隐私政策 URL**：必填
- **截图**：每个设备尺寸最少 1 张，最多 10 张

**3. 选择构建版本**

在「Build」区域选择刚通过 TestFlight 测试的构建版本。

**4. 填写出口合规信息**

如果 App 使用加密（HTTPS 算），需要声明。通常选「是，使用了标准加密算法」。

**5. 提交审核**

点击「Submit for Review」，之后进入审核队列。

#### 审核时间

- 首次提交：通常 **1-3 个工作日**
- 更新版本：通常 **24-48 小时**
- 被拒绝后修改重新提交：重新进入审核队列

#### 常见被拒原因（提前规避）

| 原因 | 对应检查 |
|------|---------|
| 隐私权限说明不够具体 | `NSHealthShareUsageDescription` 等必须说明具体用途 |
| 登录功能必须支持 Sign in with Apple | 如果有第三方登录（Google/Facebook），必须同时提供 Apple 登录 |
| 功能不完整 / 占位内容 | 确保所有 Tab 都有内容，不能有明显 stub |
| 元数据不准确 | 截图必须真实反映 App 功能 |
| 崩溃 | 提交前在真机上充分测试 |
| 内购未配置 | 如有付费功能必须通过 StoreKit |

#### 发布后

- **分阶段发布**（Phased Release）：可选，7 天内逐步推送给 1%→2%→5%→10%→20%→50%→100% 用户，出问题可随时暂停
- **版本更新**：重复上述流程，`buildNumber`（iOS）/ `versionCode`（Android）必须每次递增

---

### 六、Android Google Play（备忘）

流程与 iOS 类似，主要差异：

```bash
# 构建 Android 生产包（AAB 格式，Google Play 要求）
eas build --profile production --platform android

# 提交到 Google Play
eas submit --platform android
```

- **Google Play Console**（play.google.com/console）：$25 一次性注册费
- 构建格式：AAB（Android App Bundle），比 APK 更小
- 审核时间：首次 3-7 天，更新通常 1-3 天
- **内测轨道**（Internal Testing）→ 封闭测试（Closed Testing）→ 开放测试（Open Testing）→ 正式发布，对应 TestFlight 的不同阶段

---

## 测试报告

> 执行时间：2026-06-16
> 运行命令：`npm test`（Jest 29 + node 环境）

### 总结

| 指标 | 结果 |
|------|------|
| 测试套件 | 5 |
| 总用例数 | **82** |
| 通过 | **82** ✅ |
| 失败 | 0 |
| 耗时 | ~0.5 秒 |

### 测试文件

| 文件 | 用例数 | 状态 |
|------|--------|------|
| `__tests__/lib/activities.test.js` | 22 | ✅ PASS |
| `__tests__/lib/community.test.js` | 26 | ✅ PASS |
| `__tests__/lib/match.test.js` | 20 | ✅ PASS |
| `__tests__/lib/sync/importActivity.test.js` | 7 | ✅ PASS |
| `__tests__/context/ThemeContext.test.js` | 7 | ✅ PASS |

### 测试覆盖模块详情

#### `src/lib/activities.js` — 22 个用例
- `getWeekStats`：空数据返回 0、正确求和、null distance_km 兼容、DB 错误时抛出
- `getWeeklyChart`：返回 7 个桶、Day 顺序为 Mon–Sun、只有一个 today、活动分配到正确星期
- `getRecentActivities`：返回正确数据、正确传 limit
- `getAllTimeStats`：空数据、longestKm 计算、bestPaceSecPerKm 只计算 running、总距离含所有运动、无跑步数据时 pace 为 null
- `getDistanceChartData`：Month=4桶、3 Months=12桶、Year=12桶（月份缩写）、数据聚合正确
- `getActivitiesList`：返回完整列表、查询 activities 表
- `getMonthStats`：count 和 totalDistanceKm、空月返回零

#### `src/lib/community.js` — 26 个用例
- `getFeed`：空帖子、reactionCounts 聚合正确、userReactions 只含当前用户、空 reactions 返回空对象
- `createPost`：插入 posts 表、photo_url 不传时不包含该字段
- `toggleReaction`：无现有 reaction 返回 true（新增）、有现有 reaction 返回 false（移除）
- `getSuggestedGroups`：返回群组列表、无群组返回空数组
- `joinGroup`：插入 group_members、调用 RPC increment_group_member_count
- `getUpcomingEvents`：hasRsvp=true 当已报名、hasRsvp=false 当未报名、无活动返回空数组
- `toggleRsvp`：无 RSVP 时返回 true、有 RSVP 时返回 false
- `createCommunity`：插入 communities 表、返回创建的社区
- `getComments`：返回帖子评论、无评论返回空数组
- `createComment`：插入 post_comments、返回含作者的评论
- `deleteComment`：调用 delete on post_comments

#### `src/lib/match.js` — 20 个用例
- `getMatchReadiness`：account 永远为 done、返回 4 个检查项、photo 有/无 avatar_url、sports 空数组/无 skill_level/完整情况、location 无 location_name/空 availability/完整情况、完整 profile 全部通过、null profile 全部非 account 为 false
- `getMatchCandidates`：返回候选人、过滤器调用正确的表、无候选人返回空数组
- `recordSwipe`：调用 swipes 表 upsert、pass/like/star 三种 action 均不抛出
- `getMutualMatches`：无 outgoing likes 返回空数组、互匹时返回对方 profile

#### `src/lib/sync/importActivity.js` — 7 个用例
- **Layer 1（精确匹配）**：找到 exact match 返回 skipped、不查询 activities 表
- **Layer 2（时间指纹）**：时长误差 <10% 时返回 linked、时长误差 >10% 时创建新活动
- **新建活动**：无任何匹配时返回 created 及新 activityId、INSERT 失败时抛出错误

#### `src/context/ThemeContext.js` — 7 个用例
- LIGHT palette：含所有必要 token、isDark=false、ORANGE 为品牌色 `#E8602C`、所有颜色值为合法 hex
- DARK palette：含所有必要 token、isDark=true、ORANGE 与 LIGHT 相同、BG 比 LIGHT 更暗、TEXT 比 LIGHT 更亮、LIGHT/DARK 的 key 集合完全相同
- Token 区分度：CARD_BG ≠ BG（两套主题）、ELEVATED ≠ CARD_BG（两套主题）、TEXT ≠ TEXT_FAINT（两套主题）

### 技术配置

| 配置项 | 值 |
|--------|-----|
| 测试框架 | Jest 29 |
| 测试环境 | `node`（不加载 React Native 运行时） |
| Babel preset | `@babel/preset-env` + `@babel/preset-react` |
| Supabase mock | `src/lib/__mocks__/supabase.js`（自动 mock，支持 `__setTableData` 按表配置返回数据） |
| Firebase mock | 未涉及（lib 层测试不触发 Firebase） |

### 未覆盖的内容

| 模块 | 原因 |
|------|------|
| Screen 组件（CommunityScreen、DashboardScreen 等） | 依赖 React Native 渲染环境，需 `@testing-library/react-native` + native setup |
| Hooks（useAuth、useCommunity 等） | 同上，依赖 React Context/渲染 |
| Apple Health 同步 (`appleSync.js`) | 依赖 `react-native-health` 原生模块 |
| Strava OAuth 流程 | 依赖 `expo-auth-session` 和系统浏览器 |
