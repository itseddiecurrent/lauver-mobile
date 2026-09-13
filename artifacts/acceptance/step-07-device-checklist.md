# Step 07 手机实际 API 验收

日期：2026-09-13。状态：✅ 真机验收通过。普通举报、取消/确认拉黑、双向隐藏、解除、Report and Block、断网恢复及过期后刷新均通过；独立手机 run 的 3 个账号、3 条举报、6 条安全审计及关联数据已清理，残留为 0。

设备：iPhone 14 Plus / iOS 18.7.8；App：`ai.lauver.app.staging`。
后端源码：`20fd09f42d98be579eb945817ca9060bba1fb527`。
手机 fixture run：`89ec2b75662ce2b3c4bbcddba5c8ea74`，独立于已清理的自动验收 run。

本次使用独立测试账号 A/B/C、Running、10/25 km 或 Unlimited 半径与空 pace 筛选，仅在测试账号之间操作，没有上传照片或连接外部服务。验收结束后账号与私人登录资料均已删除，以下为实际验收记录。

| 操作 | 预期结果 | 实际结果 |
|---|---|---|
| A 打开 B，普通 Report User，提交原因与说明 | 出现 reference ID；Done 后 B 仍可查看，没有自动拉黑 | 通过：用户确认举报后 B 仍可查看；成功页 reference `e17a2317-f339-4c28-a7e5-c4854073a7c9`；后端确认 A → B、open、report audit、双方无 block |
| A 对 B 点击 Block User，然后 Cancel | Profile 与 Discover 保留 B；没有新 block | 通过：用户确认选择 Cancel 后仍可查看 B，Discover 中仍有 B |
| A 确认拉黑 B | B 的 Profile 关闭，Discover 隐藏 B；Blocked Users 显示 B | 通过：修复版重新登录 A 后，用户确认 B 资料页关闭、Discover 隐藏 B、Blocked Users 显示 B；云端只读核对 A → B block 存在，新手机 session 未撤销 |
| 切换登录 B，查看 Discover | B 也无法找到 A；直接 Profile API 隔离由后端核对补充 | 实际 API 4/4 补充核对通过：B 登录身份一致、读 A Profile 为 404、Discover 排除 A、B 无自己方向的 block；通过：用户已登录 B 并确认 Discover 找不到 Step 07 Tester A |
| 切回 A，Settings > Blocked Users 确认解除 B | 列表移除 B，Discover 恢复 B | 通过：用户确认解除 B 后拉黑列表移除 B，Discover 重新出现 B |
| A 对 C 执行 Report and Block | 出现 reference ID，结果保持至 Done；随后 Profile 关闭、Discover 隐藏 C、Blocked Users 显示 C | 通过：用户确认成功；reference `23507a9c-9315-437c-8b00-21329059dd5c`；后端核对 A → C、open、目标快照、report_and_block audit/request ID 一致且 block 存在 |
| 断网后尝试解除 C | 出现可理解的错误，C 保留在列表，不误报成功 | 通过：断网解除出现网络错误 -1200，云端确认 A → C block 保留；用户随后确认上述失败保留及联网恢复检查成功 |
| 恢复网络后重试解除 C | 成功解除，Discover 恢复 C | 通过：用户确认恢复网络后重试成功，列表移除 C、Discover 恢复 C |
| A 保持登录至 access token 过期后刷新 Discover | 无会话过期错误，无旧列表残留；云端 session 完成 rotation 且未 revoked/compromised | 通过：用户反馈 loading 后明确确认页面已恢复；云端 A 手机 session 在 22:20:12（UTC+8）成功 rotation 且未撤销，readyz 200、独立 fixture B Discover API 200 / 830ms；未出现旧 refresh token 重复使用撤销 |
| 后端只读核对手机产生的举报 | reference 对应 open report、目标快照及 audit；普通举报和 Report and Block 均有独立证据 | 普通举报已核对：harassment、user/profile、B 的姓名/bio/sports 快照、request ID 与 report audit 一致；Report and Block `23507a9c-9315-437c-8b00-21329059dd5c` 也已核对：C 的目标快照、open、report_and_block audit 与 request ID 一致、block 存在 |
| 测试完成后精确清理独立 run | 3 个账号及 reports、audit、依赖数据删除，私人凭据与 IDs 文件移除 | 通过：删除 3 个账号、3 条举报、6 条审计及关联数据；独立 SQL 残留全为 0，旧 access/refresh 均返回 401；私人登录文件、IDs、journal 均删除 |

手机操作结果、后端核对与精确清理均已完成；清理证据 [device cleanup](step-07-device-cleanup-20260913.log)。全部页面视觉签收仍按 Step 14A 执行。

## 真机发现：运行中会话失效

- 用户明确补充：错误发生在返回 Discover／下拉刷新时，并非确认 Block User 时。用户截图：[session expired 与旧 Discover 列表](ui/step-07/step07-session-expired-device.jpg)，request ID `6da83306-c7c3-499f-866b-14b907707ca0`。
- 只读数据库核对：A 手机 session 在 `2026-09-13T13:37:33.899Z` 刷新，`13:37:35.945Z` 被置为 revoked/compromised，符合旧 refresh token 被重复使用后的后端保护；没有成功创建 block。
- 代码发现 Discover、Profile、Safety 使用独立 ProfileService，各自收到 401 后直接用先前读取的 refresh token 刷新，缺少共享并发控制。修复共享服务与合并刷新，处理迟到 401，并防止退出/切换账号后的刷新覆写凭据。刷新被服务端拒绝时清除会话、回到登录页；Discover 401 清除旧列表，断网刷新失败保留凭据。
- 修复后 XCTest **88/88** 通过，真机 **BUILD SUCCEEDED** 并已安装新版；相关 Simulator UI **4/4** 通过并已在真机正常启动，用户重新登录后确认拉黑三项真机复测通过；随后过期后的 session rotation 成功，用户确认 Discover 已恢复。证据 [session 修复日志](step-07-session-fix-20260913.log)。已有普通举报与取消拉黑结果保留。

- 最终解除时只读核对：fixture blocks=0，A 手机 session 当时尚未 refresh；随后在 22:20:12 成功 rotation。核对时间字段显式按 UTC 解析，避免 pg 驱动将无时区时间戳按本机时区解码产生 8 小时偏移。

## 过期后 Discover loading 排查

- A 手机 session 创建 `2026-09-13T13:52:07.525Z`，`14:20:12.417Z` 已成功 rotation，未 revoked/compromised；没有重复刷新撤销的证据。
- 排查时 readyz HTTP 200 / 2.25s；独立 B fixture 的 Discover API HTTP 200 / 830ms，2 个结果，包含 A。该独立 API 请求不代替手机 A 页面结果。
- 用户随后明确确认 Discover 已恢复，过期后刷新验收通过。loading 的持续时间与后台/锁屏情况未提供，不认定其具体原因；没有重复 token 撤销的证据。
