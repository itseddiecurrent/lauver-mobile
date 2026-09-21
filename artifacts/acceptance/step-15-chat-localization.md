# Step 15 Chat localization acceptance

日期：2026-09-21  
设备：实体 iPhone 17e（`Edward的iPhone`，UDID `00008150-00010C6E22C0C01C`）  
构建：`Lauver-Staging`

## Implemented

- Stream Chat 的 `Appearance.default.localizationProvider` 现在按 App 语言选择读取原生 `Localizable.strings`。
- English 和简体中文均覆盖 `channelList.empty.*`、`channel.no-content.*` 和 `channel.item.empty-messages`。
- 简体中文空状态为“开始聊天吧 / 给朋友发送第一条消息吧？/ 开始聊天 / 暂无消息”。

## Verification

- iPhoneOS arm64 build succeeded and copied both localized string tables into the app bundle。
- Native XCTest: 109/109 passed on the physical iPhone 17e。
- Full physical-device XCUITest: 28 total, 20 passed, 5 skipped, 3 failed; no crash, SIGABRT, SIGSEGV, watchdog or termination was recorded。
- The three failures are existing live-staging prerequisites/data assertions (`Discover` filter data, authenticated Match summary, and Stream login/session); they do not exercise or invalidate the localization resource build。
- The Chinese localization UI regression already passed 3/3 on this same device, including the Chinese app shell and empty Events state. The Stream empty-channel visual state requires a live account with an empty Stream channel and remains a manual follow-up。

Evidence: `artifacts/acceptance/step-15-chat-localization-iphone17e.log` and `artifacts/acceptance/step-15-iphone17e-unit-after-tls.xcresult`。
