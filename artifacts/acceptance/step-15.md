# Step 15 acceptance

详细记录见根目录 [report.md](../../report.md)。

当前状态：🟡 Render→Supabase schema-only cutover、post-cutover API smoke、archive、真机 XCTest、两账号 Match/Stream live E2E 和账户删除真机 UI 流程完成；仅正式签名 IPA、TestFlight/App Store Connect 和最终 Product Owner 签收仍未完成。未发现 App 闪退。

设备证据：实体 iPhone 17e（UDID `00008150-00010C6E22C0C01C`），未使用 Simulator。结果 bundle：`step-15-device-tests-unlocked.xcresult`；补跑结果记录在根目录 `report.md`。

## Step 15 UI follow-up (2026-09-21)

- 登录页已移除登录前显示的 `Staging environment` / `Production environment` 环境标识。
- Discover 与 Match 先读取当前 profile；缺少城市位置或城市中心坐标时显示本地化提示：英文 `Complete your profile location to start discovering/matching`，简体中文 `请完善个人资料中的位置，以开始发现/匹配`，不再显示 `Unable to connect` 错误态。
- 实体 iPhone 17e 定向 UI XCTest：2/2 passed，覆盖上述登录页和未完成 profile 的 Discover/Match 状态；未使用 Simulator。
- Render staging 的加密 `SUPABASE_DATABASE_URL` 已配置；`render.yaml` 仅声明 `sync: false`，不会记录 secret。验证后的 `origin/main` push 会触发 Render 部署。
