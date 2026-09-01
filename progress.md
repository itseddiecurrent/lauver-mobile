# Lauver Mobile 开发进度分析

> 分析日期：2026-08-29
>
> 对照基准：[Lauver.ai 官网](https://lauver.ai/)与当前仓库源码
>
> 当前判断：**已经形成可打包的社交运动 App MVP，但还没有实现官网所描述的完整 AI 运动平台。**

## 1. 结论摘要

Lauver Mobile 目前不是只有静态页面的原型。账户、个人资料、活动记录、数据看板、运动伙伴互选、匹配后聊天、社区发帖等主流程都已有真实前后端代码，iOS bundle 也能成功构建。

不过，官网最核心的差异化承诺——GPS 运动追踪、真正的 AI 匹配、AI 表现教练、路线发现、挑战与目标——大多仍未完成。当前的「AI Matching」实际上是基于性别、距离和运动项目的 SQL 过滤与排序，没有模型调用，也没有分析配速、日程、性格或训练目标。

用两个口径看当前完成度更准确：

- **按“可用 Beta MVP”口径：约 60%**。基础账户、资料、手动活动、基础社区和匹配聊天已成形，但仍有配置、数据库可复现性、实机同步和安全问题需要收尾。
- **按官网完整产品愿景口径：约 30%**。官网六大能力中，前三项只有部分实现，后三项基本尚未开始。

这两个百分比是基于功能覆盖的粗略估算，不代表工时或代码量。

## 2. 官网能力对照

状态说明：✅ 已形成闭环；🟡 部分完成；❌ 未发现实现。

| 官网能力 | 状态 | 当前实际实现 | 主要缺口 |
|---|---|---|---|
| Record Activities | 🟡 | 可手动记录 8 种运动；可展示列表、详情、周/月/年度统计；有 Strava 和 Apple Health 导入代码 | 没有 App 内 GPS 实时记录、轨迹、地图、自动识别、个人最佳；不是官网所称 50+ 项运动 |
| AI Matching Engine | 🟡 | 候选人、左右选择、互相喜欢、每日 15 次限制、距离/性别/运动筛选、匹配列表均已实现 | 当前不是 AI；没有配速、日程、训练目标、性格/氛围信号，也没有匹配分数或解释 |
| Community Discovery | 🟡 | 动态 Feed、发帖、反应、评论、加入推荐小组、活动 RSVP、创建 Community 已有代码 | 没有真正的 AI 推荐、社区详情/搜索、成员管理、训练组织和群组协调；Nearby Athletes 按钮无行为 |
| Performance Intelligence | 🟡 | 有周/月/总里程、时长、最佳配速、最长距离等描述性统计 | 没有训练负荷、恢复、进步趋势、建议或 AI Coach |
| Route Discovery | ❌ | 活动详情只放置了 Route map 占位卡 | 没有 GPS polyline、路线保存、附近路线、众包或推荐 |
| Challenges & Goals | ❌ | 未发现对应页面、表、Hook 或业务逻辑 | 个人目标、社区挑战、排行榜、伙伴监督均未实现 |

官网比较表中的 “Real-Time Group Coordination”“AI Performance Coach”“Smart + Social Route Discovery” 等能力，也不应在当前版本中标记为已经交付。

## 3. 已经完成或基本完成的功能

### 3.1 App 基础架构

- React Native 0.81 + Expo SDK 54 + React 19，启用 New Architecture。
- 已配置 iOS、Android、Web 项目标识和 EAS project ID。
- React Navigation 已形成登录门控、5 个主 Tab、活动详情栈、记录活动 Modal 和聊天页。
- 有统一的亮色/暗色主题并通过 AsyncStorage 持久化。
- 有全局距离、海拔、体重单位系统，支持 km/mi、m/ft、kg/lb，并持久化设置。
- Firebase 用于认证，Supabase 用于数据库、Storage、Realtime 和 Edge Functions。

主要证据：[`App.js`](App.js)、[`src/navigation/index.js`](src/navigation/index.js)、[`src/context/ThemeContext.js`](src/context/ThemeContext.js)、[`src/context/UnitsContext.js`](src/context/UnitsContext.js)。

### 3.2 账户与登录

- 邮箱密码注册和登录已实现。
- 注册时可填写姓名，并写入 Firebase displayName。
- Google OAuth 登录流程已有实现。
- Firebase Auth 使用 AsyncStorage 保持登录状态。
- Firebase 登录后会用 ID Token 建立 Supabase session，使两边 session 同步。
- 已登录/未登录导航门控和退出登录已实现。
- 有常见认证错误的用户友好提示。

边界：没有邮箱验证流程、忘记密码、删除账户；“Terms of Service / Privacy Policy”目前只是文字；Google 登录还依赖尚未完整提供的环境配置。

主要证据：[`src/screens/auth/LoginScreen.js`](src/screens/auth/LoginScreen.js)、[`src/hooks/useAuth.js`](src/hooks/useAuth.js)、[`src/lib/firebase.js`](src/lib/firebase.js)、[`src/lib/supabase.js`](src/lib/supabase.js)。

### 3.3 个人资料

- 可编辑姓名、生日、Bio、城市、搜索半径、运动项目、技能水平、寻找对象和可训练时间。
- 最多 6 张资料照片，可上传、删除、调整顺序，并有运动员卡片预览。
- 有资料完成度清单和 Dashboard 完成度入口。
- 可设置是否出现在匹配中、本人性别和单位偏好。
- 可切换亮/暗主题并退出账号。
- 资料和偏好会写入 Supabase；照片会写入 `avatars` Storage bucket。

边界：照片从资料中移除时没有删除 Storage 中的旧对象；完成度把“邮箱已验证”固定当作已完成，而不是读取真实验证状态。

主要证据：[`src/screens/profile/ProfileScreen.js`](src/screens/profile/ProfileScreen.js)、[`src/hooks/useProfile.js`](src/hooks/useProfile.js)。

### 3.4 Dashboard 与运动数据展示

- Dashboard 可展示本周活动次数、距离、时长和 7 天柱状图。
- 可展示最近 3 次活动、当月汇总、匹配数量、最新社区动态和资料完成度。
- 活动或平台同步完成后，会通过内部事件刷新 Dashboard 和活动列表。
- 有 Loading、空状态、错误与重试界面。

主要证据：[`src/screens/dashboard/DashboardScreen.js`](src/screens/dashboard/DashboardScreen.js)、[`src/hooks/useDashboard.js`](src/hooks/useDashboard.js)、[`src/lib/syncEvents.js`](src/lib/syncEvents.js)。

### 3.5 手动记录与活动历史

- 可记录 Run、Ride、Climb、Swim、Hike、Ski、Gym、Yoga 8 种运动。
- 可填写标题、日期、时间、时长、距离/攀爬线路数、热量和备注。
- 活动列表支持 All/Run/Ride/Climb/Swim 筛选。
- 距离图支持 Month、3 Months、Year。
- 有总活动数、总距离、最长距离、最佳配速等聚合统计。
- 活动详情按运动类型展示距离、时长、配速/速度、心率、热量、爬升和来源。

边界：没有编辑或删除活动；手动记录只有 8 种运动；地图是明确的占位内容，写着 “GPS tracks not yet supported”。

主要证据：[`src/screens/activities/LogActivityScreen.js`](src/screens/activities/LogActivityScreen.js)、[`src/screens/activities/ActivitiesScreen.js`](src/screens/activities/ActivitiesScreen.js)、[`src/screens/activities/ActivityDetailScreen.js`](src/screens/activities/ActivityDetailScreen.js)、[`src/lib/activities.js`](src/lib/activities.js)。

### 3.6 多来源活动导入与去重

- 已实现统一 `importActivity` 入口和两层去重：外部 ID 精确匹配 + 开始时间/运动/时长指纹匹配。
- 同一活动可关联多个来源，并按 Garmin、COROS、Apple、Strava、Manual 的优先级更新 canonical source。
- Strava 已有 OAuth、token 保存、token 刷新、最近活动分页拉取、首次后台同步、手动同步函数和同步日志。
- Apple Health 已有权限申请、最近 30 天 Workout 读取、字段映射和导入代码。

边界：这部分属于“代码路径已存在”，尚不能全部算作实机闭环。详见第 5 节风险。

主要证据：[`src/lib/sync/importActivity.js`](src/lib/sync/importActivity.js)、[`src/lib/sync/appleSync.js`](src/lib/sync/appleSync.js)、[`src/hooks/useStravaConnect.js`](src/hooks/useStravaConnect.js)、[`supabase/functions/strava-auth/index.ts`](supabase/functions/strava-auth/index.ts)、[`supabase/functions/strava-refresh/index.ts`](supabase/functions/strava-refresh/index.ts)、[`supabase/functions/strava-sync/index.ts`](supabase/functions/strava-sync/index.ts)。

### 3.7 运动伙伴匹配与一对一聊天

- 匹配首次设置可保存本人性别和希望看到的性别。
- App 会申请前台定位并保存经纬度。
- 候选人支持性别、最大距离、运动类型筛选；筛选项会本地持久化。
- 可 Pass/Like；每天最多 15 个 Like；已经选择过的人会被排除。
- 双方互相 Like 时创建 Match，并出现 “It's a Match” 提示。
- 有匹配列表、最后一条消息、未读数量。
- 一对一聊天支持历史消息、乐观发送、Supabase Realtime 新消息、已读回执和 Unmatch。

边界：候选排序只是“距离优先 + 共同运动数量”，不是官网描述的 AI 匹配。

主要证据：[`src/screens/match/MatchScreen.js`](src/screens/match/MatchScreen.js)、[`src/screens/match/ChatScreen.js`](src/screens/match/ChatScreen.js)、[`src/hooks/useMatch.js`](src/hooks/useMatch.js)、[`src/hooks/useChat.js`](src/hooks/useChat.js)、[`src/lib/match.js`](src/lib/match.js)、[`src/lib/chat.js`](src/lib/chat.js)。

### 3.8 社区基础功能

- Feed 可读取帖子、作者、关联活动、反应数量和评论数量。
- 可发布文字，并选择关联自己的活动。
- 有照片选择与上传代码。
- 可添加/取消反应，新增/删除自己的评论。
- 新帖子通过 Supabase Realtime 触发 Feed 刷新。
- 可查看推荐小组并加入。
- 可查看即将开始的活动并 RSVP/取消 RSVP。
- 可填写名称、联系人、创始人、位置、介绍、类型、隐私、加入方式和标签来创建 Community。

边界：社区目前是多个基础模块拼出的 Feed，不是完整的社区发现和运营体系。

主要证据：[`src/screens/community/CommunityScreen.js`](src/screens/community/CommunityScreen.js)、[`src/hooks/useCommunity.js`](src/hooks/useCommunity.js)、[`src/lib/community.js`](src/lib/community.js)。

## 4. 明确尚未完成的官网功能

### 4.1 GPS 运动记录

未发现后台定位、计时器、暂停/继续、GPS 点采样、轨迹压缩、polyline 保存、地图渲染或运动中实时指标。当前 App 是“手动日志 + 外部平台导入”，还不是 GPS Tracker。

### 4.2 真正的 AI 匹配

仓库中没有 LLM/Embedding/推荐模型调用，也没有离线训练或特征管道。匹配 RPC 只使用：

- 性别过滤；
- Haversine 距离过滤；
- 运动项目交集；
- 已选择用户排除；
- 距离和运动重合数量排序。

官网提到的 pace、schedule、personality signals、training goals 目前均未进入算法。

### 4.3 AI 表现教练

当前统计属于数据汇总，不包含训练负荷、疲劳/恢复、周期趋势、伤病风险、训练建议或对话式教练。

### 4.4 路线发现

没有路线模型、路线表、地图 SDK、附近路线查询、路线收藏或众包评价。活动详情中的地图是占位卡。

### 4.5 挑战与目标

没有目标、挑战、参赛、进度、排行榜、徽章或伙伴问责相关数据结构和界面。

### 4.6 实时群组协调

没有群聊、训练排期、出勤管理、群组通知或现场协调能力。一对一 Match Chat 不能等同于官网所称的 Group Coordination。

## 5. 影响真实 Beta 的风险与未闭环项

### P0：发布前必须处理

1. **数据库无法仅靠仓库完整重建。** 现有 migration 明确跳过 `profiles`、`activities`、`communities` 等既有表；前端依赖的 7 个活动统计 RPC 也没有对应 migration。新环境无法从当前仓库可靠 bootstrap。

2. **Match/Chat RPC 存在身份授权风险。** 多个 `SECURITY DEFINER` RPC 接受客户端传入的 `uid`，却没有核对 `uid = auth.uid()`。如果没有额外数据库级授权限制，调用者可能伪造其他用户 UID 来查询候选、读取匹配/消息、发送消息或执行 Unmatch。Edge Functions 同样应从已验证 JWT 推导用户，而不是信任请求体里的 `userId`。

3. **Strava 与 Google 环境配置不完整。** 当前 `.env` 可被 Expo 读取，但构建输出没有显示 Strava Client ID、Google OAuth Client IDs 或代码中使用的 `EXPO_PUBLIC_SUPABASE_ANON_KEY`。因此这些 OAuth 流程不能视作当前环境已可用；并且项目同时使用 `PUBLISHABLE_KEY` 和 `ANON_KEY` 两个变量名，需要统一。

4. **线上数据库与 Storage 未被本次验证。** 本机缺少 Supabase CLI，因此表、列、RLS、RPC、Realtime publication、`avatars` 和 `post-media` bucket 无法做联机核验。

5. **社区照片帖子没有展示闭环。** 上传和 `photo_url` 写入代码存在，但 `getFeed()` 没有查询 `photo_url`，`PostCard` 也没有渲染图片。

### P1：Beta 体验问题

6. **Garmin 目前是假连接。** Profile 中的 Connect 只切换本地 `garminConnected` state，没有 OAuth、token、同步或持久化。

7. **Apple Health 尚需真机修正和验证。** 它需要 dev/production build；首次授权后立即同步可能读取到旧的 `connected` state 而提前返回，连接状态也没有持久化。配置文案声明只读，但 `NSHealthUpdateUsageDescription` 暗示会写入，需要统一。

8. **Strava 的 `syncNow()` 没有接入 Profile UI。** 首次 OAuth 后会触发一次后台同步，但用户没有可见的手动同步入口，也没有周期同步调度。

9. **多个可见按钮没有行为。** Community 的 Share 和 Enable Location 没有 `onPress`；登录页条款文字不可点击。

10. **Community 与 Groups 是两套未打通的数据模型。** 创建内容写入 `communities`，推荐与加入读取 `groups/group_members`，新建 Community 不会自然出现在推荐小组流程中。

11. **大量读取错误被降级为空数据。** Dashboard、Activities、Community 和 Match 多处使用 `.catch(() => [])` 或默认值，生产环境会把后端故障表现成“暂无内容”，不利于发现问题。

12. **首个用户资料的创建时机不明确。** 注册只创建 Firebase 用户；多个社区和匹配表依赖 `profiles` 外键。应在首次登录时自动创建最小 profile，而不是依赖用户先完整保存资料。

## 6. 数据与后端现状

仓库里已经有以下数据库/后端资产：

- 社区：`posts`、`post_reactions`、`post_comments`、`groups`、`group_members`、`events`、`event_rsvps`。
- 匹配：`swipes`、`matches`、`messages`，以及候选、Like、匹配、消息和位置 RPC。
- 同步：`platform_connections`、`activity_sources`、`sync_log`。
- Edge Functions：`strava-auth`、`strava-refresh`、`strava-sync`。
- 测试用 Match seed 数据。

但 migration 不是一套自包含 schema，Storage bucket/policy 也没有纳入 migration。当前更像是“围绕一个已有 Supabase 项目持续补丁”，而不是可以从零部署的后端。

## 7. 验证结果

本次执行了以下检查：

| 检查 | 结果 | 说明 |
|---|---|---|
| iOS production export | ✅ 通过 | Metro 成功打包 995 个模块，生成约 3.41 MB Hermes bundle |
| Jest 单元测试 | 🟡 201/289 通过 | 11 个 suite 通过；活动、社区、匹配、同步、主题、单位等单元测试通过 |
| 数据库 schema suite | ⚪ 未执行成功 | 88 个失败均来自 `supabase: command not found`，不能解释为 schema 本身失败或通过 |
| Firebase/Supabase 登录实测 | ⚪ 未验证 | 本次只做源码与构建审计 |
| Strava OAuth/同步实测 | ⚪ 未验证 | 缺少当前环境所需配置，未连接真实账户 |
| Apple Health 真机同步 | ⚪ 未验证 | 需要 iPhone dev build 与 Health 权限 |
| 端到端 UI 测试 | ❌ 未发现 | 当前测试以 lib/hook/context 为主，没有 Maestro/Detox 类 E2E |

## 8. 建议的下一阶段顺序

### 第一阶段：把现有 MVP 变成可信的 Private Beta

1. 补齐从零建库 migration：核心表、全部 RPC、RLS、Storage buckets/policies、Realtime 配置和 seed。
2. 修复 RPC/Edge Function 的身份校验，所有用户 ID 从已验证 session/JWT 获取。
3. 统一环境变量，真实验证 Email/Google 登录、资料创建、Strava OAuth 和同步。
4. 自动创建初始 profile；补齐错误提示和可观测性。
5. 修复社区图片展示、Share/Nearby 按钮、Community/Group 数据模型分裂。
6. 真机验证并修复 Apple Health；在完成前将 Garmin 标为 Coming Soon，而不是伪连接。

### 第二阶段：完成官网前三个核心支柱

1. 增加 App 内 GPS 记录、暂停/恢复、轨迹地图、后台定位和活动编辑/删除。
2. 将匹配特征扩展到配速、可用日程、训练目标、水平和偏好，并展示可解释的匹配分数。
3. 增加社区搜索/详情、成员与管理员、活动创建、群聊和训练协调。

### 第三阶段：兑现官网差异化能力

1. Performance Intelligence / AI Coach。
2. Route Discovery 与众包路线。
3. Challenges、Goals、排行榜与伙伴问责。

## 9. 当前里程碑定义

基于现状，最准确的产品描述是：

> **Lauver Private Beta：一个支持手动/外部导入运动数据、基础运动统计、社区 Feed、规则式伙伴匹配和实时一对一聊天的跨平台 App。**

在 GPS、AI 匹配、AI Coach、路线和挑战真正落地之前，不建议把当前版本对外描述成已经具备官网全部能力的 “AI-powered athletic platform”。
