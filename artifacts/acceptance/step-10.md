# Step 10 — Stream 一对一私聊

日期：2026-09-14。状态：🟡 进行中。

## 当前状态

- Step 07 的 Block / Report 安全基础已完成，可作为 Chat 的发送前策略和举报证据来源。
- 当前仓库尚未接入 Stream server SDK、Stream token provider、canonical direct channel 或 iOS Chat SDK。
- Stream staging application 是本步骤的外部前置条件；API key 可以进入 App 配置，API secret 只能保存在 Render。

## 第一阶段已完成

- 后端已加入 `stream-chat` server SDK 和 `STREAM_ENABLED`、`STREAM_API_KEY`、`STREAM_API_SECRET`、`STREAM_TOKEN_TTL_SECONDS` 配置校验。
- 新增认证后的 `POST /v1/chat/token`，只为当前 Lauver 用户签发短期 Stream token。
- 新增认证后的 `POST /v1/chat/direct`，按双方排序后的 UUID SHA-256 生成唯一 channel ID；创建前检查双方用户状态和双向 Block。
- `npm run lint`、`npm run typecheck` 和 `npm test`（142/142）通过；提交 `453644a` 已推送。
- Render staging 已配置 Stream credentials；线上 `POST /v1/chat/token` 和 `POST /v1/chat/direct` 在未认证请求下均返回 401，确认路由已部署且仍受 Lauver 登录保护。

## 实施顺序

1. 增加 Stream staging 环境变量和启动配置校验。
2. 后端实现同步 Stream user、短期 token、canonical user pair 和唯一 direct channel，并在 block 状态下拒绝访问。
3. 添加 token/channel authorization integration tests，覆盖第三方用户猜测 channel ID。
4. 接入 iOS Stream Chat SDK，完成 Conversations、Direct Chat、文本发送、未读数和错误重试。
5. 接入 Chat header 的 Block、Report User、Report Message，并保留最小 evidence snapshot。
6. 在两用户和攻击用户真机流程中完成实时、隔离、幂等和断网恢复验收。

## 待验收

- 两个 staging 用户多次发起聊天只产生一个 channel，并可实时收发文本。
- 第三个用户无法获取对方 Stream token，也无法 watch/query/send 该 channel。
- Block 后已打开会话不能继续发送，Report Message 保留 channel/message ID 和快照。
- 断网发送显示失败状态，恢复后可重试且不重复发送。
