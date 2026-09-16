# Lauver Native iOS MVP 需求与实施计划

> 文档版本：1.0
>
> 编写日期：2026-08-29
>
> 产品：Lauver — workout-partner social platform
>
> 目标：交付可提交 TestFlight / App Store Review 的原生 iOS MVP、Node.js Express 后端和完整部署文档。

## 1. MVP 定义

本项目只构建 **Lauver 原生 iOS App 和配套 API**，不重做已经完成的 [lauver.ai](https://lauver.ai/) 营销网站。

MVP 的核心用户价值是：

1. 用户建立清晰的运动资料；
2. 用明确、可解释的手动筛选发现附近运动伙伴；
3. 私聊潜在训练伙伴；
4. 创建、浏览和加入公开训练活动；
5. 在活动参与者群聊中完成训练协调；
6. 用举报、拉黑和后台审核形成基本安全闭环。

推荐实现选择：**Swift + SwiftUI 原生 iOS App**。SwiftUI 属于 Apple 原生 UI 技术，满足 “Swift native” 要求；不使用 React Native、Expo 或 WebView 承载产品页面。

**UI 是 MVP 的核心交付要求。** 以当前仓库通过 `npx expo start` 运行的现有版本为视觉与交互参考，在 SwiftUI 中对齐品牌、配色、字体层级、布局、间距、图标、按钮和页面细节。原生功能验收通过不代表视觉验收通过；所有面向用户的页面必须完成 Step 14A 的 UI 对齐与真机验收，才能进入最终交付。参考版本中超出 MVP 范围的功能和入口不迁移；与原生平台或 MVP 流程不同的部分需记录具体差异及原因。

## 2. 不可违反的范围限制

以下内容不得出现在 MVP 的代码、界面、营销文案、占位入口或假按钮中：

- ❌ 任何 AI 功能，包括 AI 匹配、推荐模型、LLM 助手、AI 教练、Embedding 或 AI 内容审核；
- ❌ Garmin 官方 API、Garmin OAuth 或 Garmin 同步；
- ❌ 付费订阅、Premium、Paywall、StoreKit 和 In-App Purchase；
- ❌ Tinder 式左右滑动、Like、互相 Match 或卡片堆叠交互；
- ❌ 重建 lauver.ai Landing Page；
- ❌ “Coming soon” 形式的 AI、Garmin 或 Premium 入口。

Discover 只能使用确定性的普通筛选和排序：运动类型、城市级距离、配速区间。界面使用列表和筛选 Sheet，不使用滑动匹配。

所有 AI、Garmin 和付费能力统一记录在 Version 2 Backlog 中，但不进入 MVP target。

## 3. MVP 成功标准

当以下完整路径均可在真实 iPhone 和 Render staging 环境通过时，MVP 才算完成：

- 新用户能用 Email/Password 或 Sign in with Apple 创建账户并恢复登录状态；
- 用户能在 App 内永久删除账户，而不需要发邮件或联系客服；
- 用户能完成资料、上传照片并用运动/半径/配速筛选其他用户；
- 用户能连接 Strava、看到最近活动、刷新数据并彻底断开；
- 用户可以选择不启用 HealthKit，且 App 其他功能完全正常；
- 用户主动启用 HealthKit 后，能导入已授权的 Workout 摘要；
- 两个未互相拉黑的用户能创建一对一私聊并实时收发文本；
- 用户能在 Profile、Chat 和 Event 三处提交举报并拉黑用户；
- 用户能创建公开活动、浏览活动、加入/退出活动，并进入参与者群聊；
- 管理员能在后台查看举报、记录处理结果、暂停用户或下架活动；
- iOS App 不包含任何服务端 secret，后端可按照 README 部署到 Render。

## 4. 功能需求与验收条件

### F1. Authentication 与账户删除

#### 用户功能

- Email + Password 注册、登录、退出；
- Sign in with Apple；
- Email 密码重置；
- 登录状态安全恢复；
- Settings 中提供清晰可见的 Delete Account；
- 删除前要求二次确认，并对敏感操作重新认证；
- 删除完成后清空 Keychain、本地缓存并回到登录页。

#### 技术要求

- iOS 使用 `AuthenticationServices` 和官方 `ASAuthorizationAppleIDButton`；
- Apple identity token 和 authorization code 发送到后端验证；
- 后端验证 token 签名、issuer、audience、nonce 和过期时间；
- Apple 只在首次授权返回姓名/邮箱，客户端必须立即传给后端保存；
- Password 使用 Argon2id 哈希，不保存明文或可逆密码；
- Access token 短时有效，refresh token 轮换并以哈希形式存储；
- iOS token 只存 Keychain，不存 UserDefaults；
- Apple private key、Apple client secret 生成材料只放 Render 环境变量。

#### 删除账户必须完成的清理

1. 立即禁用账户和所有 session；
2. 如果使用 Sign in with Apple，服务端调用 Apple token revocation；
3. 如果连接 Strava，服务端撤销 Strava token；
4. 删除或匿名化 Stream 用户、Direct Chat 和相关消息数据；
5. 删除资料照片、活动、参与记录和其他个人数据；
6. 删除或匿名化用户创建的公开活动，规则必须写入 Privacy Policy；
7. 保留的安全审计记录只能最小化、匿名化并遵守已公开的保留政策；
8. 外部服务暂时不可用时，账户仍先被禁用，并明确重试清理任务。

#### 验收

- Email 注册/登录、Apple 登录、退出、token 刷新和密码重置均有成功与失败测试；
- Apple 登录不能使用未验证的客户端 user ID；
- 删除账户后旧 access/refresh token 全部失效；
- 被删除用户不能再次通过旧 Apple/Email session 恢复账户；
- App 内删除入口最多从 Settings 两次点击可达。

### F2. Strava OAuth 2.0 只读集成

#### 用户功能

- Profile > Connected Apps 中有 Connect Strava；
- 使用系统安全认证会话完成 OAuth；
- 只请求 `read,activity:read`；
- 连接后显示状态、Strava athlete name、最近同步时间；
- 用户 Profile 显示最近 10–20 条 Strava 活动摘要；
- 支持 Pull to Refresh 或显式 Refresh；
- 提供 Disconnect Strava，并在确认后撤销 token 和删除本地连接数据。

#### OAuth 流程

1. iOS 调用 `POST /v1/integrations/strava/start`；
2. 后端生成一次性 `state`，绑定当前用户并返回授权 URL；
3. iOS 使用 `ASWebAuthenticationSession` 打开授权 URL；
4. Strava 回调到后端固定 HTTPS callback；
5. 后端校验 `state`，用 authorization code + server-side secret 换 token；
6. 后端检查用户实际授予的 scopes，缺少 `activity:read` 时连接失败并给出明确提示；
7. token 加密保存，后端拉取活动并缓存规范化摘要；
8. 后端通过 Universal Link 或 `lauver://oauth/strava` 返回 App；
9. App 重新请求连接状态和最近活动。

#### 数据边界

- 禁止申请 `activity:write`、`activity:read_all` 或 `profile:write`；
- 客户端不得包含 Strava client secret、access token 或 refresh token；
- Profile 只展示标题、运动、开始时间、时长、距离等摘要；
- 不保存或公开 Strava GPS 路线、隐私区、起终点和原始 payload；
- access token 过期时由后端刷新，并始终保存 Strava 返回的最新 refresh token；
- 断开时使用 Strava 当前推荐的 revoke endpoint，并清除加密 token。

#### 验收

- 搜索 Xcode project、IPA strings 和 git history 均找不到 Strava secret；
- scope 请求和实际授权检查均为 `read,activity:read`；
- token 过期后活动仍可刷新；
- Disconnect 后刷新接口返回 disconnected，旧 token 不再可用；
- Strava 拒绝授权、回调 state 不匹配和 refresh 失败均有可理解的 UI。

### F3. 可选 HealthKit Workout Import

#### 用户体验

- 首次启动、注册和登录时不弹 HealthKit 权限；
- 只在 Profile > Connected Apps 用户主动点击 Enable Apple Health 后解释用途并请求权限；
- 用户跳过或拒绝后，Discover、Chat、Events 等功能不受影响；
- 用户可手动 Import Workouts 和 Disconnect；
- Disconnect 页面说明系统权限需要在 iOS Settings / Health 中管理。

#### 数据范围

- HealthKit 配置为 read-only，`toShare` 为空；
- 只读取 `HKWorkoutType` 及展示摘要所需的最少类型；
- 导入字段限定为 workout UUID、运动类型、开始/结束时间、时长、距离和能量摘要；
- 不读取心率、睡眠、医疗记录或 Workout Route；
- 使用 HealthKit workout UUID 做幂等去重；
- HealthKit 导入默认仅自己可见，不自动成为 Discover 的配速数据；
- 用户可删除已导入的 HealthKit 数据。

#### 验收

- 未授权设备和无 HealthKit 设备不会崩溃；
- 未点击 Enable 前不调用授权 API；
- 拒绝权限后无循环提示、无功能封锁；
- 相同 Workout 重复导入不会生成重复记录；
- Info.plist purpose string 与实际“只读 Workout 摘要”一致。
- Step 9 真机验收：已完成 Apple Health 授权并成功导入 Workout 摘要。
- Step 9 完整验收：连续导入不会重复，Delete Imported Data 删除成功。

### F4. Editable Workout Profile

#### 字段

- Display name；
- Profile photo；
- Bio（短文本）；
- Sports tags（多选）；
- 每个运动可填写可选的自报 pace；
- Pace unit 随运动变化，例如 running `min/km`、cycling `km/h`、swimming `min/100m`；
- Preferred training times：weekday + morning / midday / evening；
- City-level location；
- 是否公开最近 Strava 活动。

#### 位置隐私

- 用户通过 MapKit 搜索并选择城市；
- 后端只保存城市名称、country/region code 和城市中心点；
- Discover 用城市中心点计算近似距离；
- API 不向其他用户返回经纬度，只返回城市和近似距离；
- 不要求持续定位或精确 GPS 权限；
- Event venue 是用户明确选择的公开活动地点，与 Profile 城市数据分开保存。

#### 照片

- 使用 `PhotosPicker`，允许裁剪和压缩；
- 后端签发上传 URL 或接收 multipart upload；
- 文件放 S3-compatible object storage，不能放 Render 临时文件系统；
- 只允许 JPEG/HEIC/PNG，验证 MIME、尺寸和文件大小；
- 更新或删除头像时清理旧对象。

#### 验收

- Profile 可保存、重新打开并正确回填；
- pace 对不同运动使用正确单位与输入校验；
- 其他用户永远拿不到 Profile 的经纬度；
- 空资料不会进入 Discover，UI 明确提示缺少的必填项。

### F5. Discover：普通筛选列表

#### 页面要求

- 使用可滚动用户列表，不使用卡片堆叠；
- 每行展示头像、姓名、城市、近似距离、共同运动和自报 pace；
- Filter Sheet 支持 Sport、Radius 和用户填写的实际 Pace Range（2026-09-13 按真机反馈改为数值范围）；
- Radius 选项：5 / 10 / 20 / 25 / 30 / 40 / 50 / 60 / 70 / 80 / 90 / 100 km 和 Unlimited（不限距离）；2026-09-13 按真机验收反馈扩展；
- 支持分页和下拉刷新；
- 点击列表项进入完整 Profile；
- Profile 上提供 Message、Block 和 Report。

#### 确定性过滤规则

服务端 SQL 只执行以下逻辑：

1. 排除自己、已删除/暂停账户和资料未完成用户；
2. 排除任一方向存在 Block 的用户；
3. 按选定 sport 做精确 tag 匹配；
4. 用两个城市中心点的 Haversine 距离过滤 radius；
5. 直接对用户自报 pace 数值做闭区间过滤，允许只填一端；跑步等用 mm:ss，骑车用 km/h，游泳用 mm:ss/100m、划船用 mm:ss/500m；不使用 Fast/Slow/Easy 等主观分档；
6. 固定按近似距离升序、profile 更新时间降序、user ID 排序；
7. 使用 cursor pagination，保证结果稳定。

严禁根据用户行为学习排序，严禁生成兼容度分数，严禁出现 “Recommended for you”“AI match” 或百分比匹配文案。

#### 验收

- 同一数据和筛选参数始终返回相同顺序；
- Block 后双方立即从彼此 Discover 中消失；
- 没有 sport/pace 的资料不会错误进入对应筛选结果；
- UI 和数据库都不存在 Like、Swipe、Match 概念。

### F6. 一对一私聊、Block 与 Report

#### Messaging

- 使用 Stream Chat Swift SDK；
- Node 后端用 Stream server SDK 创建短期 user token；
- iOS 只能向已认证后端请求属于自己的 Stream token；
- Direct Chat 使用 deterministic channel ID 或后端唯一约束，两个用户之间只有一个 channel；
- Channel type 使用 private `messaging`，成员只包含双方；
- 支持文本消息、会话列表、未读数、发送状态和基础错误重试；
- MVP 不要求图片、语音、视频、已读回执或 Push Notification。

#### Block

- Chat header 和 Profile 都可 Block；
- Block 后不能创建新私聊、不能继续发送消息、双方从 Discover 隐藏；
- iOS 同时调用 Stream block 能力，后端 `blocks` 表作为最终事实来源；
- Unblock 位于 Settings > Blocked Users；
- 解除拉黑不会自动恢复旧对话入口。

#### Report

- Chat 中 Report 可选择用户或具体消息；
- 报告包含原因、可选说明、目标 ID、最近消息 ID 和不可变快照；
- Report 提交不等于自动拉黑，UI 提供 “Report and Block” 明确选项；
- 举报成功后显示 reference ID。

#### 验收

- Stream secret 只在后端；
- 伪造其他 user ID 请求 token 必须返回 403；
- 非 channel member 不能读写 channel；
- Block 前已打开的聊天也不能继续发送；
- Profile 和 Chat 均能完成举报。

### F7. Public Workout Meet-up Events

#### 创建活动

- 字段：title、sport、description、start time、duration、capacity、venue、city、coordinates、creator；
- 使用 MapKit / `MKLocalSearchCompleter` 搜索 Apple Maps 地点；
- 创建者确认公开展示的 venue 和地图 pin；
- 创建者自动成为 attendee 和活动群聊成员；
- 创建者可编辑或取消自己的活动。

#### 浏览与加入

- Events Tab 提供 Upcoming 列表；
- 支持按 sport、city/radius、date 筛选；
- Event Detail 展示主办者、时间、地点、人数、描述和 Report；
- 用户可 Join / Leave；
- 达到 capacity 后不可加入；
- 已取消、已结束和已满活动有明确状态；
- 加入和人数更新必须由后端事务控制，不能相信客户端计数。

#### Attendee Group Chat

- 每个 Event 对应一个 Stream private group channel；
- 只有当前 attendee 和 creator 是 channel members；
- Join 成功后由后端加入 Stream channel；
- Leave、被移除、活动取消或用户被暂停后由后端移除；
- Event 删除失败或 Stream 调用失败时要回滚或进入可重试状态，不能让 DB 与 Stream 长期不一致；
- 群聊支持文本、成员列表、Block 和 Report。

#### 验收

- 并发加入不能突破 capacity；
- 未参加用户不能访问 event channel；
- Leave 后 token 仍有效也不能继续访问已退出的 channel；
- Event Detail 和 group chat 均有 Report；
- Apple Maps pin 与保存地点一致。

### F8. Safety 与 Admin Report Dashboard

#### 用户侧举报入口

- Other User Profile：Report User；
- Direct Chat / Event Chat：Report User、Report Message；
- Event Detail：Report Event；
- 所有举报至少提供 spam、harassment、hate/abuse、unsafe event、impersonation、other 分类；
- 举报接口有 rate limit，但不能因重复目标而静默丢弃新证据。

#### 后台 Dashboard

- Express 后端提供独立 `/admin` 页面，不放在 iOS App；
- 管理员账户不允许公开注册；
- 使用安全的 httpOnly、secure、sameSite cookie 和 CSRF 防护；
- Report Queue 支持 Open / In Review / Resolved / Dismissed；
- 显示举报者、目标、类别、时间、说明、消息/活动快照和历史举报数量；
- 可执行：写审核备注、暂停/恢复用户、下架活动、删除 Stream 消息、解决/驳回举报；
- 所有管理员操作写入不可由普通管理员修改的 `admin_audit_logs`；
- 管理员不能在页面中看到 Strava/Apple/Stream secrets 或完整 OAuth token。

#### 验收

- Profile、Chat、Event 三类举报都进入同一个队列；
- 普通用户访问 `/admin` 返回 403；
- 每次状态或处罚变更都有 actor、timestamp 和 reason；
- 暂停用户的 API、Stream token 和新 session 立即失效。

## 5. iOS 信息架构

### 未登录流程

1. Welcome；
2. Sign In；
3. Create Account；
4. Sign in with Apple；
5. Forgot / Reset Password；
6. Terms 和 Privacy Policy 使用系统浏览器打开现有网站页面。

### 登录后 Tab

1. **Discover**：筛选列表 → User Profile → Direct Chat；
2. **Events**：Upcoming list → Event Detail → Event Group Chat；
3. **Messages**：Direct/Event conversations；
4. **Profile**：自己的资料、最近活动、编辑资料；
5. Profile 右上角进入 **Settings**。

### Settings

- Account；
- Connected Apps：Strava、Apple Health；
- Blocked Users；
- Privacy Policy / Terms；
- Sign Out；
- Delete Account。

Settings 中不得出现 Garmin、AI、Premium 或 Subscription。

## 6. 技术架构

### 6.1 Native iOS

- Swift + SwiftUI；
- `async/await` 和 `URLSession` 访问 REST API；
- `AuthenticationServices`：Sign in with Apple、Strava Web Authentication；
- `HealthKit`：用户主动开启的只读 Workout import；
- `MapKit`：城市和 Event venue 搜索、Event 地图；
- `PhotosUI`：Profile photo；
- Stream Chat Swift SDK：Direct Chat 与 Event Group Chat；
- Keychain：access/refresh token；
- XCTest：domain/network 单元测试；
- XCUITest：关键用户路径。

推荐模块结构：

```text
LauverNative/
  Lauver.xcodeproj
  Lauver/
    App/
    Core/
      API/
      Auth/
      DesignSystem/
      Models/
      Storage/
    Features/
      Authentication/
      Discover/
      Events/
      Messaging/
      Profile/
      Settings/
      Safety/
    Integrations/
      AppleHealth/
      AppleMaps/
      SignInApple/
      Strava/
      StreamChat/
  LauverTests/
  LauverUITests/
```

当前仓库 `.gitignore` 忽略根目录 `/ios`，因此原生项目应放在 `LauverNative/`，或在创建项目时同步修改 `.gitignore`，确保完整 Xcode project 被提交。

### 6.2 Backend

- Node.js 当前 LTS，版本通过 `.node-version` 和 `package.json engines` 固定；
- TypeScript + Express REST API；
- PostgreSQL（Render Postgres）；
- Prisma schema 和 migration；
- Zod 请求/环境变量验证；
- Argon2id 密码哈希；
- JWT access token + rotating refresh session；
- Stream server SDK；
- S3-compatible object storage 保存头像；
- Pino structured logging；
- Helmet、CORS allowlist、request ID、rate limiting；
- Vitest/Jest + Supertest；
- `/healthz` 和 `/readyz`；
- `render.yaml` 描述 Web Service、Postgres、build/start/health check。

推荐结构：

```text
backend/
  src/
    app.ts
    server.ts
    config/
    middleware/
    modules/
      admin/
      auth/
      blocks/
      chat/
      discover/
      events/
      healthkit/
      profiles/
      reports/
      strava/
    services/
      apple/
      objectStorage/
      stream/
  prisma/
    schema.prisma
    migrations/
    seed.ts
  tests/
  render.yaml
  Dockerfile
  .env.example
```

### 6.3 Secrets

以下值只能存在于本机未提交 `.env` 或 Render Secret Environment Variables：

- `DATABASE_URL`；
- JWT signing / encryption keys；
- Apple Team ID、Key ID、private key；
- Strava client secret；
- Stream API secret；
- Object storage secret；
- Email provider secret；
- Admin bootstrap secret。

iOS 可包含的只有公开配置，例如 API base URL、Apple bundle/client ID、Strava client ID（即使公开，也由后端构建授权 URL）和 Stream API key。任何 `*_SECRET`、private key、数据库 URL 都不得进入 Xcode build settings。

## 7. 数据模型

以下是 MVP 最小实体，不是最终 SQL：

| Entity | 关键字段与约束 |
|---|---|
| `users` | id, email, display_name, bio, photo_key, city_name, region_code, country_code, city_lat, city_lng, status, deleted_at |
| `auth_identities` | user_id, provider(email/apple), provider_subject；provider + subject 唯一 |
| `password_credentials` | user_id, argon2_hash, updated_at |
| `sessions` | user_id, refresh_token_hash, expires_at, revoked_at, device metadata |
| `email_tokens` | user_id, purpose(reset/verify), token_hash, expires_at, used_at |
| `user_sports` | user_id, sport, pace_value, pace_unit；user + sport 唯一 |
| `training_times` | user_id, weekday, time_bucket；组合唯一 |
| `oauth_connections` | user_id, provider, encrypted access/refresh token, scopes, expires_at, last_sync_at |
| `activities` | user_id, source(strava/healthkit), external_id, sport, title, starts_at, duration, distance, energy, visibility；来源 ID 幂等唯一 |
| `blocks` | blocker_id, blocked_id, created_at；方向唯一，禁止自己拉黑自己 |
| `chat_channels` | stream_cid, type(direct/event), direct pair 或 event_id；唯一约束 |
| `events` | creator_id, title, sport, description, starts_at, duration, capacity, venue, city, lat, lng, status |
| `event_attendees` | event_id, user_id, role, joined_at；组合唯一 |
| `reports` | reporter_id, target_type, target_id, category, detail, evidence_snapshot, status, assigned_admin_id |
| `admin_users` | user_id, role, active |
| `admin_audit_logs` | admin_id, action, target_type, target_id, before/after snapshot, reason, created_at |

关键数据库约束：

- Direct Chat 的两个 user ID 排序后唯一；
- Event attendee 数量在数据库事务中检查 capacity；
- Block、Report、Join/Leave 均由认证用户身份派生，不接受客户端伪造 `user_id`；
- 所有删除默认优先 hard delete；为安全审核必须保留的内容使用匿名化 snapshot；
- OAuth token 使用 AES-256-GCM 等 authenticated encryption，密钥与数据库分离。

## 8. REST API 契约

所有用户接口位于 `/v1`，除注册、登录、OAuth callback 和健康检查外均要求 Bearer access token。请求中的用户身份只从 token 获取。

### Auth / Account

```text
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/apple
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/password/forgot
POST   /v1/auth/password/reset
DELETE /v1/account
```

### Profile / Discover / Photo

```text
GET    /v1/me
PATCH  /v1/me
GET    /v1/users/:userId
GET    /v1/users/:userId/activities?limit=10
POST   /v1/me/photo/upload-url
DELETE /v1/me/photo
GET    /v1/discover?sport=&radius=&paceMin=&paceMax=&cursor=
```

### Strava / HealthKit

```text
POST   /v1/integrations/strava/start
GET    /v1/integrations/strava/callback
GET    /v1/integrations/strava/status
POST   /v1/integrations/strava/sync
DELETE /v1/integrations/strava
POST   /v1/integrations/healthkit/workouts/import
DELETE /v1/integrations/healthkit/workouts
```

### Chat

```text
POST   /v1/chat/token
POST   /v1/chats/direct/:otherUserId
GET    /v1/chats/:channelId/access
```

实际消息通过 Stream SDK 传输；Express 负责认证、token、channel 建立、成员权限和安全动作。

### Events

```text
GET    /v1/events?sport=&radiusKm=&date=&cursor=
POST   /v1/events
GET    /v1/events/:eventId
PATCH  /v1/events/:eventId
DELETE /v1/events/:eventId
POST   /v1/events/:eventId/join
DELETE /v1/events/:eventId/join
```

### Safety / Admin

```text
POST   /v1/blocks/:userId
DELETE /v1/blocks/:userId
GET    /v1/blocks
POST   /v1/reports

GET    /admin
GET    /admin/reports
GET    /admin/reports/:reportId
PATCH  /admin/reports/:reportId
POST   /admin/users/:userId/suspend
POST   /admin/users/:userId/restore
POST   /admin/events/:eventId/remove
POST   /admin/messages/:messageId/remove
```

## 9. 安全、隐私与合规要求

### 通用安全

- 全站 HTTPS；
- 所有输入使用 Zod allowlist 校验；
- 登录、重置密码、举报、建群和上传接口 rate limit；
- Authorization 不能使用客户端传来的 user ID；
- 防止 IDOR：Profile、Event、Report、Channel 每个资源都做服务端权限检查；
- 日志自动脱敏 password、authorization code、JWT、OAuth token 和 HealthKit payload；
- 错误响应不返回 stack trace 或第三方 secret；
- 上传文件校验内容而不只相信扩展名；
- 依赖 lockfile、自动安全扫描和 secret scanning；
- Staging 与 Production 使用独立数据库、Stream App、Strava App 和 secrets。

### Privacy

- 发布可访问的 Privacy Policy 和 Terms URL；
- App Store privacy answers 与实际收集的数据一致；
- HealthKit 数据不用于广告、用户画像或 Discover 排序；
- Profile 只公开城市级位置；
- Event 精确地点由创建者明确选择并确认公开；
- Strava / HealthKit 数据最小化，不保存路线和原始 payload；
- 用户可撤销集成、删除导入数据和永久删除账户。

### Apple Review

- 账户删除入口位于 App 内；
- 删除是永久删除而不是仅 Deactivate；
- Sign in with Apple 用户删除账户时撤销 Apple token；
- Profile、Chat、Event 均可举报；
- 用户可拉黑其他用户；
- HealthKit 权限必须由用户主动触发，purpose string 准确；
- App Review demo account、审核说明和后端 staging 环境保持可用。

## 10. Implementation Plan：逐步实现与可测试交付物

### 10.1 执行规则

每个 Step 都必须交付以下四类证据，缺少任意一项不能进入下一步：

1. **可运行代码**：不是截图、静态 Mock 或无行为按钮；
2. **自动化测试**：覆盖该 Step 的正常路径、失败路径和权限边界；
3. **人工验收记录**：写入 `artifacts/acceptance/step-XX.md`，包含环境、测试账号、操作步骤和结果；
4. **配置文档**：新增环境变量、第三方后台配置和 migration 必须同步更新 `.env.example` 与 README。

通用测试命令在项目建立后统一为：

```bash
# Backend
cd backend
npm run lint
npm run typecheck
npm test
npm run test:integration

# iOS；SIMULATOR_UDID 由本机 xcrun simctl list devices 获取
xcodebuild test \
  -project LauverNative/Lauver.xcodeproj \
  -scheme Lauver-Staging \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID"
```

涉及 Sign in with Apple、Strava、HealthKit、Stream Realtime 或 TestFlight 的 Step，不能只用 Mock 标记完成；自动化测试通过后还必须在 staging 第三方项目或真实 iPhone 上完成对应人工验收。

**UI 执行规则：** 从 Step 06 验收后开始整理 Expo 参考截图与设计 token；后续每个包含用户页面的 Step 同步落实视觉对齐，并将页面截图和差异记录写入对应验收文档。Step 00–06 已通过的功能验收保持有效，已有页面的视觉对齐纳入 Step 14A。Step 14A 在 Step 15 前统一收口，不能将全部 UI 优化推迟到发布阶段。

### 10.2 Step 与需求追踪

| Step | 可验收增量 | 对应需求 |
|---|---|---|
| 00 | 范围护栏与仓库骨架 | Hard restrictions、Deliverables |
| 01 | 可部署的 Express/Postgres 基础 | Backend、Render |
| 02 | 可运行的原生 iOS Shell | Native iOS、Navigation |
| 03 | Email/Password 完整登录闭环 | F1 |
| 04 | Sign in with Apple 登录闭环 | F1 |
| 05 | Workout Profile、头像、城市 | F4 |
| 06 | 普通列表式 Discover | F5 |
| 07 | Block / Report 安全基础 | F6、F8 |
| 08 | Strava 只读集成 | F2 |
| 09 | 可选 HealthKit 导入 | F3 |
| 10 | Stream 一对一私聊 | F6 |
| 11 | Public Events 与 Apple Maps | F7 |
| 12 | Event Attendee Group Chat | F7 |
| 13 | Admin Report Dashboard | F8 |
| 14 | 账户删除全链路 | F1、Apple compliance |
| 14A | 按 Expo 参考版本对齐原生 UI 与真机体验 | F1–F8 用户页面、UI quality |
| 15 | Release hardening 与交付 | Definition of Done |

### Step 00：范围护栏与仓库骨架

**状态：✅ 已完成（2026-09-01）。** 本地验收与 GitHub Actions 均已通过，证据见 `artifacts/acceptance/step-00.md`。

**依赖：** 无。

**实现任务：**

1. 创建 `LauverNative/Lauver.xcodeproj`、`backend/`、`artifacts/acceptance/` 和根 README；
2. 修正 `.gitignore`，确保完整 Xcode project 会被提交；
3. 建立 `Lauver-Staging` / `Lauver-Production` scheme 和后端 test/staging/production 环境；
4. 创建 `.env.example`、`.xcconfig.example`，真实值保持未跟踪；
5. 建立 CI，执行 Swift build/test、Backend lint/typecheck/test、secret scan；
6. 添加 `scripts/check-mvp-scope.sh`，只扫描产品源码和 UI 资源，禁止 AI、Garmin、Premium、IAP、Swipe/Match 功能依赖与面向用户文案；文档中的范围说明不参与扫描；
7. 建立最小 OpenAPI 文件，统一错误结构 `{ code, message, requestId, details? }`。

**可测试 Deliverable：**

- 一个能编译并显示 “Lauver” 空壳页面的原生 Swift App；
- 一个能启动并响应 `GET /healthz` 的 Express App；
- 首次 CI 绿色；
- scope guard script 和 secret scan 可执行。

**测试方法：**

1. 在禁用词测试 fixture 中加入 Garmin/AI SDK import，确认 scope guard 失败；删除 fixture 后确认通过；
2. 提交假 secret fixture，确认 secret scan 失败；
3. 在全新 clone 中执行 iOS build 和 `npm test`；
4. `curl http://localhost:3000/healthz` 应返回 `200 { "status": "ok" }`。

**通过标准：** 空项目可从零构建；CI 能阻止超范围代码和 secret；不依赖开发者机器上的未记录文件。

### Step 01：Express、PostgreSQL 与 Render 基础

**状态：✅ 已完成（2026-09-01）。** 实现、自动测试、Render staging 部署及重新部署后的数据库 readiness 均已验收；证据见 `artifacts/acceptance/step-01.md`。

**依赖：** Step 00。

**实现任务：**

1. 初始化 TypeScript Express、Zod config、Pino logging、Helmet、CORS allowlist、request ID 和统一错误处理；
2. 接入 Prisma 与 PostgreSQL，创建 migration 基础；
3. 增加 `/healthz`、`/readyz` 和 graceful shutdown；
4. 增加 test database，测试时从空库执行全部 migration；
5. 创建 Dockerfile、`render.yaml` 和 Render staging Web Service/Postgres；
6. 服务监听 `0.0.0.0:$PORT`，README 写明本地与 Render 部署方法。

**可测试 Deliverable：**

- Render staging API URL；
- 可从空数据库执行的第一套 Prisma migration；
- 可查询数据库状态的 `/readyz`；
- 后端基础 integration test suite。

**测试方法：**

1. 删除 test database 后执行 `prisma migrate deploy`，必须成功；
2. 数据库正常时 `/readyz` 返回 200，断开数据库时返回 503；
3. 非 allowlist Origin 的 CORS preflight 被拒绝；
4. 未处理错误响应不包含 stack trace；
5. push staging branch 后 Render 自动部署，`curl https://<staging>/healthz` 返回 200。

**通过标准：** 任意开发者能按 README 从空库启动 API；Render 重启或重新部署后服务和数据库数据仍正常。

### Step 02：原生 iOS App Shell 与 API Client

**状态：✅ 已完成（2026-09-02）。** 原生 App Shell、API Client、Keychain、非敏感 UI 状态存储、Design System、Render staging 在线状态及完整 CI 回归均已验收；证据见 `artifacts/acceptance/step-02.md`。

**依赖：** Step 01。

**实现任务：**

1. 创建 SwiftUI App lifecycle、依赖注入容器和 staging/production config；
2. 建立 Auth flow 与登录后的 Discover、Events、Messages、Profile 四个 Tab 占位导航；
3. 实现基于 `URLSession` + `async/await` 的 API client；
4. 实现 Codable models、统一 API error、request ID 显示和网络重试边界；
5. 实现 Keychain adapter 和仅用于非敏感 UI 状态的本地存储；
6. 建立 Design System 最小 token、Loading、Empty、Error、Retry 组件。

**可测试 Deliverable：**

- 原生 App 可选择 staging config 启动；
- App 可请求 Render `/healthz` 并展示 online/offline 状态；
- API client、Keychain adapter 和四种基础状态组件的 XCTest。

**测试方法：**

1. 用 `URLProtocol` stub 验证 2xx、401、422、500、超时和无网络；
2. 将 API URL 指向不可达地址，UI 显示错误并可 Retry；
3. 把测试 token 写入 Keychain，重启 App 后能读取，退出测试后能删除；
4. XCUITest 验证四个 Tab 导航，不允许存在 Swipe/Match Tab。

**通过标准：** App 能稳定访问 staging API，错误不会导致崩溃，敏感 token 不写入 UserDefaults 或日志。

### Step 03：Email/Password Authentication

**状态：✅ 已完成（2026-09-06）。** 后端 migration/auth API、Resend reset delivery adapter、iOS Auth/Keychain flow、自动测试、Render staging 配置和真实邮件重置闭环均已通过；准确证据见 `artifacts/acceptance/step-03.md`。

**依赖：** Step 01、Step 02。

**实现任务：**

1. 创建 `users`、`auth_identities`、`password_credentials`、`sessions` 和 `email_tokens` migration；
2. 实现 register、login、refresh rotation、logout、forgot/reset password；
3. Password 使用 Argon2id，refresh token 仅保存哈希；
4. iOS 实现 Register、Login、Forgot Password、Reset Result 和 session restore；
5. Access/refresh token 只保存 Keychain；
6. 对 register/login/reset 加 rate limit 和统一的防账号枚举响应。

**可测试 Deliverable：**

- 一个用户可以用 Email/Password 注册、退出、重新登录并恢复 session；
- 用户可完成密码重置后使用新密码登录；
- Backend auth integration tests 和 iOS auth XCUITest。

**测试方法：**

1. 测试成功注册、重复邮箱、弱密码、错误密码和已暂停账户；
2. 同一 refresh token 使用两次，第二次必须失败并触发 session 风险处理；
3. 数据库和日志中搜索原始密码与完整 refresh token，结果必须为空；
4. 删除 App Keychain token 后自动回到 Login；
5. XCUITest 跑通 Register → authenticated shell → Sign Out → Login。

**通过标准：** Email auth 的成功、失败、恢复和撤销路径均可重复测试，认证身份不能由请求体中的 user ID 冒充。

### Step 04：Sign in with Apple

**状态：✅ 已完成（2026-09-10）。** 原生 capability、AuthenticationServices + nonce、后端 JWKS/token exchange、加密 refresh token、账户关联和撤销检查均已交付；PostgreSQL CI、Apple Developer / Render staging 配置、signed archive secret audit，以及 iPhone 上的首次登录、再次登录和授权撤销闭环均已通过。完整证据见 `artifacts/acceptance/step-04.md`。

**依赖：** Step 03；Apple Developer staging 配置。

**实现任务：**

1. 配置 Sign in with Apple capability、App ID、Key ID 和 staging callback；
2. iOS 使用 `ASAuthorizationAppleIDButton`、nonce 和 `AuthenticationServices`；
3. 后端拉取/缓存 Apple JWKS，验证 identity token 的签名、issuer、audience、nonce、expiry；
4. 后端用 authorization code 换取并加密保存 Apple refresh token；
5. 首次登录立即保存 Apple 只返回一次的 name/email；
6. 将 Apple identity 关联到已有或新 Lauver 用户，避免重复账户；
7. 监听/检查 credential revoked 状态并清理本地 session。

**可测试 Deliverable：**

- 真实 iPhone 上 Sign in with Apple 可创建账户并再次登录；
- 后端 Apple token verification tests；
- 一个 FakeAppleProvider 用于 CI 覆盖成功、过期、错误 audience、错误 nonce 和 revoked 场景。

**测试方法：**

1. 所有伪造或错误 claim token 返回 401；
2. 同一个 Apple subject 多次登录只对应一个 user；
3. 第二次 Apple 登录即使不再返回 name/email，资料仍保留；
4. 在真实 staging Apple 账户撤销授权后，App 下次检查会退出登录；
5. Xcode project、archive strings 和 git 中不存在 Apple private key。

**通过标准：** 真实 Apple 登录闭环通过，服务端不信任未经验证的 Apple user identifier，私钥只存在 Render。

### Step 05：Workout Profile、Photo 与 City Location

**状态：✅ 已完成（2026-09-13）。** 实现、真机 Profile/头像生命周期及重开持久化验收、最终提交 `10c8168` 的全部 CI jobs 均已通过。Render staging 已部署该提交，`python3 scripts/verify-step-05-staging.py` 的 33 项验收全部通过，覆盖两账户坐标隐私、头像重复确认、替换/删除清理、新会话持久化和非法文件拒绝；测试资料、头像和会话已清理。准确证据见 `artifacts/acceptance/step-05.md`。

**依赖：** Step 03；Step 04 可并行完成，但合并前两种登录都要支持 Profile。

**实现任务：**

1. 创建 Profile、`user_sports` 和 `training_times` migration；
2. 实现 `GET/PATCH /v1/me`、`GET /v1/users/:id`；
3. 实现 sports tags、各运动 pace value/unit/bracket 和训练时间；
4. 使用 MapKit 搜索城市，只向后端保存城市元数据和中心点；
5. 接入 S3-compatible object storage，完成头像签名上传、格式校验、替换和删除；
6. 实现 Edit Profile、Own Profile、Other Profile；
7. 定义 profile completeness，未完成资料不参与 Discover。

**可测试 Deliverable：**

- 用户可编辑并重新读取完整 Workout Profile；
- 用户可上传、更换和删除头像；
- 用户可用 Apple Maps 搜索城市，但其他用户 API 看不到经纬度；
- Profile API 和 iOS Profile tests。

**测试方法：**

1. 对每种运动测试正确 pace unit 和非法负数/极端值；
2. 上传伪装扩展名、超大文件和非图片，服务端必须拒绝；
3. 更换头像后旧 object key 被删除；
4. `GET /v1/users/:id` 的响应 contract 明确不含 `city_lat/city_lng`；
5. XCUITest：编辑 → 保存 → kill App → 重开 → 字段仍一致。
6. 分别模拟申请上传地址、PUT 上传和确认保存时返回 `-1005`，验证有限重试；确认成功但响应丢失后，重复确认返回同一头像，不生成额外最终对象；取消和 HTTP 错误不触发连接重试。

**通过标准：** Profile 数据可持久化、照片无孤儿对象、位置只公开城市和近似信息。

### Step 06：Discover 手动筛选列表

**状态：✅ 验收通过（2026-09-13）。** 新版 Render staging API **62/62** 通过；用户明确确认真机实际 API 的 Discover 列表 → Profile、100 km / Unlimited、Running 数值配速范围、下拉刷新、分页加载及最终 Load more 消失、断网提示与恢复网络后的 Retry 均正常。新版实现已提交、推送并部署，实际配速 migration 已应用，34 个新版 API 自动测试账户和后补 44 个临时分页账户全部清理；独立核对本批残留为 0，清理 journal 已删除，完整 ACTIVE Profile 恢复为原有 3 个。Backend unit 123/123、PostgreSQL integration 28/28、iPhone 14 Plus XCTest 75/75 与数值范围/半径 XCUITest 1/1、Simulator UI、Profile editor UI、双环境构建及范围/secret 检查通过。实现提交 `10bd58d` 的完整云端 CI 也通过（XCTest 75/75、XCUITest 12/12）；已修复空输入框断言在 iOS 18/26 的差异及既有密码重置测试的点击焦点问题。实际 Render 部署 `594030b` 仅额外新增部署文档。最后一轮实际 API 默认 20 条分页遍历 3 页无重复遗漏，Discover XCTest 8/8 复验通过。准确证据见 `artifacts/acceptance/step-06.md`。

**依赖：** Step 05。

**实现任务：**

1. 实现 sport、radius、paceMin/paceMax 数值范围参数校验（范围必须指定 sport、下限不得大于上限）；
2. 使用城市中心点 Haversine 距离和确定性 SQL 过滤；
3. 排除自己、未完成、暂停、删除以及任一方向已 Block 的用户；
4. 实现固定排序和 cursor pagination；
5. SwiftUI 构建普通 List、Filter Sheet、Profile navigation、空状态和刷新；
6. 在 UI、数据模型和数据库确认没有 Like、Swipe、Match。

**可测试 Deliverable：**

- `GET /v1/discover` 可按三种条件独立和组合筛选；
- Discover 原生列表与筛选 Sheet；
- 固定 seed dataset 和可重复的 query integration tests。

**测试方法：**

1. 给定固定 seed，同一请求执行 10 次顺序完全一致；
2. 分页前后不重复、不漏用户；
3. 测试半径边界内、恰好边界、边界外；
4. 缺 pace 的用户不会进入指定数值范围，准确包含 mm:ss / km/h 范围的两端；
5. XCUITest 验证列表 → Profile，且不存在卡片滑动手势与 Like 按钮。

**通过标准：** Discover 是完全可解释、稳定、零 AI 的过滤列表，返回数据不泄露精确位置。

### Step 07：Block 与 Report 安全基础

**状态：✅ 验收通过，完整 CI 已闭环（2026-09-13）。** 后端双向 Block / Profile 隔离、blocked users 分页、普通举报与原子 Report and Block、不可变快照/reference/audit 全部交付。Backend unit 129/129、隔离 PostgreSQL integration 37/37、staging 实际 API 34/34 与手机操作通过；额外实际 API 双向隔离 4/4 通过。用户逐项确认普通举报不自动拉黑、取消/确认拉黑、B 也看不到 A、Settings 解除恢复 Discover、Report and Block、断网失败后的联网恢复及过期后刷新。真机发现的 session 刷新竞态已修复并重新安装；云端确认手机 session rotation 成功且未撤销。独立手机 run 的 3 个账号、3 条举报、6 条安全审计与依赖数据全部清理，独立残留核对为 0，旧 access/refresh 返回 401，私人凭据与 journal 已删除。提交 `20fd09f` 的手动/自动部署均通过；原生 session 修复 `05ee272` 及 UI 交互修复 `d38c9a5`、`33aaf3f` 已推送。最终源码 `33aaf3f` 的完整云端 CI 全部通过：Backend、guardrails、XCTest 88/88、完整 UI 14/14 与 staging/production 构建配置检查；此前超时中断及部分通过仅保留为历史记录。完整证据见 `artifacts/acceptance/step-07.md`；全部页面视觉签收仍按 Step 14A 执行。

**依赖：** Step 05、Step 06。

**实现任务：**

1. 创建 `blocks`、`reports` 和 report evidence snapshot migration；
2. 实现 block/unblock/list blocked users；
3. 实现通用 `POST /v1/reports`，先支持 User Profile 举报；
4. 在 Other Profile 添加 Block、Report、Report and Block；
5. 在所有用户查询建立共享 block policy；
6. 对 Block/Report 接口加权限校验、rate limit 和 request audit metadata。

**可测试 Deliverable：**

- Other Profile 的 Block / Report 可用；
- Settings > Blocked Users 可查看和解除；
- Report 会生成 reference ID 和不可变目标快照；
- 双向 Discover 隔离测试。

**测试方法：**

1. A block B 后，A 与 B 都不能在 Discover 找到对方；
2. B 不能通过直接 Profile API 绕过 block 读取 A 的公开资料；
3. 重复 block 幂等，自己 block 自己返回 422；
4. Report target 不存在或 target type 不合法时拒绝；
5. 修改被举报 Profile 后，report snapshot 仍保留提交时内容。

**通过标准：** Block 是后端强制策略而不只是客户端隐藏；Profile 举报已进入可审核的数据队列。

### Step 08：Strava OAuth 2.0 只读集成

**状态：🟢 功能验收完成（2026-09-14）；发布加固待完成。** 已实现一次性 state、只读 OAuth、加密 token、自动轮换、最近 20 条摘要、推荐 revoke 与失败重试，以及原生 Connected Apps / Profile 活动列表。Backend unit 142/142、隔离 PostgreSQL integration 54/54、iPhone XCTest 100/100（含 Strava 用例）通过。用户的 Strava staging application 和全部 Render 配置已确认部署；线上 healthz/readyz 200。真实 iPhone 授权、两次同步（20 条摘要、仅 `read,activity:read`）、强制过期刷新、SQL 幂等、真机撤销（旧 token 401）、OAuth state 拒绝和测试账户清理均已通过；用户确认 Connected Apps 与 Profile 页面显示正常。Staging/Production 构建、未签名 staging archive、原生目录/archive/Git history 的真实 token/key 扫描通过。Step 08 剩余事项归入发布加固：正式签名 IPA 与 Render-only Client Secret 扫描、最新改动云端 iOS CI（提交 `e0a5797` 曾 exit 65）以及 Step 14A 完整逐页 UI 证据。测试账户和私人登录文件已清理。证据见 `artifacts/acceptance/step-08.md` 和 `artifacts/acceptance/step-08-real-connect-20260914.log`。

**依赖：** Step 03、Step 05；Strava staging application。

**实现任务：**

1. 创建 OAuth connection、OAuth state 和 activities migration；
2. 实现 start/callback/status/sync/disconnect API；
3. 后端构建只含 `read,activity:read` 的 authorization URL；
4. 验证一次性 state 和实际 granted scopes；
5. 服务端完成 code exchange、AES-GCM token storage、expiry refresh 和最新 refresh token 轮换；
6. 拉取并幂等缓存最近活动摘要，不保存 route/polyline/raw payload；
7. iOS 使用 `ASWebAuthenticationSession`，Profile 显示状态、活动、Refresh 和 Disconnect；
8. Disconnect 调用 Strava revoke 并清理连接 token。

**可测试 Deliverable：**

- 真实 Strava test athlete 可 Connect → 查看活动 → Refresh → Disconnect；
- Strava provider contract tests 和 API integration tests；
- Profile 最近活动列表与集成设置页；
- `artifacts/acceptance/step-08.md` 记录真实授权 scope 和撤销结果，但不记录 token。

**测试方法：**

1. state 缺失、过期、重复使用和用户不匹配均失败；
2. 用户取消 `activity:read` 时不能标记 connected；
3. 强制 access token 过期，下一次 sync 自动刷新并保存新 refresh token；
4. 同一 Strava activity 同步两次只有一条数据；
5. Disconnect 后旧 token 被撤销，API 状态为 disconnected；
6. 扫描 iOS archive 和 repo，Strava secret/用户 token 数量必须为零。

**通过标准：** 只读 scope、server-side secrets、刷新、幂等和撤销五个边界全部通过真实 staging 验收。

### Step 09：可选 HealthKit Workout Import

**状态：✅ 已完成（2026-09-14）。** 已加入 HealthKit read-only capability、准确 purpose string、完全 opt-in 的 Enable Apple Health 页面、手动 Import、不可用/拒绝/空结果状态，以及仅上传最小 workout 摘要的后端接口。后端 `health_workouts` migration 按用户和 HealthKit workout UUID 幂等 upsert，并提供本人可见的查询和删除接口。Backend lint、typecheck、production build、unit tests 142/142、iOS Staging Simulator build 与真实 iPhone 验收均通过；真实设备已完成授权、成功导入、重复导入不产生重复记录、Delete Imported Data 删除成功。证据见 `artifacts/acceptance/step-09.md`。

**依赖：** Step 05；真实 iPhone。

**实现任务：**

1. 添加 HealthKit capability 和准确的 read purpose string；
2. Connected Apps 中增加用户主动触发的 Enable Apple Health；
3. `toShare` 保持为空，只读取 Workout 和最少摘要字段；
4. 实现 availability、授权、query、手动 import、disconnect 与导入数据删除；
5. 以 HealthKit Workout UUID 做 server-side 幂等；
6. HealthKit activity 默认 private，不进入 Discover pace 计算；
7. 使用 protocol + fake store 让 CI 覆盖授权状态和 sample mapping。

**可测试 Deliverable：**

- 真实 iPhone 可主动授权并导入 Workout 摘要；
- 拒绝权限后 App 其他功能不受影响；
- HealthKit unit tests、API import idempotency tests 和真机验收记录。

**测试方法：**

1. 首次启动、注册、登录、进入 Profile 均不得自动弹权限；
2. 无 HealthKit 的环境返回 unavailable，不崩溃；
3. 拒绝、部分授权和空样本都有明确且不误导的 UI；
4. 同一 Workout 导入两次只保留一条；
5. Disconnect 不伪称撤销系统权限，Delete Imported Data 会清理服务器记录；
6. Network inspector 确认不上传心率、路线或原始 HealthKit payload。

**通过标准：** HealthKit 完全 opt-in、只读、数据最小化，拒绝授权不会形成阻塞或循环提示。

### Step 10：Stream 一对一私聊

**状态：✅ 已完成（2026-09-16）。** Stream server SDK、短期 token provider、canonical direct channel、Block/Report 策略、官方 iOS `StreamChatSwiftUI` SDK、Conversations、Direct Chat、文本发送、未读数、失败重试和消息举报均已完成。两台真机已完成实时互发、第三方隔离、Block 后禁止发送、消息举报证据保存，以及断网发送失败、恢复后重试且不重复发送验收。证据见 `artifacts/acceptance/step-10.md`。

**依赖：** Step 07；Stream staging application（API key、API secret 和 iOS SDK 配置）。

**实现任务：**

1. 后端接入 Stream server SDK，创建/同步 Stream user；
2. 实现认证后的短期 Stream token provider；
3. 创建 canonical user pair 和唯一 direct channel；
4. 创建 channel 前及发送期间执行 block policy；
5. iOS 接入 Stream Chat Swift SDK，实现 Conversations、Direct Chat、文本发送、未读数和错误重试；
6. Chat header 接入 Block、Report User、Report Message；
7. Report evidence 保存 Stream channel/message ID 和安全快照。

**可测试 Deliverable：**

- 两个 staging 用户可从 Profile 发起唯一私聊并实时收发文本；
- 第三个用户不可读写该 channel；
- Chat 内 Block / Report 可用；
- Stream token/channel authorization integration tests。

**测试方法：**

1. A 与 B 双向多次发起聊天只产生一个 channel；
2. 用 A 的 Lauver token 请求 B 的 Stream token 返回 403；
3. C 猜测 channel ID 也不能 watch/query/send；
4. A block B 后，已打开的 B Chat 发送失败，双方会话入口按策略隐藏；
5. Report Message 后即使 Stream 消息被删除，后台仍有最小 evidence snapshot；
6. iOS 断网发送显示失败状态，恢复后用户可重试且不重复发送。

**通过标准：** ✅ Realtime 文本、成员隔离、唯一会话、Block、Report 和断网恢复均通过两用户加攻击用户验收。

### Step 11：Public Events 与 Apple Maps

**状态：🟡 部分完成（2026-09-16）。** Events 数据模型、后端 CRUD、Upcoming 查询、sport/date/city/radius 筛选、分页、Join/Leave、容量事务保护、事件举报和 iOS Events 列表/详情、创建、编辑、取消、Apple Maps venue 搜索及当前位置选择已完成。设备 A 创建的活动已在设备 B 的 Upcoming 列表中真实显示；仍需在真机上完成编辑、取消、Join/Leave、地图和举报的逐项操作验收。

**依赖：** Step 05、Step 07。

**实现任务：**

1. ✅ 创建 events、event_attendees migration 和 capacity constraints；
2. ✅ 实现后端 Event CRUD、Upcoming filters、Join/Leave；
3. ✅ 使用 MapKit / `MKLocalSearchCompleter` 搜索并确认公开 venue；
4. ✅ Event list 支持 sport、date、city/radius 筛选和 cursor pagination；
5. ✅ Join 使用数据库事务与锁，creator 自动成为 attendee；
6. ✅ iOS 已实现 Event list、Detail、Create/Edit/Cancel、Join/Leave；
7. ✅ 后端及 iOS 已接入 Report Event 和 Report Organizer，并保存活动快照。

**可测试 Deliverable：**

- ✅ 后端和 iOS 用户可创建、浏览、编辑、取消、加入和退出公开活动；
- 🟡 Apple Maps 搜索结果已回填 venue 名称和坐标，真机地图一致性仍待手动确认；
- ✅ 并发安全的 capacity 单元测试与事务锁；
- Event Profile/Chat 尚未完成的部分不显示假入口。

**测试方法：**

1. 创建过去时间、capacity < 2、非法 venue 的请求被拒绝；
2. 对剩余一个名额并发发起多个 Join，最终 attendee 不超过 capacity；
3. 重复 Join/Leave 幂等，creator 不能意外退出自己仍在举办的活动；
4. 非 creator 不能 edit/cancel；
5. 取消活动从 Upcoming 消失，已有 attendee 能看到 cancelled 状态；
6. ✅ Report Event 进入 reports 表并保留活动快照；Report Event/Organizer iOS 入口已接入。

**当前完成范围：** Events 的后端 CRUD、筛选、人数、Join/Leave、事务容量保护、活动举报和 iOS 活动管理界面均已实现，由真实后端驱动且没有客户端自增人数。剩余工作是连接 staging 后在真机上逐项执行创建、编辑、取消、加入/退出、地图选择和举报验收。

### Step 12：Event Attendee Group Chat

**依赖：** Step 10、Step 11。

**实现任务：**

1. 每个 Event 创建唯一 private Stream channel；
2. Join 成功后添加成员，Leave/Remove/Cancel/Suspend 后移除成员；
3. Event Detail 只对当前 attendee 显示 Open Group Chat；
4. 实现 attendee group conversation、成员列表、文本发送；
5. Group Chat 接入 Block、Report User 和 Report Message；
6. 建立 DB/Stream 同步失败补偿和 reconciliation command；
7. 确保 Block 用户在共享 Event 中的显示和消息行为符合已记录的安全策略。

**可测试 Deliverable：**

- 加入 Event 的用户可进入群聊，未加入用户不可访问；
- Leave、Cancel、Suspend 后权限即时撤销；
- `npm run reconcile:stream-memberships -- --dry-run` 可发现 DB/Stream 差异；
- Event group chat E2E 和授权测试。

**测试方法：**

1. attendee、non-attendee、left attendee、suspended attendee 四种身份分别测试 query/watch/send；
2. 模拟 Stream add-member 失败，DB Join 不得悄悄显示完全成功；
3. 人工制造成员差异，reconciliation dry-run 能报告，正式模式能修复；
4. Event cancel 后所有普通成员失去 channel access；
5. Group Chat 举报能在后台数据中区分 event、channel 和 message。

**通过标准：** Event membership 是群聊权限的唯一来源，任何旧 token 或已打开页面都不能绕过退出/暂停状态。

### Step 13：Admin Report Dashboard

**依赖：** Step 07、Step 10、Step 11、Step 12。

**实现任务：**

1. 创建 `admin_users`、`admin_audit_logs` 和 report workflow migration；
2. 建立不可公开注册的 admin auth、安全 cookie、CSRF 和 role middleware；
3. 实现 Report Queue、筛选、Report Detail 和 evidence snapshot 展示；
4. 实现 Open → In Review → Resolved/Dismissed 状态流；
5. 实现暂停/恢复用户、下架活动、删除 Stream message；
6. 每个管理员动作记录 actor、reason、before/after 和 timestamp；
7. 暂停用户时撤销 Lauver sessions，并停止签发 Stream token。

**可测试 Deliverable：**

- `/admin` 可登录并处理来自 Profile、Direct Chat、Event、Event Chat 的举报；
- 管理动作会实际影响 API/Event/Stream；
- 完整 admin authorization、CSRF 和 audit integration tests。

**测试方法：**

1. 未登录、普通用户和被停用 admin 访问 `/admin` 均失败；
2. 缺 CSRF token 的写操作失败；
3. Report 状态非法跳转被拒绝；
4. Suspend 后用户现有 session 调 API 返回 401/403，不能获取 Stream token；
5. Remove Event 后活动不可加入；Delete Message 后 Stream 消息消失；
6. 每个动作对应且只对应一条完整 audit log，普通 admin 不能修改日志。

**通过标准：** 三个要求位置产生的举报都能被实际审核和处置，后台本身不存在明显越权入口。

### Step 14：账户删除全链路

**依赖：** Step 04、Step 05、Step 08、Step 09、Step 10、Step 12、Step 13。

**实现任务：**

1. Settings 添加易发现的 Delete Account 和二次确认/重新认证；
2. 后端建立 deletion orchestration 和幂等状态；
3. 立即禁用账户、撤销全部 Lauver sessions 和 Stream token 能力；
4. 调用 Apple revoke、Strava revoke、Stream delete/anonymize、object storage delete；
5. 删除 Profile、Sports、Activities、Blocks、Attendees 等个人数据；
6. 对用户创建的 Event 和 Report evidence 按 Privacy Policy 执行删除或不可逆匿名化；
7. 外部服务失败时记录最小 retry job，不恢复用户访问；
8. iOS 清空 Keychain、Stream local state 和缓存并返回 Login。

**可测试 Deliverable：**

- Email 用户和 Apple 用户都可在 App 内永久删除账户；
- 有/无 Strava、HealthKit、Chat、Event 数据的账户均有集成测试；
- 外部 provider fake 可验证 revoke/delete 调用次数和重试；
- staging 真实 Apple + Strava deletion 验收记录。

**测试方法：**

1. 删除 API 重复调用保持幂等，不产生孤立或重新激活数据；
2. 删除开始后所有 access/refresh/Stream token 立即失效；
3. 查询数据库、object storage 和 Stream，不能找到仍关联原 user ID 的普通个人数据；
4. Apple token 和 Strava token 确认已 revoke；
5. 模拟每个外部 provider 超时，用户仍被禁用，retry 最终成功；
6. 删除后 App 重启仍停留 Login，旧 Keychain token 不存在。

**通过标准：** 删除不是 Deactivate；不要求联系客服；内部数据、第三方授权和本地凭据全部进入可证明的清理闭环。

### Step 14A：UI 视觉对齐与体验优化（参照 Expo 版本）

**状态：🟡 已随 Step 07 启动设计基础，逐页视觉与真机验收待完成；必须在 Step 15 前通过。** 已参照 Expo 主题源码统一原生橙色强调与暖色浅深背景/卡片，并应用于安全流程；完整截图对比及 Product Owner UI 签收尚未完成。使用 14A 编号保留现有 Step 编号和验收记录。

**依赖：** Step 02；设计基础与已完成页面可立即开展，其余页面随 Step 07–14 实现同步推进，最终验收依赖 Step 00–14 全部通过。

**实现任务：**

1. 运行当前仓库的 `npx expo start` 版本，记录参考 commit、运行方式、设备尺寸和主题，逐页保存参考截图；结合 `App.js`、`src/screens/`、`src/context/ThemeContext.js` 与实际使用的资源梳理页面和样式，不以记忆或临时猜测作为设计依据；
2. 建立 Expo → SwiftUI 页面对应表，覆盖 Welcome、登录/注册/重置密码、Discover/筛选/其他用户资料、自己的 Profile/编辑资料、Events/活动详情/创建编辑、Messages/私聊/活动群聊、Settings/Connected Apps/Blocked Users/举报/删除账户；Expo 没有的 MVP 页面沿用统一设计语言；
3. 扩展原生 Design System，统一品牌色、浅深色背景与文字、字体层级、间距、圆角、边框、图标、头像、按钮、输入框、列表行、Tab Bar、导航栏和 Sheet。优先复用已有品牌资源，避免各页面分别硬编码样式；
4. 用 SwiftUI 逐页对齐参考版本的视觉层级与交互细节，包括按钮位置、表单反馈、筛选摘要、键盘避让、返回导航和滚动体验。保留原生认证、地图、照片与权限流程；Discover 继续使用普通列表和手动筛选；
5. 为真实数据、长姓名/城市/文案、无头像、加载、空状态、错误、断网重试、按钮禁用和提交中状态提供完整样式；页面中不暴露无助于用户决策的实现细节或调试信息；
6. 对比相同设备尺寸、主题和等价内容的 Expo / 原生截图，逐项修复明显差异；有意调整的页面记录原因。原生平台适配或 MVP 范围要求优先，不能为了视觉一致引入禁用入口或改变已验收业务规则；
7. 完成小屏和大屏 iPhone、浅色/深色、Dynamic Type 和 VoiceOver 检查；真机验证点击区域、键盘、滚动、导航与错误恢复，并复验受到 UI 改动影响的关键业务路径。

**可测试 Deliverable：**

- 统一且实际用于产品页面的 SwiftUI Design System；
- `artifacts/acceptance/step-14a.md`：逐页对应表、参考 commit、Expo / 原生对比截图、差异及原因、真机操作结果、问题修复记录和 Product Owner 验收结论；
- 对比截图保存在 `artifacts/acceptance/ui/`，使用不含个人隐私或凭据的测试内容；截图明确区分 Expo 参考与原生实现；
- 已完成的全部 MVP 用户页面，以及受影响路径的 XCTest / XCUITest 和 staging 真机回归证据。

**测试方法：**

1. 按页面对应表逐项对比品牌、配色、字体、间距、图标、布局和交互；每个页面都有结果，遗漏页面不能视为通过；
2. 检查小屏/大屏、浅色/深色和大字体下没有截断关键信息、布局重叠、键盘遮挡主要操作或不可点击的按钮；VoiceOver 能识别主要操作；
3. 验证加载/空/错误/成功和提交状态均有清晰反馈，断网恢复可重试，连续点击不会造成重复提交；
4. 对 UI 改动影响的登录、Profile 保存、Discover 筛选/分页、聊天、活动、举报/拉黑和账户删除执行回归；涉及真实 API 的路径使用 staging 验证；
5. Product Owner 在真机逐页验收，确认整体视觉符合 Expo 参考版本，已记录的原生适配与 MVP 差异可接受。

**通过标准：** 全部 MVP 用户页面视觉与体验验收完成，没有未修复的明显视觉差异或阻断操作的问题；差异有明确理由和验收结论，业务回归通过，并取得 Product Owner 的真机 UI 确认。仅功能通过或仅有静态截图不能签收本 Step。

### Step 15：Release Hardening、TestFlight 与最终交付

**依赖：** Step 00–14 和 Step 14A 全部通过。

**实现任务：**

1. 运行完整 Backend unit/integration/authorization/migration-from-zero suite；
2. 运行 iOS XCTest/XCUITest，真实设备验证 Apple、Strava、HealthKit 和 Stream；
3. 复验 Step 14A 已完成的 UI 对齐，以及 Dynamic Type、VoiceOver、Dark Mode、无网络、慢网络和错误恢复；
4. 完成 Privacy Policy、Terms、App Privacy、purpose strings 和 Review Notes；
5. 从全新 Render project 按 README 部署 staging，验证所有 secret 和 migration；
6. Archive App，扫描 IPA strings、entitlements、network endpoints 和 secrets；
7. 建立 TestFlight build，执行两普通用户 + 一管理员端到端验收脚本；
8. 对 App bundle、Swift Packages、npm dependencies、源码和用户文案执行最终范围审计。

**可测试 Deliverable：**

- 可安装的 TestFlight build；
- 可从零部署的 Render backend、Postgres migrations 和 Admin dashboard；
- 完整 Xcode project、backend source、README、OpenAPI、`.env.example`；
- `artifacts/acceptance/final-test-report.md`，逐项链接 Step 00–14 和 Step 14A 的测试证据及真机 UI 验收结论；
- App Store Review demo account 与审核说明。

**测试方法：**

1. 在没有原开发环境的机器上仅按 README 完成 build/deploy；
2. TestFlight 执行 Register/Apple Login → Profile → Discover → Direct Chat → Report/Block；
3. 执行 Strava Connect/Refresh/Disconnect 和 HealthKit Opt-in/Import/Delete；
4. 执行 Event Create/Join/Group Chat/Leave/Report/Admin Resolve；
5. 最后执行 Account Delete 并核对 Apple、Strava、Stream、Storage、DB、Keychain；
6. `scripts/check-mvp-scope.sh` 和 secret scan 对 archive/源码均通过；
7. 确认 App 不含 AI、Garmin、Premium、IAP、Swipe、Like、Match 功能或面向用户入口。

**通过标准：** Definition of Done 全部打勾，自动化测试、真实服务验收、从零部署和 TestFlight E2E 均有可审计证据。

## 11. 测试矩阵

| 范围 | 必测内容 |
|---|---|
| Auth | 注册、重复邮箱、错误密码、Apple token 校验、refresh rotation、logout、reset、delete |
| Authorization | IDOR、伪造 user ID、非成员读写 Stream channel、普通用户访问 admin |
| Profile | 字段校验、pace unit、照片格式/大小、城市位置不泄露 |
| Discover | 三种筛选组合、稳定排序、分页、双向 block 排除 |
| Strava | state/回调、scope 拒绝、token refresh、活动幂等、revoke |
| HealthKit | 未授权、拒绝、限制授权、重复 import、disconnect/delete |
| Direct Chat | channel 唯一、实时文本、block 前后、report message |
| Events | CRUD、过去时间、capacity 并发、join/leave、取消、群成员同步 |
| Reports | Profile/Chat/Event 来源、快照、状态流转、admin audit |
| Account deletion | Apple/Strava/Stream/照片/DB/session 全链路清理 |
| UI 视觉对齐 | Expo / SwiftUI 逐页截图对比、统一设计 token、页面与状态覆盖、小屏/大屏、真机 Product Owner 验收 |
| iOS UI | Dynamic Type、VoiceOver、Dark Mode、网络断开、空状态、错误重试 |
| Deployment | 空数据库 migration、seed admin、Render health check、env validation |

## 12. Render 部署要求

至少包含：

- 一个 Render Web Service：Express API + `/admin`；
- 一个 Render Postgres；
- 一个外部 S3-compatible object storage；
- Staging 和 Production 两套独立服务；
- `render.yaml` 或 README 中的逐项 Dashboard 配置；
- Build：安装依赖、生成 Prisma client、编译 TypeScript；
- Deploy 前运行 `prisma migrate deploy`；
- Start：启动已编译 server；
- 服务监听 `0.0.0.0` 和 Render 提供的 `PORT`；
- `/healthz` 不访问外部服务，`/readyz` 检查数据库；
- Render Secret 环境变量不写入 repo 或日志。

不要将头像或运行时数据写入 Render 默认文件系统，因为部署时文件系统不是持久存储。

## 13. 交付物

### iOS

- 完整、可打开的 `Lauver.xcodeproj`；
- 所有 Swift 源码和 Swift Package 依赖锁定文件；
- Development / Staging / Production 配置；
- Entitlements、Info.plist purpose strings、URL scheme / Universal Link 配置说明；
- Unit Tests 和 UI Tests；
- 不包含真实 secret 的 `.xcconfig.example`。

### Backend

- 完整 TypeScript Express 源码；
- Prisma schema、从零可执行 migrations 和 seed；
- Admin dashboard；
- Stream、Strava、Apple、object storage adapters；
- API tests 和 authorization tests；
- Dockerfile、`render.yaml`、`.env.example`；
- OpenAPI 文件或完整 REST contract。

### README

根目录 `README.md` 必须覆盖：

1. 前置账号：Apple Developer、Strava、Stream、Render、object storage、email provider；
2. 本地 PostgreSQL 和后端启动；
3. 全部环境变量含义，但不包含真实值；
4. Apple Sign In key / callback 配置；
5. Strava callback domain、scope 和 URL scheme；
6. Stream App、channel type 和权限配置；
7. HealthKit entitlement 和 purpose string；
8. MapKit 使用方式；
9. Xcode signing、bundle ID 和 build configuration；
10. Render staging/production 部署；
11. migration、seed admin、测试与故障排查；
12. App Store / TestFlight 提交流程；
13. 账户删除和举报审核操作手册。

## 14. Version 2 Backlog（不得进入 MVP）

- AI matching；
- AI assistant / AI coach；
- 个性化推荐或学习排序；
- Garmin official API sync；
- Premium subscription；
- In-App Purchase；
- Tinder-style swipe / like / mutual match；
- 图片/视频/语音消息；
- 路线发现、挑战、排行榜；
- 复杂推荐、增长和付费实验。

Version 2 项目不得在 MVP App 中放灰色按钮或预告文案。

## 15. Definition of Done

MVP 只有同时满足以下条件才可签收：

- 8 个 Must-have Feature 全部达到各自验收条件；
- Step 14A 通过：全部 MVP 用户页面参照 Expo 版本完成视觉与体验对齐，有逐页对比证据、差异说明及 Product Owner 真机 UI 验收结论；
- 所有硬限制在源码、UI、依赖和文案层均满足；
- 全新数据库可通过 migration 从零创建；
- staging 环境完成两用户私聊、活动群聊、举报后台和账户删除 E2E；
- Strava secret、Apple private key、Stream secret、数据库凭据未进入 iOS 或 git；
- HealthKit 未主动点击时从不申请权限；
- Block 和 Report 在 Profile、Chat、Event 可用；
- App 内永久删除账户可用，并完成 Apple token revoke；
- Xcode archive、backend build、自动测试和 Render deploy 全部成功；
- README 经未参与开发的人从零验证通过；
- Product Owner 确认 App 内没有 AI、Garmin、Premium、IAP、Swipe 或 Match。

## 16. 官方实现参考

- [Apple：Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple：Handling account deletions and revoking tokens for Sign in with Apple](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
- [Apple：Sign in with Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)
- [Apple：Authorizing access to health data](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- [Apple：MapKit](https://developer.apple.com/documentation/mapkit/)
- [Strava：OAuth Authentication](https://developers.strava.com/docs/authentication/)
- [Stream：Authentication and tokens](https://getstream.io/docs/platform/authentication/)
- [Render：Deploy a Node Express app](https://render.com/docs/deploy-node-express-app)
- [Render：Web Services](https://render.com/docs/web-services)
- [Render：Prisma ORM with PostgreSQL](https://render.com/docs/deploy-prisma-orm)
