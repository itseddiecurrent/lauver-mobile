import XCTest

final class LauverUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesWithStagingConfigurationAndAuthEntry() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-reset-state", "-ui-testing-reset-auth"]
        app.launch()

        XCTAssertTrue(app.staticTexts["lauver-title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["app-environment"].label, "Staging environment")
        XCTAssertTrue(app.buttons["auth-login"].exists)
        XCTAssertTrue(app.buttons["auth-show-register"].exists)
        XCTAssertTrue(app.buttons["auth-apple"].exists)
        XCTAssertTrue(app.staticTexts["api-online"].waitForExistence(timeout: 60))
    }

    func testAuthenticatedShellContainsOnlyFourApprovedTabs() {
        let app = launchAuthenticatedShell()
        let tabBar = app.tabBars.firstMatch
        for tab in ["Discover", "Events", "Messages", "Profile"] {
            XCTAssertTrue(tabBar.buttons[tab].exists)
        }
        XCTAssertFalse(tabBar.buttons["Swipe"].exists)
        XCTAssertFalse(tabBar.buttons["Match"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["screen-discover"].waitForExistence(timeout: 5))
    }

    func testDiscoverListOpensProfileAndAppliesFilters() {
        let app = launchAuthenticatedShell()
        let row = app.buttons["discover-user-ui-test-partner"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Like"].exists)
        row.tap()
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
        app.buttons["discover-sport"].tap()
        app.buttons["Running"].tap()
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
        app.buttons["discover-sport"].tap()
        app.buttons["Cycling"].tap()
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

    func testEventsTabNavigation() {
        assertNavigation(tab: "Events", screen: "screen-events")
    }

    func testMessagesTabNavigation() {
        assertNavigation(tab: "Messages", screen: "screen-messages")
    }

    func testProfileTabNavigation() {
        assertNavigation(tab: "Profile", screen: "screen-profile")
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
        app.buttons["profile-edit"].tap()
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

    func testUnreachableAPIShowsErrorAndRetry() {
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
        app.buttons["auth-show-register"].tap()
        enterCredentials(in: app)
        app.buttons["auth-register"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))

        app.tabBars.firstMatch.buttons["Profile"].tap()
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
        app.buttons["auth-show-register"].tap()
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
        app.buttons["auth-forgot-link"].tap()
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
        XCTAssertTrue(app.staticTexts["api-online"].waitForExistence(timeout: 5))
        return app
    }

    private func enterCredentials(in app: XCUIApplication) {
        let email = app.textFields["auth-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        typeText("runner@example.com", into: email, app: app)
        let password = app.secureTextFields["auth-password"]
        typeText("CorrectHorse9", into: password, app: app)
    }

    private func typeText(_ text: String, into element: XCUIElement, app: XCUIApplication) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 1)
        element.typeText(text)
    }

    private func waitUntilEnabled(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true"),
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }
}
