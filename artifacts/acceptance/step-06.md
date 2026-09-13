# Step 06 — Discover 手动筛选列表

日期：2026-09-13。状态：实现与本地验证完成；Render staging 和真机验收待执行。

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

- Render staging 部署本次实现和 migration，使用至少两个完整资料账户验证 API 和 App 组合筛选/分页。
- 真实 iPhone：Discover 列表 → Profile，筛选 Sheet、刷新、分页、断网重试；检查近似距离与坐标隐私。
- PostgreSQL 仅在 `/tmp/lauver-step06-pg` 的隔离临时测试实例运行，验收后已停止；不使用现有 staging/production 数据库。
