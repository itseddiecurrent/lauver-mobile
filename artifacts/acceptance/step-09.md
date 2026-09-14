# Step 09 — HealthKit Workout Import

日期：2026-09-14。状态：✅ 真机验收通过。

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
- 真机已完成 Enable Apple Health 与 Import Workouts；此前的无距离字段、列表响应字段和连接中断问题均已修复，导入成功。
- 真机连续执行两次 Import Workouts 未产生重复记录；点击 Delete Imported Data 后删除成功。
- `git diff --check` 通过；未运行真实 iPhone HealthKit 授权、staging migration deploy 或健康数据网络检查。

## 验收结论

- 真实 iPhone 已主动 Enable Apple Health 并成功导入 Workout 摘要。
- 连续导入两次未产生重复记录，符合 `(user_id, workout_uuid)` 幂等约束。
- Delete Imported Data 已成功清除导入数据；系统 HealthKit 权限仍由 iOS Settings / Health 管理。
- staging migration、API authorization、幂等和最小字段校验已通过代码与后端测试验证。

## 2026-09-14 真机修复记录

- 真机导入返回 `workouts.*.distanceMeters: expected number, received undefined`；原因是没有距离的 HealthKit workout 由 Swift `Codable` 省略可选字段，而后端曾要求字段存在。
- 后端已将 `distanceMeters` 校验改为可选，缺省按 `null` 保存；lint、typecheck、build、142/142 tests 通过，提交 `ecc63fe` 已推送并部署。线上 HealthKit route 返回 401（需要登录），说明新路由已生效。
- 客户端已增加自定义 Codable 编码：无距离的 workout 也明确发送 `distanceMeters: null`，避免可选字段被编码为 `undefined`；已重新构建并安装到真机，待再次点击 Import 验证。
- 修复导入后列表读取失败：API 列表响应已将数据库字段 `workoutUUID` 映射为客户端约定的 `id`，避免显示 “The service returned an unexpected response”；提交 `fd771b8` 已推送，等待 staging 自动部署。
