# Step 15 acceptance

详细记录见根目录 [report.md](../../report.md)。

当前状态：🟡 Render→Supabase schema-only cutover、post-cutover API smoke、archive、真机 XCTest、两账号 Match/Stream live E2E 和账户删除真机 UI 流程完成；仅正式签名 IPA、TestFlight/App Store Connect 和最终 Product Owner 签收仍未完成。未发现 App 闪退。

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

## Production archive handoff (2026-09-21)

- 当前 commit 的 Production archive 已实际尝试，目标为 `generic/platform=iOS`，没有启动 Simulator。
- Archive 被 Apple Developer provisioning 阻止：bundle ID `ai.lauver.app` 无法由当前 team 注册，通配 profile 不包含 HealthKit 和 Sign in with Apple。完整输出见 [`step-15-production-archive-20260921.log`](step-15-production-archive-20260921.log)。
- TestFlight 提交前还需完成 Apple Developer App ID/capabilities、Distribution certificate/profile、App Store Connect App、Privacy/Terms URL、App Privacy、Review Notes 和可用的 Production API。操作顺序见 [`docs/testflight-release.md`](../../docs/testflight-release.md)。
