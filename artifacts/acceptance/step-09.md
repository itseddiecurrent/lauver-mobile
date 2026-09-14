# Step 09 — HealthKit Workout Import

日期：2026-09-14。状态：🟡 已实现，待真实 iPhone 权限和 staging migration 验收。

## 已实现

- iOS HealthKit entitlement 与 `NSHealthShareUsageDescription`，明确只读 workout 摘要范围。
- HealthKit 完全 opt-in：启动、注册、登录、Profile 和普通 Connected Apps 列表均不会创建 `HKHealthStore` 或请求权限。
- `AppleHealthWorkoutStore` 只读取 `HKWorkoutType`，`toShare` 始终为空；映射 workout UUID、运动类型、开始/结束时间、时长和距离，不读取心率、睡眠、医疗记录或路线。
- Connected Apps 增加 Apple Health 页面，支持 Enable、手动 Import、不可用/空结果/错误状态；拒绝授权不会影响其他功能。
- 后端新增 `health_workouts` migration 与 `/v1/integrations/healthkit/workouts` GET/POST/DELETE；按 `(user_id, workout_uuid)` upsert，导入请求最多 100 条，健康数据默认仅本人可见。
- 原生导入通过认证 API 上传摘要；删除接口清除当前用户的服务器记录，系统 HealthKit 权限仍由 iOS Settings 管理。

## 本地验证

- Backend `npm run lint` 通过，`npm test` **142/142** 通过，`npm run typecheck` 与 production build 通过。
- iOS Staging Simulator build **成功**，HealthKit SDK 编译通过；未在模拟器请求系统权限。
- `git diff --check` 通过；未运行真实 iPhone HealthKit 授权、staging migration deploy 或健康数据网络检查。

## 待验收

- 在真实 iPhone 主动 Enable Apple Health，验证允许、拒绝、部分授权和空样本。
- 执行真实 Import 两次并核对 `(user_id, workout_uuid)` 只保留一条。
- 执行 Delete Imported Data，确认服务器记录清除；验证 Disconnect 只说明系统权限需在 Settings 管理，不伪称撤销权限。
- staging 部署 migration 后执行 API authorization、幂等和最小字段检查。

## 2026-09-14 真机修复记录

- 真机导入返回 `workouts.*.distanceMeters: expected number, received undefined`；原因是没有距离的 HealthKit workout 由 Swift `Codable` 省略可选字段，而后端曾要求字段存在。
- 后端已将 `distanceMeters` 校验改为可选，缺省按 `null` 保存；lint、typecheck、build、142/142 tests 通过，提交 `ecc63fe` 已推送并部署。线上 HealthKit route 返回 401（需要登录），说明新路由已生效。
- 客户端已增加自定义 Codable 编码：无距离的 workout 也明确发送 `distanceMeters: null`，避免可选字段被编码为 `undefined`；已重新构建并安装到真机，待再次点击 Import 验证。
- 修复导入后列表读取失败：API 列表响应已将数据库字段 `workoutUUID` 映射为客户端约定的 `id`，避免显示 “The service returned an unexpected response”；提交 `fd771b8` 已推送，等待 staging 自动部署。
