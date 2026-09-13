# Step 07 — Block 与 Profile Report 安全基础

日期：2026-09-13。状态：✅ 验收通过。本地 Backend、既有完整云端 CI 与 staging 实际 API 34/34 通过；真机完成举报、双向拉黑/解除、Report and Block、断网恢复及过期刷新。session 竞态修复后 XCTest 88/88、相关 UI 4/4 通过并已安装真机。独立手机 run 的 3 个账号、3 条举报、6 条审计及关联数据已清理，残留为 0。

## 实现与范围

- 复用 Step 06 已有 blocks 表，新增 `20260913020000_profile_safety` migration：reports、不可变 evidence trigger 和 safety_audit_events。
- 认证后 block/unblock/分页 blocked users；actor 只来自 bearer session。拉黑重复幂等，解除只删除自己的方向。Discover SQL 与 public Profile repository 使用共享双向策略，直接猜测 Profile ID 不能绕过。
- `POST /v1/reports` 先支持 user/profile，六类 reason、可选 2000 字说明、reference ID、open queue；重复目标新证据另存一条。客户端不得传 reporter ID 或 snapshot。
- 服务端生成资料文字、城市与自报运动/配速快照，不包含精确坐标、email、对象存储 key 或 provider secret。数据库 trigger 拒绝改写提交内容，资料更新不改变证据。
- 显式 `blockUser=true` 将 report/block/audit 放入同一个事务；普通 Report 不自动 Block。写操作各 20 次/分钟/user/IP，audit 记录 actor、target、action、request ID 和 time，不额外保存原始 IP。
- 原生 Profile > Safety：Block User（确认）、Report User、Report and Block；显示提交结果及 reference。Profile > Settings > Blocked Users 查看、分页、确认解除，含加载/空/失败重试。
- 单独拉黑成功关闭目标 Profile 并立即隐藏该 Discover 行、失效旧请求，再刷新；Report and Block 在服务端立即生效，App 保持 reference 结果页直至 Done，再关闭资料页并刷新列表。恢复前台重读其他用户 Profile，404/失效会话清除旧展示。解除触发 Discover 刷新，不恢复会话。
- Stream 私聊及聊天内拉黑在 Step 10 实现；Admin Dashboard 在 Step 13 实现。Step 07 的 reports 已是后续可审核队列，没有暴露假聊天或后台入口。

## 本地验证

- Backend lint / typecheck / production build：最终源码通过；production dependency audit 0 vulnerabilities，OpenAPI YAML 与内部引用全部校验通过。
- Backend unit **129/129**；Safety routes 6 项覆盖认证、actor 防伪、全部 reason、重复证据、非法参数、Report and Block 和 rate limit。
- 隔离 PostgreSQL 从零 migration；Safety integration 5 项覆盖双向 Discover 与直接 Profile 隔离、重复操作、自身/不存在/暂停 target、快照不可修改、更新 Profile 后证据保留、audit 失败事务回滚、50+4 blocked 分页、账户隔离及坐标隐私。
- 本地 verifier HTTP/SQL lifecycle 4 项：成功后删 3 个 fixture 及 reports/audit/session、API 失败清理、中断清理、非法 journal 拒绝并保留无关 owner 账户、空恢复。最终 migration-from-zero / integration **37/37** 通过，日志 `/tmp/lauver-step07-integration-stable.log`。
- session 竞态修复前 iOS XCTest **81/81**，新增 safety request/receipt/cursor、report 丢失响应不自动重报、report 重试与成功去重、unblock 失败保留条目与恢复，以及 Blocked Users 分页失败保留游标/刷新失败从第一页重试。
- session 竞态修复前完整 XCUITest **14/14 通过**，零失败/跳过，`TEST SUCCEEDED`；bundle `/tmp/lauver-step07-ui-complete.xcresult`、日志 `/tmp/lauver-step07-ui-complete.log`，持久化摘要 [step-07-ui-20260913.log](step-07-ui-20260913.log)。新增两项覆盖普通举报 → reference → Report and Block → Settings 解除，以及 Block 取消/确认。上一轮 13/14，唯一失败发生在刚点击 Discover 行后尚未找到 Safety；相同源码的完整安全流程单独重跑通过。三个 Discover 导航用例现统一等待行可点击后再点击，保留原有结果断言，完整回归现已通过。
- 本地 PostgreSQL：`/tmp/lauver-step07-pg`，仅 `127.0.0.1:55437/lauver_step07_test`；验证结束后已停止实例，保留日志。没有重置或迁移远端数据库。
- 日志：`/tmp/lauver-step07-backend-verified.log`、`/tmp/lauver-step07-integration-stable.log`、`/tmp/lauver-step07-ios-verified.log`；最终 iOS bundle `/tmp/lauver-step07-verified.xcresult`。
- 首次完整 UI 12/14；两项失败分别为确认弹层无 Cancel、Report and Block 提前移除导航来源导致 reference 页消失。改为明确 Cancel/确认的原生 Alert，并将客户端列表更新推迟到 receipt Done 后；后端事务中的 Block 仍在提交时生效。随后完整 UI 13/14 与单独 Safety 重跑的结果分别记录，未把单项通过当作全套通过。
- 本机磁盘一度只剩约 113 MB，导致配置构建、结果包写入和临时 PostgreSQL 失败。仅清理本任务生成的临时构建目录与无法读取的结果包，保留日志和有效证据；隔离 PostgreSQL 重启后最终 37/37 通过，最新 XCTest 81/81 通过，staging / production 配置检查通过（`/tmp/lauver-step07-config-verified.log`）。配置脚本现在保留并输出失败构建日志，避免错误被吞掉。
- 只读核对此前文档提交 `594030b` 的独立 CI：Backend / guardrails 通过，iOS 11/12，失败为删除会话测试的密码框可点击等待超时。输入 helper 原先在 `tap()` 自动滚动前要求 hittable；现改为等待字段存在后调用元素 `tap()`，允许键盘改变布局后自动滚动，保留最终注册、重新登录和重置成功断言。该 helper 在全套 UI 构建后更新，受影响的注册/登录、会话删除、密码重置三项 UI **3/3 通过**，`TEST SUCCEEDED`；bundle `/tmp/lauver-step07-auth-scroll.xcresult`、日志 `/tmp/lauver-step07-auth-scroll.log`；不把此前实现提交的成功 CI 作为这份文档提交的 CI 结果。
- 既有 Step 06 连接终止故障注入存在时序竞态；测试在注入期间持有临时 blocks 锁，终止完成即释放，保证 verifier 不能先正常关闭连接而漏掉故障。测试结果仍要求失败后完整清理，没有跳过或放宽断言。

## UI 参考与差异

- 参考 commit `6737655`，启动 `CI=1 npx expo start --offline --port 8082`，Metro 本地正常运行。
- 来源 `src/context/ThemeContext.js`：Orange `#E8602C`、light BG `#F0EDE8` / card `#EAE6DF`、dark BG `#161412` / card `#201D1A`；沿用 `src/screens/profile/ProfileScreen.js` 的圆角 settings card 与 section 布局。
- 已落实原生共享 token，安全设置、举报页、Blocked Users 与其他用户 Profile 使用暖色背景和圆角区块；保持原生确认对话框、菜单和导航。
- Expo 没有 Step 07 的同等安全流程，新增页面沿用其设计语言。此轮为主题源码对照与原生 UI 回归；Expo / 原生逐页同内容截图比较和 Product Owner 真机视觉签收仍属于 Step 14A，不冒称已完成。
- 已保存 iOS 26.5 Simulator 固定服务截图：[举报表单](ui/step-07/step07-report-form.png)、[Report and Block reference](ui/step-07/step07-report-reference.png)、[Blocked Users](ui/step-07/step07-blocked-users.png)。浅色截图来自 `/tmp/lauver-step07-safety-retry.xcresult`；最终源码的同一安全流程在深色模式 **1/1 通过**（`/tmp/lauver-step07-safety-dark.xcresult`），另存 [深色表单](ui/step-07/step07-report-form-dark.png)、[深色 reference](ui/step-07/step07-report-reference-dark.png)、[深色 Blocked Users](ui/step-07/step07-blocked-users-dark.png)。已检查主要文字、按钮和布局，测试后恢复 Simulator 浅色。截图仅证明固定服务原生页面展示，不是实际 API evidence。

## 远端与真机验收

- Step 07 实现提交 `52fd7a8` 的首次 [MVP CI](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34756749550)：Backend / guardrails 与 XCTest **81/81** 通过，UI **13/14**，失败为注册密码框未获得键盘焦点；两项安全用例通过。输入 helper 修复后等待实际键盘焦点，必要时重新查询位置再点击一次，CI 关闭测试并行执行；没有跳过用例或降低完成断言。本地受影响输入回归 **3/3** 通过。
- 安全功能与输入 helper 修复提交 `20fd09f42d98be579eb945817ca9060bba1fb527` 的 [完整云端 CI](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34757582061) 已 **success**：Backend、guardrails、iOS 三个 job 全部通过，XCTest **81/81**、完整 XCUITest **14/14**，`TEST SUCCEEDED`。云端摘要已持久化至 [UI 日志](step-07-ui-20260913.log)。后续真机发现的 session 竞态修复随本次验收记录提交，另经 XCTest 88/88、相关 UI 4/4 与真机过期刷新验证；不将 `20fd09f` 的 CI 结果作为后续本地修复的云端 CI。
- 用户已确认手动部署成功。随后完整 CI 触发同一提交的自动部署；只读 GitHub deployments 核对 `6421729682` 与 `6421747423` 均 **success**，源码均为 `20fd09f`。staging 已应用 `20260913020000_profile_safety` migration；此前 `594030b` 的 `/v1/blocks` 404 是部署前记录，现已被新版结果取代。
- 实际 staging 执行 `npm run verify:step-07:staging --prefix backend`，**34/34 通过**，包含认证、三账号资料、双向 Discover 与直接 Profile 隔离、重复/自身拉黑、caller 隔离、普通举报不自动拉黑、资料更新后快照保留、隐私边界、重复目标新证据、原子 Report and Block、非法 target/伪造 reporter 拒绝及旧 session 失效。该自动验收的 **3 个账号及 reports、audit、依赖数据已清理**；完整证据 [实际 API 日志](step-07-staging-20260913.log)。
- 新版 staging App 已在 iPhone 14 Plus（iOS 18.7.8）构建、安装并正常启动 `ai.lauver.app.staging`；`BUILD SUCCEEDED`，日志 `/tmp/lauver-step07-device-build.log`。此前固定服务真机 runner 在 iOS 认证初始化阶段取消，未执行用例；不计为真机实际 API 通过。
- 用户已授权真机手动验收。独立 run `89ec2b75662ce2b3c4bbcddba5c8ea74` 的 **3 个手机测试账号已创建成功**：Step 07 Tester A、Step 07 Target B、Step 07 Target C。只读核对均 ACTIVE、资料完整、没有头像，测试开始前 reports=0、blocks=0；城市 Step 07 Test City、running 5:30 min/km。私人登录资料、IDs 与 cleanup journal 仅保存在本机权限受限临时目录，凭据不写入仓库。
- 真机完整操作结果见 [手机验收清单](step-07-device-checklist.md)。用户逐项确认：普通 Report 不自动拉黑、Cancel 无副作用、确认 Block 关闭资料/隐藏 Discover/加入 Blocked Users、B 也看不到 A、解除恢复 Discover、Report and Block reference 保留至 Done 后隐藏 C、断网解除失败后联网重试成功。
- 普通举报 reference `e17a2317-f339-4c28-a7e5-c4854073a7c9`：只读核对 A → B、harassment、user/profile、open、目标资料快照与 report audit/request ID 一致，无自动 block。
- Report and Block reference `23507a9c-9315-437c-8b00-21329059dd5c`：只读核对 A → C、open、C 的快照、report_and_block audit/request ID 与 block 一致。断网解除返回网络错误 -1200，云端 block 保留；联网重试后用户确认列表移除 C、Discover 恢复 C，云端 blocks=0。
- 实际 API 补充核对 **4/4** 通过：B 登录身份一致、读取 A Profile 返回 404、Discover 排除 A、B 没有自己的方向 block；用户也在 B 手机登录后确认找不到 A。
- A 手机 session 在 `2026-09-13T14:20:12.417Z` 成功 rotation 且未 revoked/compromised。用户一度反馈 Discover loading，随后明确确认页面恢复；readyz 200、独立 B fixture Discover API 200 / 830ms。过期后刷新验收通过；未提供 loading 持续时间与后台/锁屏情况，不认定其具体原因。
- 独立手机 run `89ec2b75662ce2b3c4bbcddba5c8ea74` **精确清理完成**：删除 **3 个账号、3 条举报、6 条 safety audit** 及 profiles、sports、training times、identities、credentials、sessions 等依赖数据；独立 SQL 核对 users/identities/sessions/reports/audit/blocks 均为 **0**。清理前属于 A 的探针 access/refresh token，清理后均返回 **401**；所有手机 session 随账号级联移除。私人登录文件、IDs 与 cleanup journal 已删除；没有重置 staging schema。证据 [手机清理日志](step-07-device-cleanup-20260913.log)。

## 真机问题修复进度

用户补充错误发生在返回 Discover／下拉刷新时，而非确认拉黑时。手机出现 invalid/expired session 错误且保留 B/C 旧列表，request ID `6da83306-c7c3-499f-866b-14b907707ca0`。只读核对 A 手机 session 刷新约 2 秒后被置为 revoked/compromised，当时没有 block。独立 feature service 的并发刷新存在复用旧 refresh token 的竞态；已修复共享刷新状态、迟到 401、退出/账号切换保护与运行中失效返回登录。截图与进度见 [手机清单](step-07-device-checklist.md)。修复后本地 XCTest **88/88** 通过，已在同一 iPhone 构建并安装新版，相关 Simulator UI **4/4** 通过且新版真机正常启动；证据 [修复日志](step-07-session-fix-20260913.log)。用户已确认修复版重新登录后拉黑三项行为通过；过期后 A 手机 session 已在 `2026-09-13T14:20:12.417Z` 完成 rotation 且未撤销，但用户反馈 Discover 纯 loading；同期 readyz 200、独立 B fixture Discover 200 / 830ms，用户随后确认页面恢复，过期后刷新路径通过。原生修复已提交并推送为 `05ee272`；其云端 CI XCTest **88/88**、已完成 UI **12/12** 通过，但总 watchdog 在 900 秒中断第 13 项，未完成全套，未见断言失败。构建/Simulator 启动约占 5 分钟；CI 总测试预算改为 1200 秒、job 25 分钟，单项超时/全部用例/断言保持，完整重跑待完成。证据 [最新 CI 日志](step-07-ci-20260913.log)。

## 配置与数据政策

- 无新增第三方账号或 secret。README、OpenAPI、staging env 示例、Step 07 自动检查与 CI 已同步。
- reports/safety audit 的 user 外键删除时置空；MVP 全链路账户删除仍在 Step 14 实施，届时按公开保留政策处理快照与审计。本 Step 未宣称账户删除已完成。

## 最终结论

Step 07 功能验收通过：Block 是后端双向强制策略，直接 Profile API 不能绕过；Profile 举报形成不可变、带 reference 与审计的 open queue，普通举报和 Report and Block 行为明确。手机操作、staging 数据核对、session 竞态修复与精确清理形成完整证据。Stream 聊天和 Admin Dashboard 分别按 Step 10、13 实现，逐页视觉签收仍按 Step 14A 执行。
