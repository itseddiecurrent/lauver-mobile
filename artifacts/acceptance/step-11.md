# Step 11 — Public Events 与 Apple Maps

## 2026-09-16 真机验收

- iPhone 17 上 Events 页面加载成功，定向 `testEventsTabNavigation` 通过。
- 设备 A 创建的公开活动已在设备 B 的 Upcoming 列表中真实显示，确认 staging 后端事件数据同步正常。
- Apple Maps venue 搜索、Use My Current Location、名称与坐标回填已接入并安装到 iPhone 14 与 iPhone 17。
- 真机地图一致性已确认：活动地点名称、地图位置与保存的 venue 坐标一致。
- 用户已在两台真机确认 Create、Join、Leave 全流程可用；活动创建者与参与者状态显示正确。
- 后续仍需逐项手动验收编辑、取消、地图 pin 和 Report Event/Organizer。

## 2026-09-17 分页与创建可见性修复

### 根因与实测

- Upcoming 按 `startsAt ASC, id ASC` 排序，默认每页 20 条，不按创建时间排序。
- 原客户端只读首页，创建后刷新会将服务端刚返回的活动覆盖掉；首页之外的活动因此不可达。等待不会改变排序。
- staging 专用账号创建 21 条较早开始的活动后，新活动创建请求耗时 399 ms；紧接着另一个账号按 ID GET，411 ms 返回 200，无 sleep、无轮询；该活动在第二页，首页不存在。原始无凭证日志：`/tmp/lauver-step11-staging-initial.log`。这是一次网络往返样本，不是吞吐压测。
- 后端 `create` await PostgreSQL 事务提交后才返回 201；创建路径没有消息队列、Redis 或读副本延迟。

### 修复

- 创建成功后直接使用响应中的活动打开详情，不依赖首页位置；补全 Load more 游标分页及去重。
- 已确认的本地写入不会被更早发起的列表请求覆盖；之后的新服务端读可以更新它，避免永久覆盖其他设备的取消状态。
- Create POST 不再自动重试丢失的响应，避免未实现幂等键时重复创建。
- 编辑成功在 sheet 关闭后显示回执；取消有二次确认，成功后退出详情并移除 Upcoming 行。
- 活动/组织者举报区分 `targetType`，快照与审计在同一事务提交；审计使用数据库允许的 `report` action。创建者不显示举报自己入口，后端返回明确 422。
- 容量编辑与 Join 使用同一活动行锁，禁止容量低于已有参加人数；参数校验失败统一返回 422。

### 已通过证据

- 后端 156 tests；真实 PostgreSQL integration 62 tests，其中 6 项新增 Events 验收覆盖首页外创建、20 个不同用户抢最后一个名额、Join/Leave 幂等、容量编辑竞态、权限、取消与举报事务回滚。
- iOS 105 XCTest 全部通过（`/tmp/lauver-step11-final-unit.xcresult`），包括分页、旧请求覆盖、外部取消、Create 丢失响应不重试。
- 真机 iPhone 17e、真实 staging：`testLiveEventManagementOnDevice` 最终复验在 52.6 秒内通过创建 → 直接详情 → 编辑 → Keep Event → Cancel Event → 成功回执 → 返回列表 → 重启后仍不存在。
- 真机结果：`/tmp/lauver-step11-final-management.xcresult`；截图保存在 `ui/step-11/`，已替换为最终复验截图。
- 同一设备使用另一创建者的活动，`testLiveEventAttendanceOnDevice` 在 20.2 秒内通过 Join → Leave → 再次 Join，且不存在 Edit/Cancel 管理入口。结果：`/tmp/lauver-step11-attendance.xcresult`。
- Production Simulator 配置构建成功：`/tmp/lauver-step11-production.log`。
- 后端提交 `186e40f` 的云端 CI：guardrails、backend、ios 全部成功。

### 收尾状态

Render 已部署 `63793b0`；Report Event 与 Report Organizer 真机验收通过（18.3 秒，`/tmp/lauver-step11-reports-final.xcresult`）。完整 staging API 验收也通过，包括两类 report receipt、self-report 422 与取消后的状态。

当前唯一未完成项是 PostgreSQL 证据查询和临时账号清理：本机经 VPN 出口 `23.165.184.186` 连接 Render 外部数据库仍在 TLS 握手阶段被关闭。待 Render 数据库白名单允许该 `/32` 后执行 `npx tsx scripts/verify-step-11-staging.ts evidence /tmp/lauver-step11-acceptance.json`，随后执行 `cleanup`；在此之前不宣称数据库证据和清理完成。

### 并发与 Redis

当前容量正确性由 PostgreSQL 事务、活动行锁、attendee 复合主键保证，Redis 不解决本次分页问题，也不替代数据库的名额约束。当前 Prisma 池上限为每进程 10 条连接，Render staging 是 free plan；应先测量目标负载下的 p95、错误率、锁等待和数据库连接预算，再决定实例与数据库扩容。

多 API 实例时，当前进程内限流需要改为共享限流，可用 Redis；热门列表读成为瓶颈后再引入带失效策略的 Redis 缓存。用户相关的 `isCreator/isAttendee` 不能在不同用户间复用。创建/Join/Cancel 成功响应和关键详情读应保持数据库权威状态。
