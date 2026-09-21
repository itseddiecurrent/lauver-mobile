# Step 15 真机发布验收报告

日期：2026-09-21  
设备：实体 iPhone 17e（iPhone18,5），iOS 26.6.1，UDID `00008150-00010C6E22C0C01C`  
构建：`Lauver-Staging`，bundle `ai.lauver.app.staging`

## 结论

本轮没有发现 App 闪退。真机 XCTest 109/109 通过；完整 XCUITest 26 个用例为 18 通过、5 跳过、3 失败。失败均为 XCTest 断言或测试数据前置条件，不是 crash。报告中的“失败节点”已全部列出，避免把测试失败误记为闪退。

## 真机执行记录

- [x] 未使用 Simulator；所有 `xcodebuild test` 均指定实体设备 UDID。
- [x] Staging device build succeeded。
- [x] App 已通过 `devicectl device install app` 安装并通过 `devicectl device process launch` 启动。
- [x] `LauverTests`：109/109 passed。
- [x] XCUITest 完整流程：26 total，18 passed，5 skipped，3 failed。
- [x] Staging archive：`artifacts/acceptance/step-15-staging.xcarchive`，`ARCHIVE SUCCEEDED`。

## 失败节点与闪退核对

| 节点 | 结果 | 现象 | 是否闪退 |
|---|---|---|---|
| `testLiveMatchSummaryOnAuthenticatedDevice` | FAIL | 找不到 authenticated Match summary，`XCTAssertTrue` 失败 | 否；App 仍在运行并完成 teardown |
| `testLiveStreamChatConnectsOnDevice` | FAIL | 登录后 `screen-messages` 未在 30 秒内出现，`XCTAssertTrue` 失败 | 否；App 仍在运行并完成 teardown |
| `testSettingsDeleteAccountRequiresConfirmationAndReturnsToLogin` | FAIL | `settings-delete-account` 未达到测试要求的 hittable 状态，`XCTWaiterResult` 不符合预期 | 否；App 仍在运行并完成 teardown |
| 其他完整流程节点 | PASS/SKIP | Match、Strava Connected Apps、注册/退出/重新登录、Discover filters、Report/Block/Unblock、Profile、Accessibility、Visual Baseline、offline retry 等完成 | 未发现闪退 |

Xcode result summary 明确记录 `failedTests=3`、`passedTests=127`、`skippedTests=5`，没有 crash、SIGABRT、SIGSEGV、watchdog 或 termination 记录。结果 bundle：`artifacts/acceptance/step-15-device-tests-unlocked.xcresult`。

## Backend、Render 与安全检查

- Backend Vitest：187/187 passed。
- Backend typecheck、lint、production build：passed。
- `scripts/check-mvp-scope.sh`：passed。
- `scripts/check-secrets.sh`：passed。
- Render staging `/healthz`：HTTP 200，`{"status":"ok","service":"lauver-api"}`。
- Render staging `/readyz`：HTTP 200，`{"status":"ready","service":"lauver-api","database":"ok"}`。

## 尚未签收的事项

1. 上述 3 个 UI 失败需要分别补齐 staging Match/Stream 测试数据和 Delete Account UI 可点击性后重跑。
2. TestFlight 上传、App Store Connect App Privacy/Review Notes 和正式签名 IPA 尚未在本机完成；当前仅完成 staging archive 和真机开发签名安装。
3. 根目录旧 Expo `__tests__/schema/db_schema.test.js` 针对历史 Supabase schema，当前仓库没有对应 Supabase CLI/目标 schema；本轮未将其失败误算为当前 Express/Prisma backend 的 Step 15 失败。

