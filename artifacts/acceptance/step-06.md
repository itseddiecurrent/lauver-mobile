# Step 06 — Discover 手动筛选列表

日期：2026-09-13。状态：原版本 Render staging API 验收完成；新增半径与实际数值配速范围的本地验证、新版 iPhone 14 Plus 固定数据 UI 验收完成，待新版后端同步部署与真机实际 API 复验。

## 实现

- 认证 `GET /v1/discover`，严格校验运动、半径、配速分档、页大小和游标；配速筛选必须指定运动。
- 城市中心点 Haversine SQL；固定距离升序、资料更新时间降序、UUID 升序；使用未舍入距离做 keyset pagination。
- 排除自己、未完成、暂停、删除、任一方向已拉黑用户。最小 blocks migration 为 Step 06 前置基础；Step 07 继续提供管理与举报功能。
- 游标 HMAC 签名并绑定用户、城市、筛选参数；只返回整公里近似距离与公开资料，不返回坐标、object key 或排序时间。
- SwiftUI List、Filter Sheet、Profile navigation、加载/空/错误状态、分页重试和下拉刷新。请求代际检查避免过期结果覆盖新筛选。

## 自动化证据

- Backend lint / typecheck：通过。
- Backend unit tests：96/96 通过，其中 Discover 16 项。
- PostgreSQL migration-from-zero 与 integration：18/18 通过，其中 Discover 6 项。
- 固定 13 用户 dataset，覆盖 10 次稳定排序、距离/时间/UUID 并列分页、双向拉黑、半径恰好边界与内外、缺 pace 和新 block 对旧游标生效。
- 最终源码 iOS XCTest：73/73 通过，其中 DiscoverViewModel/filters 6 项及真实 API client Discover contract 1 项。
- 初次完整 XCUITest：11 项既有回归通过；新增 Discover navigation 在 Profile 空白页处失败。定位到 OtherProfileScreen 的初始空 Group 未触发加载任务，改为稳定 ZStack 并处理取消后，最终源码的 Discover 列表 → Profile → 返回 → Filter Sheet → Cycling → 空状态复验通过。
- 最终复验命令：`xcodebuild test -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination 'platform=iOS Simulator,id=C8000809-C352-4408-AC67-DCBAF53C415B' -derivedDataPath /tmp/lauver-step06-final-derived -parallel-testing-enabled NO -only-testing:LauverTests -only-testing:LauverUITests/LauverUITests/testDiscoverListOpensProfileAndAppliesFilters -resultBundlePath /tmp/lauver-step06-final.xcresult`；结果 `TEST SUCCEEDED`。
- 最终 staging / production 配置构建、Step 05 / Step 06 structure、MVP scope、secret scan、diff hygiene：通过。
- Backend production build、production dependency audit（0 vulnerabilities）、OpenAPI YAML 与全部内部引用检查：通过。
- 本地日志：`/tmp/lauver-step06-backend-tests.log`、`/tmp/lauver-step06-integration.log`、`/tmp/lauver-step06-ios.log`（首次完整 suite）、`/tmp/lauver-step06-final-tests.log`（修复复验）、`/tmp/lauver-step06-config-final.log`。最终 XCTest/XCUITest bundle：`/tmp/lauver-step06-final.xcresult`。

## 待外部验收

- Render staging API 和多个完整资料账户的组合筛选/分页已通过；App 与实际 API 的真机交互仍待确认。
- 真实 iPhone：Discover 列表 → Profile，筛选 Sheet、刷新、分页、断网重试；检查近似距离与坐标隐私。
- 本地集成测试使用 `/tmp/lauver-step06-pg` 的隔离临时 PostgreSQL，复验后已停止；从零 migration 测试不重置 staging/production 数据库。

## 自动 staging 验收脚本（2026-09-13）

- `npm run verify:step-06:staging --prefix backend`；连接串只放忽略的 `backend/.env.staging`，示例为 `backend/.env.staging.example`。
- 34 个随机 Email fixture，包括 21 个额外分页资料；运动、配速、缺 pace、5 km 内外、稳定排序、不同页大小、游标签名/用户/参数隔离、双向 Block、暂停/删除/未完成排除和新 session 均自动验证。
- 只创建数据库资料与 Email credentials，不涉及头像或外部 provider 数据；通过同一 staging 数据库事务硬删除本次账户，并验证关联表级联清理与旧 session 401。
- 写入前持久化随机 run 的精确 email 清单；失败与中断触发清理，无法清理时保留恢复 journal，可用 `--cleanup-state` 重试。
- 本地 verifier 安全单测 9/9；完整 PostgreSQL integration 24/24，其中 verifier 6 项覆盖正常完成、接口失败、中断、恢复幂等/其他 run 保留、恶意恢复文件拒绝、清理失败保留 journal 后再恢复；本地 backend unit 总计 105/105。
- 上述为隔离本地 HTTP + PostgreSQL 验证，不代表 staging 验收已完成；脚本初次交付时未配置 staging 数据库连接，尚未执行远程脚本。

- 本地真实 CLI：44/44 检查通过，输出 `{"result":"passed","checks":44,"deletedAccounts":34}`；日志 `/tmp/lauver-step06-verifier-cli.log`。隔离实例中的测试资料、用户、凭据、会话与 Block 均清理，旧 viewer token 返回 401。

## staging 执行尝试（2026-09-13）

- 用户配置连接串后运行 verifier，数据库连接阶段失败；还未创建 run journal、测试账户或任何 fixture。
- 检测到本地配置使用 Render 内网 hostname；尝试对应 Singapore 外网 hostname，其 DNS 可解析，但 PostgreSQL 连接被主动终止，未完成认证。
- `render.yaml` 的 staging Postgres 配置为 `ipAllowList: []`（禁止外部访问）；需要在 Render 数据库页面核对并放行执行机器 IP，同时将本地配置换成 External Database URL。
- 本地连接串未被更改或写入验收记录；账号/token/数据库凭据均未打印。
- Verifier 新增自动验证外网 TLS，以及创建数据前连接失败的清晰提示。仍待远程验收成功；本次没有需要清理的新增测试数据。

## staging 验收完成（2026-09-13）

- 使用当前本地配置连接实际 Render staging API 与同一 `lauver_staging` 数据库，执行 `npm run verify:step-06:staging --prefix backend`。
- 初次继续执行时前 24 项通过，但长分页期间数据库连接意外断开，未处理的 pg error event 导致脚本退出。立即用该 run 的 `--cleanup-state` 恢复，确认 34 个账户及关联数据全部删除。
- 修复 verifier：fixture SQL 完成后关闭数据库连接，HTTP 验收结束后通过新连接清理；处理 pg error event，异常时停止验收并尝试清理，保留失败恢复 journal。
- 修复后远程重跑 **44/44 通过**，包括认证、固定排序 10 次、半径内外边界、运动/配速组合、缺 pace、默认分页、页大小 1/7/20 全量遍历、非法参数、游标签名/参数/用户隔离、双向 Block、暂停/删除/未完成排除和新 session。
- 最终输出：`{"result":"passed","checks":44,"deletedAccounts":34}`；确认全部 34 个 fixture 和级联数据删除，旧 viewer access token 返回 401，恢复 journal 删除。
- 持久化远程证据：[step-06-staging-20260913.log](step-06-staging-20260913.log)。无密码、token 或连接串。
- 新增强制终止 fixture 数据库连接的集成测试，验证脚本通过新连接清理且无 fixture 残留。本地 PostgreSQL 从零 migration 和 integration **25/25**，Backend unit **109/109**、lint、typecheck、Step 06 structure、MVP scope、secret scan 和 diff hygiene 通过。
- 使用既有开发签名对已连接的 iPhone 14 Plus 构建 staging App，`BUILD SUCCEEDED`，已安装 `ai.lauver.app.staging`。构建日志：`/tmp/lauver-step06-device-build.log`。
- 解锁后在 iPhone 14 Plus 运行现有 Discover navigation/filter XCUITest：**1/1 通过，TEST SUCCEEDED**。验证列表 → Profile → 返回 → Filter Sheet → Cycling → 空状态与无 Like 按钮；日志 `/tmp/lauver-step06-device-ui-20260913.log`，结果 bundle `/tmp/lauver-step06-device-20260913.xcresult`。该测试使用 fake Discover/Profile service；真机与实际 staging API 的刷新、分页及断网重试仍需单独确认。
- 真机结果摘要：[step-06-device-20260913.log](step-06-device-20260913.log)。自动测试结束后重新启动 App，未带 fake service 参数，恢复正常 staging API 连接，待用户实际操作确认。

## 真机实际 API 手动验收准备（2026-09-13）

- 用户确认设备已解锁后，再次启动正常 staging App。只读检查发现仅 3 个完整 ACTIVE Profile、2 个城市中心点，原有数据不足以测试默认 20 条分页。
- 已在这 2 个城市中心点各创建 22 个临时 Email 资料，共 **44 个账户**；显示名以 `Step 06` 开头，包括 Running moderate/fast/easy 和 Cycling moderate。没有照片、外部授权或第三方数据；未改动原有账户。
- 这批资料与上节 34 个 API 自动验收 fixture 为不同 run。收到用户“目前没太大问题”的总体反馈后已执行清理，**44 个账户及全部级联数据删除，journal 删除**；日志 `/tmp/lauver-step06-device-fixture-cleanup.log`。
- 清理 journal：`/var/folders/wl/6jksmff92qv0z1xnvz_2l5300000gn/T/lauver-step06-device-live-n1pWWI/cleanup.json`（私有权限；仅包含本 run 精确 email 清单）。测试结束后执行：

  ```bash
  npm run verify:step-06:staging --prefix backend -- --cleanup-state /var/folders/wl/6jksmff92qv0z1xnvz_2l5300000gn/T/lauver-step06-device-live-n1pWWI/cleanup.json
  ```

- 用户对实际操作反馈“目前没太大问题”，未逐条确认全部测试；同时请求增加 20–100 km 和不限距离选项。按该反馈继续扩展范围，新的范围还需 staging 部署和真机实际 API 复验。
- 用户随后明确确认正常 staging App 的 Discover“有用户列表”，记录实际列表加载通过；该反馈不代表新增半径选项已部署或新版全部交互均已复验。

## 半径扩展（2026-09-13）

- 新增 20–100 km、每 10 km 一档和 `Unlimited`，API 使用 `radius=unlimited` 表示不设距离上限。原有默认 25 km 可继续使用。
- Unlimited 只取消距离上限；运动/配速筛选、双向 Block、账户状态/资料完整排除、城市中心点距离排序、分页和坐标隐私均保持。
- 有限范围与 Unlimited 的游标相互隔离，切换范围从第一页重新加载。
- 新增固定约 50、99、111 km 资料的 PostgreSQL 集成测试，验证扩大范围的实际过滤以及不限范围全量分页无重复/遗漏。共享测试数据库的 suites 改为顺序执行，避免不限范围看到同时运行的其他 suite fixture。
- 新测试发现已有 Prisma 浮点参数精度问题：`6.6717048140119735` 作为数值绑定会变成 `6.671704814011973`，使下一页重复出现上一页末尾用户。改为绑定 round-trip 十进制字符串后 cast double precision；独立 SQL probe 确认数值/字符串参数不相等，修复后回归通过。
- Backend unit **110/110**，PostgreSQL migration-from-zero 与 integration **26/26** 通过；OpenAPI、README 与 mvp.md 的范围说明已同步。
- 新版 Simulator Discover unit **7/7**、UI **1/1** 通过，UI 实际选择 100 km / Unlimited 并检查摘要，再切换 Cycling；日志 `/tmp/lauver-step06-radius-simulator.log`，bundle `/tmp/lauver-step06-radius-simulator.xcresult`。新版真机测试启动时设备再次锁定，已停止等待；不以 Simulator 结果声称新版真机 API 验收完成。
- 新版 staging / production 构建配置检查均通过：`scripts/test-ios-config.sh`；日志 `/tmp/lauver-step06-radius-config.log`。Backend lint / typecheck / build、structure、MVP scope、secret scan 和 diff hygiene 均通过。
- staging 的 44/44 证据属于此前范围版本；新增范围和精度修复尚未部署，不以旧 staging 结果替代新版验收。
- 新版本地验证摘要：[step-06-radius-20260913.log](step-06-radius-20260913.log)。

## 实际配速范围（2026-09-13）

- 用户要求去除 Fast/Slow 等主观分档，按实际自报数值筛选。Discover 现使用可选 `paceMin` / `paceMax` 闭区间，必须指定 sport，允许一端留空；两端都有值时下限不得大于上限。
- 原生筛选输入：Running / Trail Running / Walking / Hiking 为 mm:ss/km，Swimming 为 mm:ss/100m，Rowing 为 mm:ss/500m，Cycling 为 km/h。非法格式、运动的范围外值和倒序范围禁用 Apply；切换运动清空原范围，重新打开 Sheet 回填数值。
- 筛选摘要和 Profile 保留实际数值与对应单位；不再展示主观分档。cycling 小数显示至保存精度，避免把很窄的范围两端显示成同一数值。
- 后端直接比较 `pace_value`，有范围时排除 NULL；移除分类计算与 response 的 `paceBracket`，旧分类参数返回 422。签名游标绑定两个数值端点。
- 新 migration 提高 `pace_value` 到 Decimal(9,6)，按显示的整秒规范化旧 duration 值，保留 cycling 数值；删除派生分类字段，重建 sport/pace_value 索引，并保留 pace/unit 的完整性约束。新 duration 写入也以整秒规范化，确保精确 mm:ss 范围能命中保存的资料。
- 本地 Backend unit **123/123**，PostgreSQL migration-from-zero / integration **28/28**（含所有运动的双端点、单值范围与真实旧数据 migration）通过。verifier 已同步数值范围、cycling 单值/区间、开区间一端留空和范围游标隔离检查；其完整本地 HTTP 生命周期与清理测试通过。
- 最终 iOS XCTest **75/75**，Discover XCUITest **1/1**，验证 100 km / Unlimited、非法 `5:60` 禁用 Apply、`5:01–5:30` / 回填、运动切换清空范围和 `20.5–30 km/h`；`TEST SUCCEEDED`。Profile editor UI 回归另有 **1/1** 通过。
- 初次 UI 复验出现列表空白区域点击未导航，增加整行 contentShape 后导航复验通过；另一次直接读取异步筛选摘要过早，改为等待摘要更新后通过。
- 日志：`/tmp/lauver-step06-numeric-pace-unit-final.log`、`/tmp/lauver-step06-numeric-pace-integration-final.log`、`/tmp/lauver-step06-numeric-pace-final.log`；最终 bundle `/tmp/lauver-step06-numeric-pace-final.xcresult`，Profile UI 证据在 `/tmp/lauver-step06-numeric-pace.xcresult`。
- 最终 staging / production 构建检查通过，日志 `/tmp/lauver-step06-numeric-pace-config-final.log`；Backend lint / typecheck / build、Step 05/06 structure、MVP scope、secret scan 和 diff hygiene 通过。
- 新范围、实际配速筛选及 migration 仍待部署；此前远程 44/44 和真机反馈属于旧版，不代表新版远程验收完成。
- 持久化本地验证摘要：[step-06-numeric-pace-20260913.log](step-06-numeric-pace-20260913.log)。

## 继续验收：新版真机与部署核对（2026-09-13）

- 只读查询实际 staging 数据库：最新已应用 migration 为 `20260913000000_discover_block_policy`；`pace_value` 仍为 Decimal(7,2)，`pace_bracket` 仍存在。新增 `20260913010000_explicit_pace_ranges` 尚未应用；GitHub main 仍为 `d28b088`，数值配速与半径扩展仍在本地工作区。
- 本轮未写入 staging fixture 或修改远端数据库；需将新版后端代码与 migration 一起部署，再运行新版 verifier，避免旧代码访问已删除的分档字段。
- Backend lint / typecheck / build、unit **123/123**、隔离 PostgreSQL migration-from-zero / integration **28/28** 通过；临时 PostgreSQL 已停止。Step 06 structure、MVP scope、secret scan、diff hygiene 与 staging / production 构建配置检查通过。
- 已连接 iPhone 14 Plus（iOS 18.7.8）运行 XCTest **75/75** 通过。新增范围真机 XCUITest 首次失败于空输入框 value 断言：iOS 18 返回 nil，Simulator iOS 26 返回占位文字。调整为等待输入框存在且值为空或占位文字，仍验证运动切换清空旧配速。
- 修复后的新版真机 Discover XCUITest **1/1** 通过，`TEST SUCCEEDED`；覆盖列表 → Profile → 返回、100 km / Unlimited、非法 `5:60` 禁用 Apply、`5:01–5:30` 与回填、切换 Cycling 清空旧范围、`20.5–30 km/h` 与空状态。
- 上述真机 UI 使用固定 Discover/Profile service，不代表新版真实 API 筛选、分页、刷新与断网重试已通过。Step 06 继续保持待完成状态。
- 日志：`/tmp/lauver-step06-continue-backend.log`、`/tmp/lauver-step06-continue-integration.log`、`/tmp/lauver-step06-continue-config.log`、`/tmp/lauver-step06-continue-device-valid.log`（75 项 XCTest 与首次 UI 失败）、`/tmp/lauver-step06-continue-device-final.log`（修复后 UI 通过）。Bundle：`/tmp/lauver-step06-continue-device-valid.xcresult`、`/tmp/lauver-step06-continue-device-final.xcresult`。
- 修改后的同一 Discover UI 测试在 iOS 26.5 Simulator **1/1** 回归通过，`TEST SUCCEEDED`；日志 `/tmp/lauver-step06-continue-simulator.log`，bundle `/tmp/lauver-step06-continue-simulator.xcresult`。测试后已在真机重新启动正常 staging App，未带固定数据 service 参数。
- 持久化验证摘要：[step-06-continue-20260913.log](step-06-continue-20260913.log)。新版部署需要提交并推送本轮 Step 06 改动至 GitHub main，由既有 CI / Render 流程完成；部署后执行 `npm run verify:step-06:staging --prefix backend` 并补充真机实际 API 复验。
- 用户已明确授权由代理提交、推送 main、触发 Render staging 部署并继续新版 API 验收。
