# Step 15 acceptance

详细记录见根目录 [report.md](../../report.md)。

当前状态：🟡 Render→Supabase schema-only cutover、post-cutover API smoke、archive、Distribution IPA、真机 XCTest、两账号 Match/Stream live E2E 和账户删除真机 UI 流程完成；IPA 已到可上传 TestFlight 的阶段，仍需 App Store Connect 上传/processing、商店资料、内测 E2E 和最终 Product Owner 签收。未发现 App 闪退。

设备证据：实体 iPhone 17e（UDID `00008150-00010C6E22C0C01C`），未使用 Simulator。结果 bundle：`step-15-device-tests-unlocked.xcresult`；补跑结果记录在根目录 `report.md`。

## Step 15 UI follow-up (2026-09-21)

- 登录页已移除登录前显示的 `Staging environment` / `Production environment` 环境标识。
- Discover 与 Match 先读取当前 profile；缺少城市位置或城市中心坐标时显示本地化提示：英文 `Complete your profile location to start discovering/matching`，简体中文 `请完善个人资料中的位置，以开始发现/匹配`，不再显示 `Unable to connect` 错误态。
- 实体 iPhone 17e 定向 UI XCTest：3/3 passed，覆盖上述登录页、英文和简体中文未完成 profile 的 Discover/Match 状态，并验证简体中文 Discover/Events 标题、距离说明、底部 Tab 及 `全部`/`已创建`/`已参加` 筛选标签；未使用 Simulator。
- Render staging 的加密 `SUPABASE_DATABASE_URL` 已配置；`render.yaml` 仅声明 `sync: false`，不会记录 secret。验证后的 `origin/main` push 会触发 Render 部署。

## Chat localization follow-up (2026-09-21)

- Stream Chat 空页 key 已接入原生语言选择；英文和简体中文均覆盖 channel list、empty channel 和 empty messages 文案。
- 实体 iPhone 17e 更新包真机回归：原生 XCTest 109/109 passed；完整 UI XCTest 28 项为 20 passed、5 skipped、3 个既有 staging 前置条件失败；未使用 Simulator，未发现闪退。
- 定向中文 UI XCTest 3/3 passed；Stream 空频道视觉文案还需要一个真实登录账号的空频道进行最终人工点验。详细记录见 [`step-15-chat-localization.md`](step-15-chat-localization.md)。
- 最新 Render `/healthz` 和 `/readyz` 均为 HTTP 200，`/readyz` 报告 `database: ok`；已配置的加密 `SUPABASE_DATABASE_URL` 未进入仓库。

## Production archive/export handoff (2026-09-21)

- 当前 commit 的 `Lauver-Production` archive 已成功，目标为 `generic/platform=iOS`，没有启动 Simulator；bundle ID 为 `ai.lauver.app.release`，HealthKit 和 Sign in with Apple entitlements 已包含。输出见 [`step-15-production-distribution-archive-20260921.log`](step-15-production-distribution-archive-20260921.log)。
- `exportArchive` 已成功生成 [`Lauver.ipa`](step-15-production-distribution-20260921/Lauver.ipa)，并验证 Apple Distribution、Store provisioning profile、`beta-reports-active=true`、`get-task-allow=false`；输出见 [`step-15-production-distribution-export-20260921.log`](step-15-production-distribution-export-20260921.log)。TestFlight 提交前只剩 App Store Connect 上传/processing、商店资料和内测验收。操作顺序见 [`docs/testflight-release.md`](../../docs/testflight-release.md)。

## Upload validation follow-up (2026-09-21)

- Transporter 对 build `1.0.0 (1)` 返回 Apple error `90683`：HealthKit entitlement 还要求 `NSHealthUpdateUsageDescription`。原生 `Info.plist` 已补充明确的用户说明，即使 Lauver 只读 Apple Health Workout 摘要、不会写入健康数据。
- archive 同时发现 App Icon catalog 缺少 iPhone 和 `ios-marketing` slots；已由既有 1024px 品牌图生成完整图标集，后续 archive 不再产生该 warning。
- build 已递增为 `1.0.0 (3)`，实体 iPhone 17e 原生 XCTest 109/109 通过，未使用 Simulator。新的 archive 和 Distribution export 均成功。
- 新 IPA：`artifacts/acceptance/testflight-build3-20260921/Lauver.ipa`；签名为 Apple Distribution，包含 HealthKit 两个 purpose strings、完整 App Icon catalog、Sign in with Apple、`beta-reports-active=true` 与 `get-task-allow=false`。等待重新上传到 App Store Connect。

## Transporter 90683 follow-up (2026-09-21)

- Transporter 随后报告缺少 `NSPhotoLibraryUsageDescription` 和 `NSMicrophoneUsageDescription`。前者已如实说明仅访问用户选择的 Profile 照片；后者及二进制已引用的 Camera API 均如实说明 Lauver 不采集音频或相机内容，而是由未使用的聊天 framework API 引用触发声明要求。
- build 已递增为 `1.0.0 (4)`。实体 iPhone 17e 原生 XCTest 109/109 再次通过；Production archive/export 成功，最终 IPA 已逐项校验包含五个 required purpose strings、Apple Distribution 签名和正确 bundle ID。
- 请上传 `artifacts/acceptance/testflight-build4-20260921/Lauver.ipa`，SHA-256 `d9f40fecbc68c00ea321f45892f7e4d6d69a2a1e9e0ddcfcab781648b291f7a4`。
