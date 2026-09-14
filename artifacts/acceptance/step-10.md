# Step 10 — Stream 一对一私聊

日期：2026-09-14。状态：🟡 进行中。

## 当前状态

- Step 07 的 Block / Report 安全基础已完成，可作为 Chat 的发送前策略和举报证据来源。
- 当前仓库尚未接入 Stream server SDK、Stream token provider、canonical direct channel 或 iOS Chat SDK。
- Stream staging application 是本步骤的外部前置条件；API key 可以进入 App 配置，API secret 只能保存在 Render。

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
