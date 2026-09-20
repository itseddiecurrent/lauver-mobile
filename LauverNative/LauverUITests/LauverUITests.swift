import XCTest

final class LauverUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesWithStagingConfigurationAndAuthEntry() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-reset-state", "-ui-testing-reset-auth"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["lauver-title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["app-environment"].label, "Staging environment")
        XCTAssertTrue(app.buttons["auth-login"].exists)
        XCTAssertTrue(app.buttons["auth-show-register"].exists)
        XCTAssertTrue(app.buttons["auth-apple"].exists)
    }

    func testLiveStreamChatConnectsOnDevice() {
        let app = XCUIApplication()
        app.launch()
        if app.buttons["auth-login"].waitForExistence(timeout: 8) {
            enterCredentials(in: app)
            app.buttons["auth-login"].tap()
        }
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        app.tabBars.firstMatch.buttons["Messages"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["screen-messages"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.descendants(matching: .any)["state-error"].exists)
    }

    // Real Render staging Match/Stream acceptance. This is intentionally opt-in because it
    // writes one message and rotates the real test account session on the connected device.
    func testLiveMatchAndConversationOnDevice() throws {
        let value: (String) -> String? = { key in
            ProcessInfo.processInfo.environment[key]
                ?? Bundle(for: LauverUITests.self).object(forInfoDictionaryKey: key) as? String
        }
        guard value("LAUVER_LIVE_MATCH") == "1",
              let email1 = value("LAUVER_LIVE_EMAIL_1"),
              let password1 = value("LAUVER_LIVE_PASSWORD_1"),
              let email2 = value("LAUVER_LIVE_EMAIL_2"),
              let password2 = value("LAUVER_LIVE_PASSWORD_2") else {
            throw XCTSkip("Requires explicit two-account live Match acceptance opt-in")
        }

        let message = "Step 06B live (\(UUID().uuidString.prefix(8)))"
        let app = XCUIApplication()

        login(email: email1, password: password1, in: app)
        openMatch(in: app)
        XCTAssertTrue(app.staticTexts["Step 06B Tester Two"].waitForExistence(timeout: 15))
        let accountOneMessage = app.buttons["Message Step 06B Tester Two"]
        XCTAssertTrue(accountOneMessage.waitForExistence(timeout: 15))
        scrollToHittable(accountOneMessage, in: app)
        accountOneMessage.tap()
        sendLiveMessage(message, in: app)
        let sent = XCTAttachment(screenshot: app.screenshot())
        sent.name = "step06b-account1-sent"
        sent.lifetime = .keepAlways
        add(sent)
        app.navigationBars.buttons.firstMatch.tap()

        signOut(in: app)
        login(email: email2, password: password2, in: app)
        openMatch(in: app)
        XCTAssertTrue(app.staticTexts["Step 06B Tester One"].waitForExistence(timeout: 15))
        let lastMessage = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "match-last-message-", message)
        ).firstMatch
        XCTAssertTrue(lastMessage.waitForExistence(timeout: 15), "Matches row must show the latest Stream message")
        let unread = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "match-unread-")
        )
        XCTAssertTrue(unread.count > 0, "Account two must see the unread badge before opening chat")
        let accountTwoMessage = app.buttons["Message Step 06B Tester One"]
        XCTAssertTrue(accountTwoMessage.waitForExistence(timeout: 15))
        scrollToHittable(accountTwoMessage, in: app)
        accountTwoMessage.tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-message-input"].waitForExistence(timeout: 15))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertEqual(app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "match-unread-")
        ).count, 0, "Opening the conversation must clear unread state")
        let received = XCTAttachment(screenshot: app.screenshot())
        received.name = "step06b-account2-read"
        received.lifetime = .keepAlways
        add(received)
    }

    // Uses the authenticated staging session left by the live login test above.
    func testLiveMatchSummaryOnAuthenticatedDevice() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        openMatch(in: app)
        XCTAssertTrue(app.staticTexts["Step 06B Tester Two"].waitForExistence(timeout: 15))
        let messageButton = app.buttons["Message Step 06B Tester Two"]
        XCTAssertTrue(messageButton.waitForExistence(timeout: 15))
        messageButton.tap()
        let message = "iPhone 17e Match (\(UUID().uuidString.prefix(8)))"
        sendLiveMessage(message, in: app)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "match-last-message-", message)
        ).firstMatch.waitForExistence(timeout: 15))
    }

    // The second connected account has nine deployed staging photos. The tenth-photo
    // boundary must be enforced by the real editor before another upload starts.
    func testLiveProfilePhotoLimitOnDevice() throws {
        let value: (String) -> String? = { key in
            ProcessInfo.processInfo.environment[key]
                ?? Bundle(for: LauverUITests.self).object(forInfoDictionaryKey: key) as? String
        }
        guard value("LAUVER_LIVE_MATCH") == "1",
              let email = value("LAUVER_LIVE_EMAIL_2"),
              let password = value("LAUVER_LIVE_PASSWORD_2") else {
            throw XCTSkip("Requires explicit live staging acceptance opt-in")
        }

        let app = XCUIApplication()
        login(email: email, password: password, in: app)
        let profileTab = app.tabBars.firstMatch.buttons["Profile"]
        XCTAssertTrue(profileTab.waitForExistence(timeout: 5))
        for _ in 0..<3 {
            profileTab.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if app.descendants(matching: .any)["screen-profile"].waitForExistence(timeout: 3) { break }
        }
        XCTAssertTrue(app.descendants(matching: .any)["screen-profile"].exists)
        let edit = app.buttons["profile-edit"]
        if !edit.waitForExistence(timeout: 15) {
            let labels = app.staticTexts.allElementsBoundByIndex.map(\.label).filter { !$0.isEmpty }
            print("LIVE_PROFILE_SCREEN_LABELS: \(labels)")
            XCTFail("Live profile editor did not load")
            return
        }
        for _ in 0..<8 where !edit.isHittable { app.swipeUp() }
        tapWhenHittable(edit)
        XCTAssertTrue(app.navigationBars["Edit Profile"].waitForExistence(timeout: 10))
        let limit = app.staticTexts["Photo limit reached"]
        XCTAssertTrue(limit.waitForExistence(timeout: 10), "A profile with nine photos must reject a tenth upload")
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "step06b-tenth-photo-rejected"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testStep06BAccessibilityLargeDarkOnDevice() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-ui-testing-authenticated",
            "-ui-testing-health-success",
            "-ui-testing-reset-state",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleInterfaceStyle", "Dark"
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        app.tabBars.firstMatch.buttons["Match"].tap()
        XCTAssertTrue(app.buttons["Start matching"].waitForExistence(timeout: 10))
        app.buttons["Start matching"].tap()
        XCTAssertTrue(app.buttons["Like"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Pass"].exists)
        XCTAssertTrue(app.buttons["View Profile"].exists)
        XCTAssertEqual(app.buttons["Like"].label, "Like")
        XCTAssertEqual(app.buttons["Pass"].label, "Pass")
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "step06b-large-dark-accessibility"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testStep06BAccessibilitySmallLightOnDevice() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-ui-testing-authenticated",
            "-ui-testing-health-success",
            "-ui-testing-reset-state",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXS",
            "-AppleInterfaceStyle", "Light"
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        for tab in ["Discover", "Match", "Events", "Messages", "Profile"] {
            XCTAssertTrue(app.tabBars.firstMatch.buttons[tab].exists)
        }
        app.tabBars.firstMatch.buttons["Match"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["screen-match"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["match-filters"].exists)
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "step06b-small-light-accessibility"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testAuthenticatedShellContainsApprovedTabsAndMatchFlow() {
        let app = launchAuthenticatedShell()
        let tabBar = app.tabBars.firstMatch
        for tab in ["Discover", "Match", "Events", "Messages", "Profile"] {
            XCTAssertTrue(tabBar.buttons[tab].exists)
        }
        XCTAssertFalse(tabBar.buttons["Swipe"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["screen-discover"].waitForExistence(timeout: 5))
        tabBar.buttons["Match"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["screen-match"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Find your workout people"].exists)
        let start = app.buttons["Start matching"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        let like = app.buttons["Like"]
        XCTAssertTrue(like.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Pass"].exists)
        like.tap()
        XCTAssertTrue(app.staticTexts["It’s a Match!"].waitForExistence(timeout: 5))
        app.buttons["Keep browsing"].tap()
        XCTAssertTrue(app.staticTexts["Match Partner"].waitForExistence(timeout: 5))
        let more = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "match-more-")).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        let unmatch = app.buttons["Unmatch"]
        XCTAssertTrue(unmatch.waitForExistence(timeout: 5))
        unmatch.tap()
        XCTAssertFalse(app.staticTexts["Match Partner"].waitForExistence(timeout: 3))
    }

    func testDiscoverListOpensProfileAndAppliesFilters() {
        let app = launchAuthenticatedShell()
        let row = app.buttons["discover-user-ui-test-partner"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Like"].exists)
        tapWhenHittable(row)
        XCTAssertTrue(app.staticTexts["UI Test Runner"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["discover-filters"].tap()
        XCTAssertTrue(app.buttons["discover-apply-filters"].waitForExistence(timeout: 5))
        app.buttons["discover-radius"].tap()
        app.buttons["100 km"].tap()
        app.buttons["discover-apply-filters"].tap()
        assertDiscoverSummary("Within 100 km", in: app)
        app.buttons["discover-filters"].tap()
        app.buttons["discover-radius"].tap()
        app.buttons["Unlimited"].tap()
        app.buttons["discover-apply-filters"].tap()
        assertDiscoverSummary("Unlimited distance", in: app)
        app.buttons["discover-filters"].tap()
        tapWhenHittable(app.buttons["discover-sport"])
        tapWhenHittable(app.buttons["Running"])
        XCTAssertFalse(app.buttons["discover-pace"].exists)
        let from = app.textFields["discover-pace-min"]
        let to = app.textFields["discover-pace-max"]
        from.tap()
        from.typeText("5:60")
        XCTAssertTrue(app.staticTexts["discover-pace-error"].exists)
        XCTAssertFalse(app.buttons["discover-apply-filters"].isEnabled)
        from.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4) + "5:01")
        to.tap()
        to.typeText("5:30")
        app.buttons["discover-apply-filters"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        assertDiscoverSummary("5:01–5:30 min/km", in: app)
        app.buttons["discover-filters"].tap()
        XCTAssertEqual(from.value as? String, "5:01")
        XCTAssertEqual(to.value as? String, "5:30")
        tapWhenHittable(app.buttons["discover-sport"])
        tapWhenHittable(app.buttons["Cycling"])
        let speedHeading = app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS[c] %@", "Self-reported speed (km/h)"
        )).firstMatch
        XCTAssertTrue(speedHeading.waitForExistence(timeout: 5))
        assertEmptyPaceField(from, placeholder: "From")
        assertEmptyPaceField(to, placeholder: "To")
        from.tap()
        from.typeText("20.5")
        to.tap()
        to.typeText("30")
        app.buttons["discover-apply-filters"].tap()
        XCTAssertTrue(app.staticTexts["No workout partners found"].waitForExistence(timeout: 5))
        assertDiscoverSummary("Cycling", in: app)
        assertDiscoverSummary("20.5–30 km/h", in: app)
    }

    func testProfileReportAndBlockCanBeUnblockedFromSettings() {
        let app = launchAuthenticatedShell()
        let row = app.buttons["discover-user-ui-test-partner"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        tapWhenHittable(row)
        let safety = app.buttons["profile-safety-menu"]
        XCTAssertTrue(safety.waitForExistence(timeout: 5))
        safety.tap()
        app.buttons["profile-report"].tap()
        XCTAssertTrue(app.buttons["report-submit"].waitForExistence(timeout: 5))
        let form = XCTAttachment(screenshot: app.screenshot()); form.name = "step07-report-form"; form.lifetime = .keepAlways; add(form)
        app.buttons["report-reason"].tap()
        app.buttons["Spam"].tap()
        app.buttons["report-submit"].tap()
        XCTAssertTrue(app.staticTexts["report-success"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["report-reference"].label.contains("ui-test-report-reference"))
        app.buttons["report-done"].tap()
        XCTAssertTrue(safety.waitForExistence(timeout: 5))
        safety.tap()
        app.buttons["profile-report-block"].tap()
        XCTAssertTrue(app.buttons["report-submit"].waitForExistence(timeout: 5))
        app.buttons["report-submit"].tap()
        XCTAssertTrue(app.staticTexts["report-success"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["This user is also blocked."].exists)
        let receipt = XCTAttachment(screenshot: app.screenshot()); receipt.name = "step07-report-reference"; receipt.lifetime = .keepAlways; add(receipt)
        app.buttons["report-done"].tap()
        XCTAssertTrue(app.staticTexts["No workout partners found"].waitForExistence(timeout: 5))
        selectTab("Profile", in: app)
        let settings = app.buttons["profile-settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5)); settings.tap()
        app.buttons["settings-blocked-users"].tap()
        let unblock = app.buttons["unblock-ui-test-partner"]
        XCTAssertTrue(unblock.waitForExistence(timeout: 5))
        let blocked = XCTAttachment(screenshot: app.screenshot()); blocked.name = "step07-blocked-users"; blocked.lifetime = .keepAlways; add(blocked)
        unblock.tap()
        app.buttons["Unblock"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No blocked users"].waitForExistence(timeout: 5))
        selectTab("Discover", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
    }

    func testProfileBlockRequiresConfirmation() {
        let app = launchAuthenticatedShell()
        let row = app.buttons["discover-user-ui-test-partner"]
        XCTAssertTrue(row.waitForExistence(timeout: 5)); tapWhenHittable(row)
        let safety = app.buttons["profile-safety-menu"]
        XCTAssertTrue(safety.waitForExistence(timeout: 5)); safety.tap()
        app.buttons["profile-block"].tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(safety.exists)
        safety.tap(); app.buttons["profile-block"].tap()
        app.buttons["Block User"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No workout partners found"].waitForExistence(timeout: 5))
        XCTAssertFalse(row.exists)
    }

    private func assertEmptyPaceField(_ field: XCUIElement, placeholder: String,
                                      file: StaticString = #filePath, line: UInt = #line) {
        // iOS 18 exposes an empty field's value as nil; newer versions expose its placeholder.
        let empty = NSPredicate { _, _ in
            guard field.exists else { return false }
            let value = field.value as? String
            return value == nil || value == "" || value == placeholder
        }
        let cleared = XCTNSPredicateExpectation(predicate: empty, object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed, file: file, line: line)
    }

    // Opt-in: real staging writes, never part of the simulator smoke suite.
    func testLiveEventManagementOnDevice() throws {
        guard ProcessInfo.processInfo.environment["LAUVER_LIVE_EVENTS"] == "1" else {
            throw XCTSkip("Requires explicit live staging acceptance opt-in")
        }
        let app = XCUIApplication()
        if let email = ProcessInfo.processInfo.environment["LAUVER_LIVE_EMAIL"],
           let password = ProcessInfo.processInfo.environment["LAUVER_LIVE_PASSWORD"] {
            app.launchArguments = ["-ui-testing-reset-auth"]
            app.launch()
            typeText(email, into: app.textFields["auth-email"], app: app)
            typeText(password, into: app.secureTextFields["auth-password"], app: app)
            app.buttons["auth-login"].tap()
        } else { app.launch() }
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30), "Authenticated shell")
        app.launchArguments = []
        if app.buttons["Not Now"].waitForExistence(timeout: 3) { app.buttons["Not Now"].tap() }
        openLiveEventsTab(in: app)
        XCTAssertTrue(app.buttons["events-create"].waitForExistence(timeout: 15))
        let title = "Cancel QA " + String(UUID().uuidString.prefix(8))
        app.buttons["events-create"].tap()
        let titleField = app.textFields["event-title-field"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        titleField.tap()
        titleField.typeText(title)
        let venue = app.textFields["event-venue-field"]
        venue.tap()
        venue.typeText("Shanghai People's Park")
        app.buttons["event-save-button"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: titleField)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 20), .completed, "Create form must close after successful POST")
        captureEventScreen(app, name: "created")
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 10), "Created event opens directly, regardless of list pagination")
        XCTAssertTrue(app.staticTexts[title].exists)
        scrollToEventControl(app.buttons["event-edit"], in: app)
        app.buttons["event-edit"].tap()
        XCTAssertTrue(app.textFields["event-title-field"].waitForExistence(timeout: 10))
        let editedTitle = title + " Edited"
        typeText(" Edited", into: app.textFields["event-title-field"], app: app)
        XCTAssertEqual(app.textFields["event-title-field"].value as? String, editedTitle)
        app.buttons["event-save-button"].tap()
        XCTAssertTrue(app.alerts.staticTexts["Event updated successfully."].waitForExistence(timeout: 15), "Edit receipt")
        captureEventScreen(app, name: "edit-success")
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.buttons["events-create"].waitForExistence(timeout: 10), "Edit returns to list")
        openLiveEvent(editedTitle, in: app)
        XCTAssertFalse(app.buttons["Report Event"].exists, "Creators cannot report themselves")
        scrollToEventControl(app.buttons["event-cancel"], in: app)
        app.buttons["event-cancel"].tap()
        XCTAssertTrue(app.alerts["Cancel this event?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Keep Event"].tap()
        XCTAssertTrue(app.buttons["event-cancel"].exists, "Dismissing confirmation must preserve the event")
        app.buttons["event-cancel"].tap()
        app.alerts["Cancel this event?"].buttons["Cancel Event"].tap()
        XCTAssertTrue(app.alerts.staticTexts["Event cancelled successfully."].waitForExistence(timeout: 15), "Cancel receipt")
        captureEventScreen(app, name: "cancel-success")
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.buttons["events-create"].waitForExistence(timeout: 10), "Cancel returns to list")
        XCTAssertFalse(app.staticTexts[editedTitle].exists, "Cancelled row removed")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        openLiveEventsTab(in: app)
        XCTAssertTrue(app.buttons["events-create"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts[editedTitle].exists, "Cancelled row stays absent after relaunch")
        captureEventScreen(app, name: "cancelled-list")
        print("EVENT_ACCEPTANCE_TITLE: " + editedTitle)
    }

    func testLiveEventAttendanceOnDevice() throws {
        guard ProcessInfo.processInfo.environment["LAUVER_LIVE_EVENTS"] == "1" else {
            throw XCTSkip("Requires explicit live staging acceptance opt-in")
        }
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        openLiveEventsTab(in: app)
        openLiveEvent("Step 11 Partner Acceptance", in: app)
        XCTAssertFalse(app.buttons["event-edit"].exists)
        XCTAssertFalse(app.buttons["event-cancel"].exists)
        scrollToEventControl(app.buttons["Join Event"], in: app)
        app.buttons["Join Event"].tap()
        XCTAssertTrue(app.buttons["Leave Event"].waitForExistence(timeout: 15))
        captureEventScreen(app, name: "joined")
        app.buttons["Leave Event"].tap()
        XCTAssertTrue(app.buttons["Join Event"].waitForExistence(timeout: 15))
        captureEventScreen(app, name: "left")
        app.buttons["Join Event"].tap()
        XCTAssertTrue(app.buttons["Leave Event"].waitForExistence(timeout: 15))
    }

    func testLiveEventReportsOnDevice() throws {
        guard ProcessInfo.processInfo.environment["LAUVER_LIVE_EVENTS"] == "1" else {
            throw XCTSkip("Requires explicit live staging acceptance opt-in")
        }
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        openLiveEventsTab(in: app)
        openLiveEvent("Step 11 Partner Acceptance", in: app)
        for label in ["Report Event", "Report Organizer"] {
            scrollToEventControl(app.buttons[label], in: app)
            app.buttons[label].tap()
            XCTAssertTrue(app.alerts.staticTexts["Report submitted successfully."].waitForExistence(timeout: 15))
            captureEventScreen(app, name: label)
            app.alerts.buttons["OK"].tap()
        }
    }

    private func openLiveEventsTab(in app: XCUIApplication) {
        let tab = app.tabBars.firstMatch.buttons["Events"]
        for _ in 0..<3 {
            tab.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if app.buttons["events-create"].waitForExistence(timeout: 3) { return }
        }
        XCTAssertTrue(app.buttons["events-create"].exists)
    }

    private func captureEventScreen(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func openLiveEvent(_ title: String, in app: XCUIApplication) {
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "event-row-", title)).firstMatch
        for _ in 0..<35 {
            if row.exists && row.isHittable { row.tap(); break }
            let more = app.buttons["events-load-more"]
            if more.exists && more.isHittable { more.tap() }
            app.swipeUp()
        }
        captureEventScreen(app, name: "event-detail")
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 10), "Open exact unique event")
    }

    private func scrollToEventControl(_ control: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 {
            if control.exists && control.isHittable { return }
            app.swipeUp()
        }
        captureEventScreen(app, name: "missing-control")
        XCTAssertTrue(control.exists && control.isHittable, "Detail control must be reachable by scrolling")
    }

    func testEventsTabNavigation() {
        assertNavigation(tab: "Events", screen: "screen-events")
    }




    func testMessagesTabNavigation() {
        assertNavigation(tab: "Messages", screen: "screen-messages")
    }

    func testProfileTabNavigation() {
        assertNavigation(tab: "Profile", screen: "screen-profile")
    }

    // Step 14A privacy-safe visual baseline. Run this test once per simulator
    // appearance; the result bundle contains attachments named by surface.
    func testStep14AVisualBaseline() {
        let signedOut = launchAuthFlow(resetAuth: true)
        attachScreenshot(signedOut, name: "auth-login")
        tapWhenHittable(signedOut.buttons["auth-show-register"])
        XCTAssertTrue(signedOut.buttons["auth-register"].waitForExistence(timeout: 5))
        attachScreenshot(signedOut, name: "auth-register")

        let app = launchAuthenticatedShell()
        attachScreenshot(app, name: "discover")
        tapWhenHittable(app.buttons["discover-filters"])
        XCTAssertTrue(app.buttons["discover-apply-filters"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "discover-filters")
        app.buttons["Cancel"].tap()

        selectTab("Events", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["screen-events"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "events")

        selectTab("Messages", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["screen-messages"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "messages")

        selectTab("Profile", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["screen-profile"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "profile")
        tapWhenHittable(app.buttons["profile-settings"])
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "settings")
        tapWhenHittable(app.buttons["settings-connected-apps"])
        XCTAssertTrue(app.navigationBars["Connected Apps"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "connected-apps")
        app.navigationBars.buttons.firstMatch.tap()
        tapWhenHittable(app.buttons["settings-blocked-users"])
        XCTAssertTrue(app.navigationBars["Blocked Users"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "blocked-users")
    }

    func testProfileCanOpenEditorAndShowsPersistedWorkoutFields() {
        let app = launchAuthenticatedShell()
        let tabButton = app.tabBars.firstMatch.buttons["Profile"]
        tabButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if !app.buttons["profile-edit"].waitForExistence(timeout: 2) {
            tabButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }

        XCTAssertTrue(app.staticTexts["UI Test Runner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Shanghai, CN"].exists)
        XCTAssertTrue(app.staticTexts["Running"].exists)
        XCTAssertTrue(app.staticTexts["5:30 min/km"].exists)
        // The floating tab bar can cover the centre of this bottom button.
        // Scroll it above the bar before tapping its visible frame.
        app.scrollViews.firstMatch.swipeUp()
        tapWhenHittable(app.buttons["profile-edit"])
        XCTAssertTrue(app.textFields["profile-name-field"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["profile-name-field"].value as? String, "UI Test Runner")
        XCTAssertEqual(app.textFields["profile-pace-running"].value as? String, "5:30")
        XCTAssertTrue(app.buttons["profile-city-picker"].exists)
        XCTAssertTrue(app.buttons["profile-save"].exists)
        app.buttons["profile-save"].tap()
        XCTAssertTrue(app.buttons["profile-edit"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["5:30 min/km"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["state-error"].exists)
    }

    func testPublicProfileShowsTheCityWithoutCoordinates() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-public-profile"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Public Runner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Shanghai, CN"].exists)
        XCTAssertTrue(app.staticTexts["Running"].exists)
        let labels = app.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        XCTAssertFalse(labels.contains("31.2304"))
        XCTAssertFalse(labels.contains("121.4737"))
    }

    func testUnreachableServiceShowsErrorAndRetry() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-offline", "-ui-testing-reset-state", "-ui-testing-reset-auth"]
        app.launch()

        let errorState = app.descendants(matching: .any)["state-error"]
        XCTAssertTrue(errorState.waitForExistence(timeout: 8))

        let retryButton = app.buttons["state-retry"]
        XCTAssertTrue(retryButton.exists)
        retryButton.tap()
        XCTAssertTrue(errorState.waitForExistence(timeout: 8))
    }

    func testRegisterSignOutAndLoginFlow() {
        let app = launchAuthFlow(resetAuth: true)
        tapWhenHittable(app.buttons["auth-show-register"])
        XCTAssertTrue(app.buttons["auth-register"].waitForExistence(timeout: 5))
        enterCredentials(in: app)
        app.buttons["auth-register"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))

        selectTab("Profile", in: app)
        let signOut = app.buttons["auth-sign-out"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 5))
        signOut.tap()

        XCTAssertTrue(app.buttons["auth-login"].waitForExistence(timeout: 5))
        enterCredentials(in: app)
        app.buttons["auth-login"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
    }

    func testDeletedKeychainSessionReturnsToLogin() {
        let app = launchAuthFlow(resetAuth: true)
        tapWhenHittable(app.buttons["auth-show-register"])
        XCTAssertTrue(app.buttons["auth-register"].waitForExistence(timeout: 5))
        enterCredentials(in: app)
        app.buttons["auth-register"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
        app.terminate()

        app.launchArguments = authFlowArguments + ["-ui-testing-reset-auth"]
        app.launch()
        XCTAssertTrue(app.buttons["auth-login"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }

    func testForgotPasswordToResetResultFlow() {
        let app = launchAuthFlow(resetAuth: true)
        tapWhenHittable(app.buttons["auth-forgot-link"])
        XCTAssertTrue(app.buttons["auth-forgot-submit"].waitForExistence(timeout: 5))
        let emailField = app.textFields["auth-email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        typeText("runner@example.com", into: emailField, app: app)
        app.buttons["auth-forgot-submit"].tap()

        let resetToken = app.textFields["auth-reset-token"]
        XCTAssertTrue(resetToken.waitForExistence(timeout: 5))
        waitUntilEnabled(app.buttons["auth-reset-submit"])
        typeText("ui-test-reset-token", into: resetToken, app: app)
        let newPassword = app.secureTextFields["auth-reset-password"]
        typeText("ReplacementHorse8", into: newPassword, app: app)
        app.buttons["auth-reset-submit"].tap()
        XCTAssertTrue(app.buttons["auth-reset-complete"].waitForExistence(timeout: 5))
    }

    func testConnectedAppsShowsStravaSummariesAndConfirmsDisconnect() {
        let app = launchAuthenticatedShell()
        selectTab("Profile", in: app)
        tapWhenHittable(app.buttons["profile-settings"])
        tapWhenHittable(app.buttons["settings-connected-apps"])
        tapWhenHittable(app.buttons["connected-apps-strava"])
        XCTAssertTrue(app.staticTexts["strava-connected"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Morning run"].waitForExistence(timeout: 5))
        tapWhenHittable(app.buttons["strava-refresh"])
        XCTAssertTrue(app.staticTexts["Morning run"].waitForExistence(timeout: 5))
        let disconnect = app.buttons["strava-disconnect"]
        app.swipeUp()
        tapWhenHittable(disconnect)
        XCTAssertTrue(app.alerts["Disconnect Strava?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["strava-connected"].exists)
        tapWhenHittable(disconnect)
        app.alerts.buttons["Disconnect"].tap()
        XCTAssertTrue(app.staticTexts["strava-disconnected"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["strava-connect"].exists)
        XCTAssertFalse(app.staticTexts["Morning run"].exists)
    }

    func testSettingsDeleteAccountRequiresConfirmationAndReturnsToLogin() {
        let app = launchAuthenticatedShell()
        selectTab("Profile", in: app)
        tapWhenHittable(app.buttons["profile-settings"])
        let deleteAccount = app.buttons["settings-delete-account"]
        for _ in 0..<4 where !deleteAccount.exists {
            app.swipeUp()
        }
        XCTAssertTrue(deleteAccount.waitForExistence(timeout: 5))

        tapWhenHittable(deleteAccount)
        XCTAssertTrue(app.alerts["Delete your account?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Cancel"].tap()
        XCTAssertTrue(deleteAccount.exists)

        tapWhenHittable(deleteAccount)
        app.alerts.buttons["Delete Account"].tap()
        let password = app.secureTextFields["settings-delete-account-password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.tap()
        password.typeText("test-password")
        tapWhenHittable(app.buttons["settings-delete-account-submit"])
        XCTAssertTrue(app.buttons["auth-login"].waitForExistence(timeout: 5))
    }

    private func assertNavigation(tab: String, screen: String) {
        let app = launchAuthenticatedShell()
        let tabButton = app.tabBars.firstMatch.buttons[tab]
        XCTAssertTrue(tabButton.exists)
        tabButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let screenElement = app.descendants(matching: .any)[screen]
        if !screenElement.waitForExistence(timeout: 2) {
            tabButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(screenElement.waitForExistence(timeout: 5))
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "step14a-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func login(email: String, password: String, in app: XCUIApplication) {
        app.launchArguments = ["-ui-testing-reset-auth"]
        app.launch()
        if app.buttons["auth-login"].waitForExistence(timeout: 8) {
            typeText(email, into: app.textFields["auth-email"], app: app)
            typeText(password, into: app.secureTextFields["auth-password"], app: app)
            app.buttons["auth-login"].tap()
        }
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
        app.launchArguments = []
    }

    private func openMatch(in app: XCUIApplication) {
        let button = app.tabBars.firstMatch.buttons["Match"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        let selected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isSelected == true"),
            object: button
        )
        _ = XCTWaiter.wait(for: [selected], timeout: 5)
        if !app.descendants(matching: .any)["screen-match"].exists {
            button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(app.descendants(matching: .any)["screen-match"].waitForExistence(timeout: 15))
    }

    private func scrollToHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let scrollView = app.scrollViews["screen-match"]
        for _ in 0..<8 {
            if element.isHittable { return }
            if scrollView.exists { scrollView.swipeUp() } else { app.swipeUp() }
        }
        XCTAssertTrue(element.isHittable, "Match control must be reachable by scrolling")
    }

    private func sendLiveMessage(_ message: String, in app: XCUIApplication) {
        let input = app.textFields["chat-message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        input.tap()
        input.typeText(message)
        app.buttons["chat-message-send"].tap()
        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 15))
    }

    private func signOut(in app: XCUIApplication) {
        app.tabBars.firstMatch.buttons["Profile"].tap()
        let signOut = app.buttons["auth-sign-out"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 10))
        signOut.tap()
        XCTAssertTrue(app.buttons["auth-login"].waitForExistence(timeout: 15))
        app.terminate()
    }

    private func assertDiscoverSummary(_ text: String, in app: XCUIApplication) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", text),
            object: app.staticTexts["discover-filter-summary"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }

    private func launchAuthenticatedShell() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-ui-testing-authenticated",
            "-ui-testing-health-success",
            "-ui-testing-reset-state"
        ]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
        return app
    }

    private var authFlowArguments: [String] {
        [
            "-ui-testing-auth-flow",
            "-ui-testing-health-success",
            "-ui-testing-reset-state"
        ]
    }

    private func launchAuthFlow(resetAuth: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = authFlowArguments + (resetAuth ? ["-ui-testing-reset-auth"] : [])
        app.launch()
        XCTAssertTrue(app.buttons["auth-login"].waitForExistence(timeout: 5))
        return app
    }

    private func enterCredentials(in app: XCUIApplication) {
        let email = app.textFields["auth-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 20))
        typeText("runner@example.com", into: email, app: app)
        let password = app.secureTextFields["auth-password"]
        typeText("CorrectHorse9", into: password, app: app)
    }

    private func typeText(_ text: String, into element: XCUIElement, app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        // tap() scrolls an existing field into view. Requiring it to be hittable
        // first prevents that scroll when the keyboard has moved it offscreen.
        element.tap()
        let focusedField = app.descendants(matching: element.elementType)
            .matching(identifier: element.identifier)
            .matching(NSPredicate(format: "hasKeyboardFocus == true"))
            .firstMatch
        if !focusedField.waitForExistence(timeout: 3) {
            // Re-query its position after scrolling or keyboard layout changes.
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
            XCTAssertTrue(focusedField.waitForExistence(timeout: 10))
        }
        element.typeText(text)
    }

    private func waitUntilEnabled(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true"),
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }

    private func tapWhenHittable(_ element: XCUIElement) {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        // SwiftUI controls can report an invalid accessibility activation point
        // even when their visible frame is hittable. Tap the actual frame centre.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func selectTab(_ title: String, in app: XCUIApplication) {
        let button = app.tabBars.firstMatch.buttons[title]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertFalse(button.frame.isEmpty)
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }
}
