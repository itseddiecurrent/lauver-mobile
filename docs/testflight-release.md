# TestFlight release handoff

更新时间：2026-09-21

这份文档把 Step 15 收口到“可以提交 TestFlight”所需的最后一段流程。后端部署目标是 Render；仓库中的 `render.yaml` 不保存数据库 secret，Render 上已配置加密的 `SUPABASE_DATABASE_URL`。

## 当前已验证

- Render staging：`/healthz` 和 `/readyz` 均为 HTTP 200，`/readyz` 报告 `database: ok`。
- Backend：190/190 Vitest 通过；migration-from-zero/integration：17 个 migration、71/71 通过。
- 真机：连接的 iPhone 17e（UDID `00008150-00010C6E22C0C01C`）原生 XCTest 109/109 通过。Step 15 的测试只允许使用这个 physical-device destination，不使用 Simulator。
- `Lauver-Production` archive 已成功，bundle ID 为 `ai.lauver.app.release`，Team ID 为 `94KFUD562T`，HealthKit 和 Sign in with Apple entitlements 已包含。随后 `exportArchive` 已成功生成可上传 TestFlight 的 Distribution IPA：[`Lauver.ipa`](../artifacts/acceptance/step-15-production-distribution-20260921/Lauver.ipa)，签名为 Apple Distribution，`beta-reports-active=true` 且 `get-task-allow=false`。
- scope check 和 secret scan 已通过。

证据见 [`report.md`](../report.md)、[`artifacts/acceptance/final-test-report.md`](../artifacts/acceptance/final-test-report.md)、真机日志 [`step-15-iphone17e-unit-current.log`](../artifacts/acceptance/step-15-iphone17e-unit-current.log)、archive 日志 [`step-15-production-distribution-archive-20260921.log`](../artifacts/acceptance/step-15-production-distribution-archive-20260921.log) 和 export 日志 [`step-15-production-distribution-export-20260921.log`](../artifacts/acceptance/step-15-production-distribution-export-20260921.log)。

## Render 部署

提交经过验证的变更后推送 `origin/main`，Render Blueprint 会自动部署：

```bash
git push origin main
/usr/bin/curl --http1.1 --fail-with-body https://lauver-api-staging.onrender.com/healthz
/usr/bin/curl --http1.1 --fail-with-body https://lauver-api-staging.onrender.com/readyz
```

只有 `/readyz` 返回 HTTP 200 且 `database` 为 `ok`，才可以继续做新的 staging 账号和真机 E2E。不要把 `SUPABASE_DATABASE_URL` 写入 `render.yaml`、`.xcconfig`、iOS bundle 或 git。

## 每次发布前的真机回归

下面的命令会拒绝未连接的设备，并且明确把 XCTest 绑定到实体 iPhone 17e：

```bash
./scripts/test-step-15-device.sh
```

也可以手工执行：

```bash
xcodebuild \
  -project LauverNative/Lauver.xcodeproj \
  -scheme Lauver-Staging \
  -configuration Staging \
  -destination 'id=00008150-00010C6E22C0C01C' \
  -only-testing:LauverTests \
  test
```

不要使用 `platform=iOS Simulator`、`-destination ... Simulator` 或 `xcrun simctl` 代替这一步。

## 还需要在 App Store Connect 完成的外部步骤

本机已经具备 team `94KFUD562T` 的 Apple Distribution certificate 和 `ai.lauver.app.release` Store provisioning profile，并已生成可上传 IPA。剩余步骤是：

- 在 App Store Connect 补齐 Privacy Policy、Terms、App Privacy、Export Compliance、Review Notes 和审核账号；
- 上传下方生成的 `Lauver.ipa`，等待 processing 完成；
- 先加入 Internal Testers，并用两普通用户 + 一管理员完成 TestFlight E2E；
- 由于不新增 Render service，当前内部 TestFlight build 使用现有 staging backend；公开生产提交前仍需完成正式 API/DNS/TLS 切换。

为了不新增 Render service 费用，当前 `Lauver-Production` 的内部 TestFlight build 暂时指向现有 `https://lauver-api-staging.onrender.com`。这类 build 必须只分发给 Internal Testers，并在 App Store Connect / Review Notes 中明确是 staging backend；它使用 staging 数据、staging secrets 和 Render free-plan 的可用性，不应提交为公开生产版本。`api.lauver.ai` 的 DNS/TLS 修复仍保留为未来正式生产切换事项。

## 可重复的 archive/export 命令

当前按用户要求继续使用现有 Render staging，不新增 Render service。先确认 `/readyz` 为 200，再执行：

```bash
xcodebuild \
  -project LauverNative/Lauver.xcodeproj \
  -scheme Lauver-Production \
  -configuration Production \
  -destination 'generic/platform=iOS' \
  -archivePath artifacts/acceptance/lauver-production.xcarchive \
  -allowProvisioningUpdates \
  archive
```

然后用仓库中的 [`step-15-export-options.plist`](../artifacts/acceptance/step-15-export-options.plist) 导出 Distribution IPA：

```bash
xcodebuild -exportArchive \
  -archivePath artifacts/acceptance/lauver-production.xcarchive \
  -exportOptionsPlist artifacts/acceptance/step-15-export-options.plist \
  -exportPath artifacts/acceptance/testflight-export \
  -allowProvisioningUpdates
```

本轮已验证的 IPA 在 [`artifacts/acceptance/step-15-production-distribution-20260921/Lauver.ipa`](../artifacts/acceptance/step-15-production-distribution-20260921/Lauver.ipa)。可在 Xcode Organizer 选择 archive Validate App，也可直接在 Transporter/Xcode Organizer 中上传 IPA。上传完成后，在 App Store Connect 的 TestFlight 页面等待 processing，再先给内部测试组发放 build。

导出或上传前检查：bundle ID、版本号/build 号、API endpoint、签名 entitlements、HealthKit purpose string、无数据库/Stream/Apple/Strava secret，并重新运行 scope 和 secret scan。

## App Review 资料草案

审核说明至少应覆盖：注册/登录、完善资料和最多 9 张照片、Discover、Like/Pass、互相 Like 后聊天、活动创建/加入、Report/Block、Apple Health 可选导入、Strava 可选连接，以及 Settings 中永久删除账户。提供两个普通测试账号和一个管理员审核账号，账号必须指向已经可用的 staging/production 数据库。

App Privacy 需要按最终线上配置在 App Store Connect 逐项确认，至少复核：账号邮箱、姓名/资料、照片和聊天/活动用户内容、近似位置、HealthKit workout 摘要，以及是否收集诊断数据。Privacy Policy 和 Terms 必须是审核设备可访问的真实 URL；仓库不代替外部法律页面。
