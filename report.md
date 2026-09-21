# Step 15 真机发布验收报告

日期：2026-09-21  
设备：实体 iPhone 17e（iPhone18,5），iOS 26.6.1，UDID `00008150-00010C6E22C0C01C`  
构建：`Lauver-Staging`，bundle `ai.lauver.app.staging`

## 结论

本轮没有发现 App 闪退。真机 XCTest 109/109 通过；完整 XCUITest 28 个用例为 20 通过、5 跳过、3 失败。失败均为 XCTest 断言或 staging 测试数据前置条件，不是 crash。当前 `ai.lauver.app.release` 内部 TestFlight 配置已指向现有 Render staging API，Production archive 包含 HealthKit/Sign in with Apple entitlements，并已导出 Apple Distribution 签名的可上传 TestFlight IPA。

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

1. 两账号 Match/Stream live E2E 已使用本机测试账号在实体 iPhone 17e 重跑通过；账户删除 UI 已改为可滚动、大尺寸真机 sheet，并在有效签名下重跑通过（1/1）。
2. IPA 已完成 Distribution export；仍需在 App Store Connect 上传并等待 processing，补齐 App Privacy/Review Notes、审核账号和内部 E2E。
3. 内部 TestFlight 使用 Render staging：`/healthz` 和 `/readyz` 均已恢复 HTTP 200，`database: ok`；正式 `api.lauver.ai` DNS/TLS 切换仍未完成。
4. 根目录旧 Expo `__tests__/schema/db_schema.test.js` 针对历史 Supabase schema，当前仓库没有对应 Supabase CLI/目标 schema；本轮未将其失败误算为当前 Express/Prisma backend 的 Step 15 失败。

## Supabase / native runtime verification (2026-09-21)

- Native `Lauver-Staging` build settings: `API_BASE_URL=https://lauver-api-staging.onrender.com`, version `1.0.0` (build `1`); no Supabase URL/key or Supabase SDK is present in the native target.
- Render staging `/healthz` and `/readyz` returned HTTP 200; `/readyz` reported `database: ok`.
- The legacy Expo client still initializes Supabase from `.env`, but direct REST probes returned `profiles.id` missing and `public.activities` missing. This is a legacy schema mismatch, not evidence that the native release app is connected to Supabase.
- Live Match/Stream acceptance rerun: 1/1 passed on the connected iPhone 17e; result bundle: `artifacts/acceptance/step-15-live-match-rerun.xcresult`.
- Account deletion UI rerun: 1/1 passed on the connected iPhone 17e; result bundle: `artifacts/acceptance/step-15-delete-final-2.xcresult`.

## Follow-up check (2026-09-21)

- The connected physical iPhone 17e is `Edward的iPhone`, UDID
  `00008150-00010C6E22C0C01C`. The native XCTest rerun targeted that device
  explicitly; no Simulator was used.
- Render `/healthz` returned HTTP 200, while `/readyz` returned HTTP 503
  `service_unavailable`. The earlier `/readyz` HTTP 200 entry above is retained
  as historical evidence from before the current deployment state.
- Render already has the encrypted `SUPABASE_DATABASE_URL` configured; the
  current verified push triggers the cutover deployment. Post-cutover live E2E
  is signed off only after `/readyz` returns HTTP 200 again.
- The project owner manually triggered Render deployment for `4c690b2` and
  Render reported it successful. Repeated probes after deployment still show
  `/healthz` HTTP 200 and `/readyz` HTTP 503, so the database readiness issue
  remains open and no post-cutover live E2E is claimed.

## Supabase TLS remediation (2026-09-21)

- Render logs showed Prisma `SELF_SIGNED_CERT_IN_CHAIN` while querying
  `ProfilePhotoUpload`.
- Added shared Supabase PostgreSQL TLS handling for Prisma and the Strava pool;
  Supabase connections remain encrypted while managed CA verification is
  relaxed, and Render PostgreSQL remains strict.
- Backend regression: 190/190 tests passed. Physical iPhone 17e native XCTest
  rerun: 109/109 passed; result log is
  `artifacts/acceptance/step-15-iphone17e-unit-after-tls.log`.
- Render manually deployed `b92f29b`; `/healthz` and `/readyz` now both return
  HTTP 200, with `/readyz` reporting `database: ok`. The certificate-chain
  readiness blocker is cleared.

## Release hardening and post-cutover smoke (2026-09-21)

- Local migration-from-zero/integration run applied all 17 Prisma migrations
  and passed 71/71 integration tests.
- Scope scan and corrected source/archive secret scans passed. The latest
  unsigned Staging iPhoneOS archive completed with `ARCHIVE SUCCEEDED` and
  contains the staging Render endpoint only; no embedded entitlements are
  expected because the archive intentionally used `CODE_SIGNING_ALLOWED=NO`.
- Deployed API smoke passed with two disposable users: registration, Profile,
  Match preferences, mutual Match, Matches listing, account deletion and old
  session rejection. Disposable accounts were deleted through the API.
- Full final report: `artifacts/acceptance/final-test-report.md`.

## Latest chat localization follow-up (2026-09-21)

- Stream Chat empty-state keys are now resolved through the selected native App language. English and Simplified Chinese cover `channelList.empty.*`, `channel.no-content.*`, and `channel.item.empty-messages`; the Chinese copy is recorded in `artifacts/acceptance/step-15-chat-localization.md`.
- The connected physical iPhone 17e ran the updated `Lauver-Staging` build with no Simulator destination: native XCTest 109/109 passed; full UI XCTest was 28 total, 20 passed, 5 skipped, and 3 existing staging prerequisite/data failures. No crash, SIGABRT, SIGSEGV, watchdog, or termination was recorded.
- The targeted Chinese UI regression remains 3/3 passed on the same device. The Stream empty-channel visual state itself needs a live account with an empty Stream channel for final manual confirmation.
- Latest Render probes after the verified deployment path: `/healthz` HTTP 200 and `/readyz` HTTP 200 with `{"status":"ready","service":"lauver-api","database":"ok"}`. The encrypted `SUPABASE_DATABASE_URL` is configured in Render and is not stored in git.

## Current release handoff (2026-09-21)

- Re-ran `LauverTests` on the connected physical iPhone 17e with UDID `00008150-00010C6E22C0C01C`; 109/109 passed. The command used an explicit `-destination id=...` and did not use a Simulator. Log: `artifacts/acceptance/step-15-iphone17e-current-unit.log`.
- Render probes at handoff: `/healthz` HTTP 200 and `/readyz` HTTP 200 with `database: ok`.
- The current `Lauver-Production` archive with `generic/platform=iOS` succeeded for `ai.lauver.app.release` and includes HealthKit and Sign in with Apple entitlements. Log: `artifacts/acceptance/step-15-production-release-archive-20260921.log`.
- Distribution signing and Store profile are now available locally. The latest archive/export produced an upload-ready IPA at `artifacts/acceptance/step-15-production-distribution-20260921/Lauver.ipa`; signature and entitlements were scanned successfully. The remaining handoff is App Store Connect upload/processing, metadata, internal TestFlight E2E, and final sign-off. The exact checklist is `docs/testflight-release.md`.

## Distribution export verification (2026-09-21)

- `xcodebuild -exportArchive` succeeded with `app-store-connect`; IPA SHA-256 is `2f5f58159766af6f125c44899f17bc59d09b7f921fa512aca125842f0a1f0648`.
- IPA metadata is `ai.lauver.app.release`, version `1.0.0 (1)`, API endpoint `https://lauver-api-staging.onrender.com`.
- Codesign is `Apple Distribution: Qianfu Tang (94KFUD562T)`; embedded profile is `iOS Team Store Provisioning Profile: ai.lauver.app.release`; `beta-reports-active=true`, `get-task-allow=false`, HealthKit and Sign in with Apple are present.
- Render probes immediately before handoff: `/healthz` and `/readyz` HTTP 200; `/readyz` reports `database: ok`.

## Transporter validation follow-up (2026-09-21)

- Apple Transporter rejected build `1.0.0 (1)` with error `90683` because the HealthKit entitlement requires `NSHealthUpdateUsageDescription` in addition to the existing read-purpose string.
- Added a truthful update-purpose string explaining that Lauver does not write to Apple Health, increased `CURRENT_PROJECT_VERSION` to `2`, and reran native XCTest on the physical iPhone 17e: 109/109 passed.
- Archive and Apple Distribution export for `ai.lauver.app.release` build `1.0.0 (2)` succeeded. The new IPA is `artifacts/acceptance/testflight-build2-20260921/Lauver.ipa` (SHA-256 `35c6e92f64c090237c4337eb9182b74193bec2b8f15c4876c0dc1a6240557a1a`); its final `Info.plist` contains both Health purpose strings, and its signature/entitlements remain valid for internal TestFlight.

## App Icon validation follow-up (2026-09-21)

- The initial App Icon catalog used only a universal entry and archive emitted warnings for missing iPhone and App Store icon slots. The catalog now contains the required iPhone sizes and an `ios-marketing` 1024px entry, all derived from the existing 1024px approved brand source.
- The final archive no longer has App Icon warnings. Physical iPhone 17e native XCTest again passed 109/109, without a Simulator.
- The final upload candidate is build `1.0.0 (3)`: `artifacts/acceptance/testflight-build3-20260921/Lauver.ipa`, SHA-256 `fe572f921d37c6979bdb7b994b000beaf065812b07a1cea09da728b3c3c26068`. It is Apple Distribution signed and includes both required HealthKit purpose strings.

## Additional privacy-string validation follow-up (2026-09-21)

- Transporter reported missing Photo Library and Microphone purpose strings. The final `Info.plist` now includes user-facing strings for Health read/update, photo selection, microphone, and camera. The microphone/camera strings truthfully state that Lauver does not record or collect that content; the declarations are required because the included chat framework references those APIs.
- Physical iPhone 17e XCTest passed 109/109 after this change, with no Simulator. Archive and Apple Distribution export for build `1.0.0 (4)` succeeded.
- Final IPA: `artifacts/acceptance/testflight-build4-20260921/Lauver.ipa`, SHA-256 `d9f40fecbc68c00ea321f45892f7e4d6d69a2a1e9e0ddcfcab781648b291f7a4`.
