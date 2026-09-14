# Step 08 — Strava OAuth 2.0 只读集成

日期：2026-09-14。状态：🟡 实现、后端本地验收与真机 XCTest 已通过；真实 Strava 授权和两次活动同步已通过，20 条摘要且仅 read/activity:read。真实强制过期刷新、撤销（旧 token 401）及测试账户清理已通过；其余 UI/发布检查仍待完成。不能以 provider fake / XCTest 结果代替真实服务验收。

## 实现范围

- `20260914000000_strava_readonly` migration：每用户一个 connection、10 分钟的一次性 OAuth state、最多 20 条活动摘要。state 只保存 SHA-256；新尝试替换旧尝试，断开取消待授权 state。callback 的 owner 由服务端 state 查找，不接受客户端 user ID。
- `/v1/integrations/strava/{start,callback,status,sync,disconnect}`；除固定 HTTPS callback 外均要求当前 bearer session。拒绝 caller-supplied IDs/token；写操作有 user/IP rate limit；响应 no-store，callback no-referrer，request/redirect 日志不保存 query。
- OAuth 仅请求 `read,activity:read`、强制显示授权页面；校验 callback 实际授予范围，provider 返回 scope 时再次校验。缺 scope 或多余 scope 时不进入 connected，并撤销已签发的 grant；provider 失败则保留撤销任务。
- 使用单独 32-byte key 的 AES-256-GCM，AAD 绑定用户与 access/refresh 类型。iOS、公开 API 和日志均不接触 provider token/client secret。
- PostgreSQL session advisory lock 串行化同账户的 callback、刷新、同步与断开，覆盖多实例。token 更新独立提交，活动请求失败不会回滚已轮换的 refresh token。
- 过期 access token 自动刷新；provider 拒绝尚未过期 token 时最多刷新一次。授权失效进入 reconnect_required；瞬时网络故障保留当前连接和最近成功摘要，并显示可重试错误。
- 摘要仅含 provider activity ID、title、sport、start time、elapsed duration、distance。只存最近 20 条，重新同步替换窗口，已删除/隐私改变不再返回的活动不会永久残留。没有 route、坐标、心率或 raw payload，也不改变 Discover 自报配速。
- Disconnect 先隐藏/删除摘要，调用 Strava 当前推荐 `POST https://www.strava.com/oauth/revoke`，Basic Auth 使用 server credentials，撤销 refresh token。200 才删除 connection；失败为 revocation_pending，每分钟自动重试，页面支持 Retry Disconnect，未完成时不宣称已撤销。
- 原生 Profile > Settings > Connected Apps > Strava：说明、系统 ASWebAuthenticationSession、连接状态/athlete name/同步时间、最近活动、Refresh、确认 Disconnect；Profile 显示自己的最近摘要。返回 URL 必须匹配 host/path、原始 state 与允许的 result，随后读取当前账户的真实 API 状态。
- 活动目前仅自己可见；其他用户 Profile 不读取 Strava 数据。全部页面视觉签收仍按 Step 14A 执行。

## 本地验证

- Backend provider contract / API route tests：只读范围、固定 callback、token 交换/轮换、最新 20 条摘要投影、推荐 revoke 空 200、非法 payload/上游故障、AES-GCM tamper/跨账号/类型校验、owner 防伪与 rate limit。
- 隔离 PostgreSQL migration-from-zero / integration **54/54 通过**（Strava service 12 项、分阶段验收工具 4 项）；日志 `step-08-local-integration-20260914.log`。本轮只使用 `127.0.0.1:55439/lauver_step08_test`，没有迁移或重置 staging；此前 49 项结果为历史记录。
- Backend unit **142/142 通过**；lint、typecheck、production build 通过，`npm audit --omit=dev` 为 0 vulnerabilities；Step 08 structure、scope、secret checker 及其回归检查通过。
- 验收工具按严格字段结构检查活动摘要，标题中的 `latitude` 等文字不被误判；`connected` 即保存旧 access token 的加密值，无需先强制过期。原生断开/刷新丢失响应后的状态恢复同时通知 Profile 重新读取状态，避免保留已清除摘要。
- 此前原生 staging build-for-testing：`TEST BUILD SUCCEEDED`，日志 `/tmp/lauver-step08-ios-build.log`。本轮最终源码的 App/XCTest/UI 编译阶段未报告编译错误，但 XCTest/完整 UI 未开始执行：iOS 26.5 Simulator 停在系统启动转圈画面，`simctl bootstatus` 持续 `Waiting on System App`。已尝试设备重启、CoreSimulatorService 重启和另一台现有测试模拟器，仍不能完成启动；已停止等待中的测试。不能记录为原生测试通过。
- App 构建与 archive 恢复后再次运行原生全套测试（`/tmp/lauver-step08-resume-recovered-tests.log`），仍在 System App 启动阶段等待且没有 Test Case 开始执行，已停止并关闭本轮测试模拟器。下一轮需在正常启动的 Simulator / CI 补跑最终 XCTest / UI，再进行真实 iPhone OAuth 验收。
- 改用已连接的 iPhone 14 Plus（iOS 18.7.8），同一最终功能源码 `2adf300` 的全部 XCTest **99/99 通过**，其中 Strava **9/9**，`TEST SUCCEEDED`。结果 bundle `/tmp/lauver-step08-device-unit.xcresult`；新版 staging App 已完成开发签名并安装。Simulator 中断属于历史未完成尝试；真机单元测试成功不代表 OAuth/完整 UI 已通过。
- 真机 Connected Apps / Strava 的单项 XCUITest 尝试在 runner 初始化阶段失败（`Timed out while enabling automation mode`，exit 65），**没有 Test Case 执行**，不是页面断言通过或失败的证据。日志 `/tmp/lauver-step08-device-ui.log`、bundle `/tmp/lauver-step08-device-ui.xcresult`。完整 UI 交由云端 CI 补跑；真实系统认证会话仍需用户手动授权验收。
- 冷构建的标准配置脚本最初受 `actool` 等待影响并被停止；恢复后最终源码的 Staging / Production Simulator build 均 `BUILD SUCCEEDED`，实际构建 Info.plist 的 environment / API URL / bundle ID / `lauver` OAuth return scheme 检查通过。日志 `/tmp/lauver-step08-resume-staging-build.log`、`/tmp/lauver-step08-resume-production-build.log`。
- Staging unsigned device archive `ARCHIVE SUCCEEDED`，位置 `/tmp/lauver-step08-resume-staging.xcarchive`，日志 `/tmp/lauver-step08-resume-archive.log`。archive environment / API URL 检查通过，archive 文件和 executable strings 通过现有高置信度 secret scan。当前尚未配置真实 Strava secret/token，因此真实配置值的精确扫描、Git history 扫描和正式签名 IPA 验收仍待完成；不能用未签名 archive 代替这些检查。
- 当前 Render `/healthz` 实测 HTTP 200，未登录 Strava status 为 HTTP 404，说明本 Step 路由尚未部署。本轮未注册远端账户、修改 staging schema 或连接用户的真实 Strava。

构建与基础配置/secret 扫描结果汇总：`step-08-local-build-20260914.log`；完整后端集成日志：`step-08-local-integration-20260914.log`。

真机 XCTest 原始结果汇总：`step-08-device-unit-20260914.json`。专用生成 key 的 native source / signed device app / native Git history 精确扫描见 `step-08-known-key-scan-20260914.log`；provider Client Secret 与真实 token 尚不可在本地检查，不记为通过。

## 部署进度

- 功能源码 `2adf3001953c6e1905f39c8616bbf37b625c9e3d` 已推送 `main`；GitHub [CI run 34802025321](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34802025321) 的 backend / guardrails 已通过，iOS 仍在执行。
- `mvp-step08-strava` 分支也已上传。当前 GitHub credential 的 PR creation 返回 HTTP 403；未创建 PR，沿用项目已有 main / CI / Render staging 流程。
- Blueprint enabled flag 保留手动值的配置修正与真机验收记录会随后提交；完整 CI、线上 migration/status 与真实 OAuth 的结果需据实际部署续记。

### 本轮续验收

- 用户已确认全部 Render Strava 配置保存并部署。线上 `/healthz`、`/readyz` 均 HTTP 200；未登录 `/v1/integrations/strava/status` HTTP 401，路由已部署且要求认证。
- 功能提交 `2adf300` 的 [完整 CI](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34802025321) 已 **success**，backend / guardrails / iOS 全部通过。最新配置提交 `e0a5797` 的 [CI](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34802230944) backend / guardrails 已通过，iOS 最终失败（exit 65；配置检查被跳过，具体失败用例待取日志定位）。此前部署与 CI 待完成描述为历史进度。
- 标准 `prepare` 在数据库连接阶段失败，未创建账户或 private journal。DNS 返回本机网络的 `198.18.*` 地址；经两个 HTTPS DNS 服务核对真实地址后，TCP、PostgreSQL SSLRequest 与 TLS 证书校验可通过，但 PostgreSQL 会话仍关闭。Node 24 / 26 与使用系统根证书的 psql 均不能建立数据库会话；原因未确定，未降低 TLS 校验。
- 改用真实 REST API 准备一个独立 `step08-<run>@example.com` Email fixture；注册 HTTP 201，登录成功，Strava status **HTTP 200 / disconnected**，确认配置已生效。private journal 在注册前写入仓库外私人目录，目录 0700、文件 0600，字段与既有验收工具兼容；凭据及 user ID 不记入此文档。
- 准备会话 logout 返回空响应，临时 Python JSON parser 因空 body 报错；账户注册与 enabled 检查已成功。后续 API 核对正确处理空响应，Strava 仍为 disconnected，验证会话 logout **HTTP 204**；不将先前解析错误记为 OAuth 功能失败。
- 已指导用户在已安装的 staging App 使用私人文件登录，再完成系统 Connect Strava。保留 fixture 等待真实授权；外部数据库连接恢复前，owner/schema SQL、强制 expiry 与加密凭据检查均未验证。不得删除尚未完成 revoke 的 fixture。
- 本轮 scope、secret 和 Step 08 structure 检查通过。真实 provider Client Secret/token 的精确扫描和正式签名 IPA 检查仍待完成。

### 真机连接与 loading 反馈

- 用户报告登录时 loading 卡住，随后确认 reload 后连接成功。独立 API 登录 HTTP 200（约 2.7 秒），同期一次资料请求网络失败；不能据此断言手机 loading 的唯一原因。
- 随后真实 status **HTTP 200 / connected**，仅 `activity:read` 和 `read`，athlete name / lastSyncedAt 存在，**20 条活动摘要**；两次真实 sync 均 HTTP 200 / connected，响应活动 ID 无重复、数量不超过 20、字段严格为摘要白名单。证据 `step-08-real-connect-20260914.log`；未记录姓名、活动内容或凭据。
- 以上是首次真实授权记录；后续已完成强制 token 过期、refresh-token 轮换、数据库去重、撤销和精确清理，详见“撤销与清理完成”。
- 本地追加网络 idle timeout 15 秒、resource timeout 30 秒以及明确重试文案，并新增登录超时后可再次登录的 XCTest。用户恢复连接后停止尚在编译的真机测试，未安装这些修改，避免打断 OAuth 验收。模拟器 App/测试编译与签名完成，但系统启动黑屏、没有 Test Case 开始，已停止等待；不能记为 XCTest 通过。日志 `/tmp/lauver-step08-login-simulator-tests.log`。此次 reload 恢复不能记为新修改的验证结果。
- 最后再次核对 `/v1/me` HTTP 200，资料 envelope 正常；独立验证会话 logout HTTP 204，手机会话未撤销。
- 用户明确确认真机三项正常：Strava 姓名与摘要正确、Refresh Activities 完成、返回 Profile 可见最近活动。
- 用户随后确认线上数据库当前允许所有 IP，故仓库 `ipAllowList: []` 不能作为此次线上故障的已确认原因。再次检查时，Node 24 使用 TLS 1.2 / TLS 1.3 均已成功连接并读到 `20260914000000_strava_readonly` migration；未修改线上网络规则，先前断连原因仍未确定。
- 数据库恢复后，标准验收工具 `connected` / `expire` / `refresh` 全部通过：精确 fixture owner、真实只读 scopes、保存旧 access token 加密证据、仅测试账户 expires_at 置为过去、真实 provider refresh + sync、最新加密凭据和未来 expiry 持久化、重复同步、SQL 活动去重与最多 20 条窗口。
- 使用本地独立 encryption key 成功解密测试账户的旧/current token，仅在内存做精确扫描；原生目录 42 个文件、已有未签名 archive App 4 个文件、Git text history 均无真实 token/key。未扫描到的 Render-only Client Secret 与正式 signed IPA 不记为通过。证据追加在 `step-08-real-connect-20260914.log`。
- 已请用户在手机点击 Disconnect 并返回 Profile 检查摘要移除；用户确认完成，随后核对 DB 清理和旧 provider token HTTP 401。
- 后续定位到仓库 `render.yaml` 的数据库配置为 `ipAllowList: []`，按 [Render 官方文档](https://render.com/docs/postgresql-creating-connecting#restricting-external-access) 表示禁止外部连接；这与内部 API 正常、外部数据库连接关闭的现象一致。线上实际规则待用户核对；已请用户临时添加本机当前出口地址的单 IP `/32` 规则，保留其他规则，验收后移除。当前没有 Render 管理凭据，未擅自修改线上规则或将 Blueprint 改为公开访问。

### 撤销与清理完成

- 用户确认 Disconnect 后显示未连接，返回 Profile 活动列表已消失。标准 disconnect verifier 核对 connection / activities / OAuth state 均为空，旧 provider access token **HTTP 401**。
- 独立 fixture 的真实 callback 检查：缺失 state、未知 state、过期 state、已消费 state 重放均 HTTP 400；access_denied 返回 cancelled。未进行新的 provider 授权，检查后清除临时 state；断开后的 sync HTTP 409。
- 标准 cleanup verifier 再次确认旧 token 401，精确删除测试账户；删除后的 Lauver session **HTTP 401**，私人登录/recovery journal 已移除。先前给用户的测试邮箱密码已失效。未删除用户本人 Strava 活动。
- 证据 `step-08-real-connect-20260914.log`。手机断开流程完成后，已连接 iPhone 的本地超时改进单元测试 **100/100** 通过。

## Staging 配置

1. 用用户自己的 Strava 账户登录 [My API Application](https://www.strava.com/settings/api) 创建 staging 应用：Application Name 填 `Lauver Staging`，Website 填 `https://lauver.ai`，Authorization Callback Domain 只填 `lauver-api-staging.onrender.com`（不加协议或路径），Description 说明只读最近运动摘要。其他必填项按实际情况选择。当前 [官方 Getting Started](https://developers.strava.com/docs/getting-started/) 要求创建者拥有 Strava subscription；新应用默认 single-player mode，只允许创建者本人授权，适用于本轮个人账户验收。
2. Render Secret Environment Variables 配置 `STRAVA_CLIENT_ID`、`STRAVA_CLIENT_SECRET`、独立 `STRAVA_TOKEN_ENCRYPTION_KEY`（`openssl rand -base64 32`）；`STRAVA_CALLBACK_URL=https://lauver-api-staging.onrender.com/v1/integrations/strava/callback`；然后设置 `STRAVA_ENABLED=true`。
3. 部署本 Step 代码与 migration，使用正常 `npm run db:migrate:deploy && npm start`；在登录后 status 返回 disconnected 而非 disabled 时再开始授权。不要把 secret 写入 iOS config、git、聊天或验收日志。
4. 安装最新 staging App；使用独立 Email 测试账户与真实 Strava test athlete。

用户已确认使用自己的 Strava 账户作为 test athlete。2026-09-14 已创建 API application，截图确认 public Client ID 为 `229012`；用户已确认 callback domain 与 Render `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` 填写完成（Save only）。本地生成独立 encryption key，保存在 ignored、0600 的 `backend/.env.strava-staging`；用户已确认 encryption key / callback URL / enabled 配置保存并部署。Secret/key 不记入验收文档。

Render staging 已完成本 Step 部署和配置；未登录 status 为 HTTP 401，授权、刷新、撤销和清理已在真实服务验证。此前 HTTP 404 是部署前记录。

| Render Environment variable | 值 / 来源 |
|---|---|
| `STRAVA_CLIENT_ID` | Strava My API Application 中的 Client ID |
| `STRAVA_CLIENT_SECRET` | 同一应用的 Client Secret，仅存 Render secret |
| `STRAVA_TOKEN_ENCRYPTION_KEY` | 用 `openssl rand -base64 32` 生成独立密钥，仅存 Render secret |
| `STRAVA_CALLBACK_URL` | `https://lauver-api-staging.onrender.com/v1/integrations/strava/callback` |
| `STRAVA_ENABLED` | 全部配置就绪并部署后设置为 `true` |

`STRAVA_ENABLED` 与 provider secret 一样使用 Blueprint `sync: false`，保留 Render 手动配置值，避免 Blueprint sync 将用户已启用的开关覆盖回 false；缺省仍由 backend config 默认 disabled。[Render Blueprint 环境变量说明](https://render.com/docs/blueprint-spec#prompting-for-secret-values)

不使用 Strava Dashboard 的预生成 access/refresh token 代替 App OAuth；验收必须从 App 的 Connect Strava 开始。`activity:read` 不包含 visibility 为 Only You 的活动；没有可读活动时空列表是合法结果，不要求修改已有活动的隐私设置。协议依据见 [Strava Authentication](https://developers.strava.com/docs/authentication/)。

## 分阶段真实 API 验收工具

沿用 ignored `backend/.env.staging` 的 `STAGING_DATABASE_URL`；CLI 只允许既定 staging API 与 `lauver_staging` 数据库，不重置 schema。部署并启用后执行：

```bash
npm run verify:step-08:staging --prefix backend -- --action prepare
```

工具先检查部署与 migration，再写权限 0600 的 private login/recovery journal，然后创建一个 `step08-<run>@example.com` 独立 Email 账户。登录密码不输出到日志；在 iPhone 上用该 private 文件中的资料登录，完成真实 Connect Strava。后续用 prepare 打印的路径替换 `/private/path/private.json`：

```bash
npm run verify:step-08:staging --prefix backend -- --action connected --journal /private/path/private.json
npm run verify:step-08:staging --prefix backend -- --action expire --journal /private/path/private.json
npm run verify:step-08:staging --prefix backend -- --action refresh --journal /private/path/private.json
npm run verify:step-08:staging --prefix backend -- --action disconnect --journal /private/path/private.json
npm run verify:step-08:staging --prefix backend -- --action cleanup --journal /private/path/private.json
```

`expire` 只将精确匹配的独立账户 token expiry 置为过去；`refresh` 校验最新加密凭据保存与重复活动去重；不会读写其他用户。`disconnect` 必须得到非 pending 的成功结果；`cleanup` 在同一用户 advisory lock 下拒绝仍有 connection/state、照片、其他 identity、举报/安全审计/block 的账户。失败时保留 private journal；恢复后重试 cleanup，先撤销再删除账户，最后删除 private 文件。

private journal 在 `connected` 或 `expire` 时保留旧 access token 的**加密值**供撤销检查。需要旧 token 401 证据时，在 Render 的 staging runtime 中运行带该 journal 的 disconnect/cleanup 命令，使用现有服务端 `STRAVA_TOKEN_ENCRYPTION_KEY` 解密并调用 Strava；token 与 key 均不打印。缺少 journal 旧值或服务端 key 时工具明确输出 `NOT VERIFIED old-provider-token-401`，不能把这条检查当作通过。独立账户/资料只服务于本轮验收；Strava 断开不会删除用户本人 Strava 活动。

## 真实验收待办

| 操作 | 通过证据 | 状态 |
|---|---|---|
| Connect → 查看摘要 | 实际授予 read + activity:read，name/最近 20 条摘要正确，无 token/路线/坐标 | 已通过；用户确认真机摘要、刷新及 Profile 列表正常 |
| 拒绝授权/取消活动权限 | 明确取消/缺少 scope 提示，状态不为 connected，失败可重新开始 | 待验收 |
| 缺失/过期/重复 state | 真实 callback 拒绝，不能重新交换旧 code | 已通过真实 staging callback；缺失、未知、过期及 consumed state 均 HTTP 400 |
| 强制过期后 Refresh | 仅测试用户 expires_at 置为过去，真实 refresh 后新 encrypted credentials 持久化，摘要可刷新 | 已通过标准 staging verifier |
| 同一活动重复 Refresh | 同一 user/activity ID 只有一行，没有 raw payload | 已通过真实 sync 响应及 SQL 核对 |
| Disconnect | revoke 确认成功，status disconnected，connection/activities/state 清空；旧 provider token 401 | 已通过，用户确认真机断开与 Profile 摘要移除；旧 token 401 |
| 断网与 provider 失败恢复 | App 显示失败或 pending，不误报完成；恢复后可刷新/撤销 | 待验收 |
| iPhone 与 archive secret scan | 系统安全认证会话与返回 App 正常，archive 不包含任何已配置 secret/真实 provider token | 待验收 |
| 精确清理 fixture | 先完成 Strava revoke，再删除独立账户/依赖/私人凭据；保留安全清理证据 | 已通过，删除后 session 401，private journal 已删除 |

官方协议依据：[Strava Authentication](https://developers.strava.com/docs/authentication/)、[List Athlete Activities](https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities)。2026-06-01 起推荐 `/oauth/revoke`，refresh token 撤销同时撤销关联 access tokens。

Step 14 账户删除需要先使用本服务撤销外部 grant，再处理 connection/user cascade；不能仅依赖数据库级联作为外部服务清理。staging 与 production 必须分别保管 app credentials 和 encryption key；已有加密记录在更换 key 前需要完成重加密或撤销，不能直接丢弃旧 key。
