# Step 10 — Stream 一对一私聊

## 2026-09-15 真机验收

- iPhone 14 Plus（iOS 18.7.8）单独运行 `testLiveStreamChatConnectsOnDevice` 通过；App 启动、登录态恢复、Messages 页面和无 `state-error` 均通过，结果约 17 秒。日志：`/tmp/lauver-step10-device-retest.log`。
- 两个 staging 用户资料、唯一 direct channel、重复/反向 channel 幂等和第二用户消息已通过真实 API；消息已在 Stream 保存。
- staging 尚未部署包含 chat report 审计事务修复的最新版本；仍需完成第一用户消息举报、数据库 evidence snapshot/audit、第三用户隔离、Block 后已打开会话和断网重试。

日期：2026-09-14。状态：🟡 进行中。

## 当前状态

- Step 07 的 Block / Report 安全基础已完成，可作为 Chat 的发送前策略和举报证据来源。
- Stream server SDK、Stream token provider、canonical direct channel 和 iOS Chat SDK 已接入，详细进展见下文。
- Stream staging application 是本步骤的外部前置条件；API key 可以进入 App 配置，API secret 只能保存在 Render。

## 第一阶段已完成

- 后端已加入 `stream-chat` server SDK 和 `STREAM_ENABLED`、`STREAM_API_KEY`、`STREAM_API_SECRET`、`STREAM_TOKEN_TTL_SECONDS` 配置校验。
- 新增认证后的 `POST /v1/chat/token`，只为当前 Lauver 用户签发短期 Stream token。
- 新增认证后的 `POST /v1/chat/direct`，按双方排序后的 UUID SHA-256 生成唯一 channel ID；创建前检查双方用户状态和双向 Block。
- `npm run lint`、`npm run typecheck` 和 `npm test`（142/142）通过；提交 `453644a` 已推送。
- Render staging 已配置 Stream credentials；线上 `POST /v1/chat/token` 和 `POST /v1/chat/direct` 在未认证请求下均返回 401，确认路由已部署且仍受 Lauver 登录保护。
- Xcode 工程已加入官方 `StreamChatSwiftUI` Swift Package（最低版本 5.10.0），依赖解析和 Staging Simulator build 通过；提交 `1290e2d` 已推送。
- iOS 已接入 `ChatClient`、短期 token 自动续期、Conversations 列表、Direct Chat、文本输入和发送失败重试；Profile 详情增加 Message 入口。
- Chat 页面已增加 Safety 菜单，可直接 Block 或 Report User；长按对方消息可选择 Report Message，提交后显示 reference ID；Block 会调用现有双向会话隔离策略并刷新安全状态。
- 新增 `POST /v1/chat/channels/:channelId/messages/:messageId/report`。服务端验证 canonical channel、当前用户成员资格、消息属于该 channel 且来自对方，再从 Stream 读取消息并将 channel ID、message ID、发送者 ID 和最多 500 字符文本写入 `reports.snapshot`。
- 发送请求通过 Lauver API 服务端校验 channel 成员和双向 Block，使用客户端生成的 UUID 保证重试不会重复发送；后端新增 7 项 Stream 测试，测试总数 149/149。
- 最新 Stream SDK 版本已完成 iPhone 14 Plus 真机构建、安装和启动；本次 Backend typecheck 和 150/150 测试通过，Staging Simulator build 通过。两用户实时收发、第三用户隔离和真机断网场景仍需在手机上操作确认。
- 2026-09-14 iPhone 14 Plus 真机单测复验通过：使用 staging 临时账号真实登录后进入 Messages，`screen-messages` 成功出现且无 `state-error`；新增 Report Message UI 后再次复验退出码为 0；此前失败原因为测试账号 `runner@example.com` 在 staging 返回 `invalid_credentials`，不是 App 崩溃。

## 实施顺序

1. 增加 Stream staging 环境变量和启动配置校验。
2. 后端实现同步 Stream user、短期 token、canonical user pair 和唯一 direct channel，并在 block 状态下拒绝访问。
3. 添加 token/channel authorization integration tests，覆盖第三方用户猜测 channel ID。
4. 接入 iOS Stream Chat SDK，完成 Conversations、Direct Chat、文本发送、未读数和错误重试。
5. 接入 Chat header 的 Block、Report User，并提供服务端校验的 Report Message API，保留最小 evidence snapshot。
6. 在两用户和攻击用户真机流程中完成实时、隔离、幂等和断网恢复验收。

## 待验收

- 两个 staging 用户多次发起聊天只产生一个 channel，并可实时收发文本；当前 staging 新建 direct channel 返回 HTTP 500；已确认线上仍是旧版本，advisory lock 修复尚未通过 CI 自动部署，不能归因为 Stream 配置。
- 第三个用户无法获取对方 Stream token，也无法 watch/query/send 该 channel。
- Block 后已打开会话不能继续发送，Report Message 保留 channel/message ID 和快照。
- 断网发送显示失败状态，恢复后可重试且不重复发送。

## 2026-09-14 双用户完整链路续测

- 复用第一位用户的本地 staging 会话，确认资料完整；新建第二位 staging 用户并完成城市、跑步配速和训练时间资料。
- 双方聊天认证成功。以上 5 项实际 API 检查通过，未输出任何 token、密码或原始认证响应。
- `POST /v1/chat/direct` 仍返回 HTTP 500；因此本次尚未发送消息、提交消息举报或验证数据库快照，不记为完整链路通过。
- GitHub deployment `6438556030` 显示 staging 最新成功部署为 `2366fcb`（2026-09-14 13:54:04 UTC）；advisory lock 修复 `4536b3e` 的 Backend check 为 failure。Render 配置为 `autoDeployTrigger: checksPass`。
- 本地修复 `stream.ts` 两处未使用 catch 参数；Backend typecheck、lint、production build 和 150/150 tests 均通过。需发布修复并等待 staging 部署后重跑。
- 新增 `backend/scripts/verify-step-10-staging.ts`，支持复用两位用户、过期会话刷新、重复/反向 direct channel 唯一性、B 发消息、A 举报，以及数据库快照和审计核对。错误输出仅含阶段与 HTTP 状态。
- 第二位测试用户保留供续测；私有恢复状态保存在仓库外 `/tmp/lauver-step10-chain-state.json`（权限 `0600`），未提交到仓库。恢复命令在 backend 目录执行：

```sh
npx tsx scripts/verify-step-10-staging.ts /tmp/step10-login.json /tmp/lauver-step10-chain-state.json
```

## 2026-09-15 剩余链路复验

- 数据库连接恢复后，第一用户消息举报的 reference、举报双方、channel/message 快照和 `report_message` 审计均核对通过。
- 临时第三用户无法向既有 channel 发送消息，只能获得自己的 canonical channel；第一用户 Block 第二用户后，已打开会话发送返回 403，随后已解除 Block。第三用户 fixture 已清理。
- 剩余一项是手机手动断网发送、恢复后重试且不重复；真机连接测试已通过。
