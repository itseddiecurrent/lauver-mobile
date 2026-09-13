# Step 07 — Block 与 Profile Report 安全基础

日期：2026-09-13。状态：🟡 实现与 Backend 本地测试通过，本地完整 UI 14/14 与新版安装通过，部署和真机实际 API 验收进行中。

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
- iOS 最新源码 XCTest **81/81**，新增 safety request/receipt/cursor、report 丢失响应不自动重报、report 重试与成功去重、unblock 失败保留条目与恢复，以及 Blocked Users 分页失败保留游标/刷新失败从第一页重试。
- 完整 XCUITest **14/14 通过**，零失败/跳过，`TEST SUCCEEDED`；bundle `/tmp/lauver-step07-ui-complete.xcresult`、日志 `/tmp/lauver-step07-ui-complete.log`，持久化摘要 [step-07-ui-20260913.log](step-07-ui-20260913.log)。新增两项覆盖普通举报 → reference → Report and Block → Settings 解除，以及 Block 取消/确认。上一轮 13/14，唯一失败发生在刚点击 Discover 行后尚未找到 Safety；相同源码的完整安全流程单独重跑通过。三个 Discover 导航用例现统一等待行可点击后再点击，保留原有结果断言，完整回归现已通过。
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

- Step 07 实现提交 `52fd7a8` 已推送 main；[MVP CI](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34756749550) 的 Backend / guardrails 通过，XCTest **81/81**、UI **13/14**；两项安全用例通过，唯一失败为注册测试点击密码框后未获得键盘焦点。Render 未部署该提交。输入 helper 现等待实际键盘焦点，首次点击未聚焦时按重新查询的位置再点击一次；CI 关闭测试并行执行，采用本地复验的同一 simulator 方式。最终三项输入回归执行中，随后提交修复并由既有 checksPass 流程部署。
- 用户已明确表示现在可进行真机实际 API 手动验收；准备使用三个可精确清理的临时账号，部署和自动 API 验收完成前不创建这些远端 fixture。

- 本轮只读核对：staging `/v1/blocks` 返回 **404**，最新成功部署仍为 `594030b`，已应用的最后 migration 为 `20260913010000_explicit_pace_ranges`；Step 07 后端与 schema 尚未部署。未创建远端 Step 07 fixture。
- 新版 staging App 使用既有开发签名对 iPhone 14 Plus（iOS 18.7.8）构建，**BUILD SUCCEEDED**，已安装并正常启动 `ai.lauver.app.staging`；日志 `/tmp/lauver-step07-device-build.log`。真机安全流程固定服务 UI 的 runner 在初始化阶段因 iOS “认证已取消 / Canceled by user” 停止，尚未执行任何用例；随后已恢复正常 staging App。此结果不标为 UI 或实际 API 通过。
- 新版后端与 migration 需一起部署，随后执行 `npm run verify:step-07:staging --prefix backend`。只读取忽略的 `.env.staging`；部署前不向旧 API 创建测试数据。
- Verifier journal 在注册前保存随机 run 精确 email；HTTP/数据库异常和中断均尝试清理。清理拒绝外部身份、照片/upload、无关举报或审核数据；需恢复时运行 `--cleanup-state` 指定该 run 的 journal。
- 真机待测：A 普通举报 B，看到 reference；A 拉黑 B 后双方 Discover 和直接 Profile API 隔离；Settings 列表显示并可解除；Report and Block 同时成功；取消确认无副作用、断网失败可恢复。测试资料须在结束后精确清理。

## 配置与数据政策

- 无新增第三方账号或 secret。README、OpenAPI、staging env 示例、Step 07 自动检查与 CI 已同步。
- reports/safety audit 的 user 外键删除时置空；MVP 全链路账户删除仍在 Step 14 实施，届时按公开保留政策处理快照与审计。本 Step 未宣称账户删除已完成。
