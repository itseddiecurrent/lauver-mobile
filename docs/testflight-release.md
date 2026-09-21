# TestFlight release handoff

更新时间：2026-09-21

这份文档把 Step 15 收口到“可以提交 TestFlight”所需的最后一段流程。后端部署目标是 Render；仓库中的 `render.yaml` 不保存数据库 secret，Render 上已配置加密的 `SUPABASE_DATABASE_URL`。

## 当前已验证

- Render staging：`/healthz` 和 `/readyz` 均为 HTTP 200，`/readyz` 报告 `database: ok`。
- Backend：190/190 Vitest 通过；migration-from-zero/integration：17 个 migration、71/71 通过。
- 真机：连接的 iPhone 17e（UDID `00008150-00010C6E22C0C01C`）原生 XCTest 109/109 通过。Step 15 的测试只允许使用这个 physical-device destination，不使用 Simulator。
- `Lauver-Production` archive 已成功，bundle ID 为 `ai.lauver.app.release`，Team ID 为 `94KFUD562T`，HealthKit 和 Sign in with Apple entitlements 已包含；当前 archive 使用 Apple Development 签名，尚不是可上传 TestFlight 的 Distribution archive。
- scope check 和 secret scan 已通过。

证据见 [`report.md`](../report.md)、[`artifacts/acceptance/final-test-report.md`](../artifacts/acceptance/final-test-report.md)、真机日志 [`step-15-iphone17e-unit-current.log`](../artifacts/acceptance/step-15-iphone17e-unit-current.log) 和 Production archive 日志 [`step-15-production-release-archive-20260921.log`](../artifacts/acceptance/step-15-production-release-archive-20260921.log)。

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

## 还不能在本机完成的原因

本机当前只有 Apple Development 证书，没有 Apple Distribution 证书或 App Store provisioning profile。Production archive 已能以当前 Team 的 `ai.lauver.app.release` 构建成功，记录在 [`step-15-production-release-archive-20260921.log`](../artifacts/acceptance/step-15-production-release-archive-20260921.log)；它只能用于本机验证，不能直接上传 TestFlight。

需要在 Apple Developer / Xcode 账号中完成以下外部配置：

- 确认 team `94KFUD562T` 对 `ai.lauver.app.release` 有权；
- 为该 App ID 开启 HealthKit 和 Sign in with Apple；
- 创建/下载 Apple Distribution certificate 和 App Store provisioning profile；
- 创建或下载 Apple Distribution certificate 和 App Store provisioning profile，并在 Xcode Organizer Validate App；App Store Connect 中补齐 Privacy Policy、Terms、App Privacy、Export Compliance、Review Notes 和审核账号。

此外，当前 Production 配置指向 `https://api.lauver.ai`，本次核验中该域名 TLS 连接失败；正式 TestFlight build 不能在没有确认的生产 API 时提交。若暂时使用 Render staging 做内部 TestFlight，必须明确标为内部测试 build，并确认 App Store Connect 的 `ai.lauver.app.release` 与服务端环境策略一致。

## 有 Apple 交付权限后的命令

先在 `LauverNative/Config/Production.xcconfig` 配置已经上线并通过 `/readyz` 的生产 API，再使用 Xcode 自动签名归档：

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

在 Xcode Organizer 中选择该 archive，执行 Validate App，然后 Distribute App → App Store Connect → Upload。上传完成后，在 App Store Connect 的 TestFlight 页面等待 processing，再先给内部测试组发放 build。

导出或上传前检查：bundle ID、版本号/build 号、API endpoint、签名 entitlements、HealthKit purpose string、无数据库/Stream/Apple/Strava secret，并重新运行 scope 和 secret scan。

## App Review 资料草案

审核说明至少应覆盖：注册/登录、完善资料和最多 9 张照片、Discover、Like/Pass、互相 Like 后聊天、活动创建/加入、Report/Block、Apple Health 可选导入、Strava 可选连接，以及 Settings 中永久删除账户。提供两个普通测试账号和一个管理员审核账号，账号必须指向已经可用的 staging/production 数据库。

App Privacy 需要按最终线上配置在 App Store Connect 逐项确认，至少复核：账号邮箱、姓名/资料、照片和聊天/活动用户内容、近似位置、HealthKit workout 摘要，以及是否收集诊断数据。Privacy Policy 和 Terms 必须是审核设备可访问的真实 URL；仓库不代替外部法律页面。
