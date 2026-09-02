import XCTest

final class LauverUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesWithStagingConfigurationAndAuthEntry() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-reset-state"]
        app.launch()

        XCTAssertTrue(app.staticTexts["lauver-title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["app-environment"].label, "Staging environment")
        XCTAssertTrue(app.buttons["auth-continue"].exists)
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

    func testEventsTabNavigation() {
        assertNavigation(tab: "Events", screen: "screen-events")
    }

    func testMessagesTabNavigation() {
        assertNavigation(tab: "Messages", screen: "screen-messages")
    }

    func testProfileTabNavigation() {
        assertNavigation(tab: "Profile", screen: "screen-profile")
    }

    func testUnreachableAPIShowsErrorAndRetry() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing-offline", "-ui-testing-reset-state"]
        app.launch()

        let errorState = app.descendants(matching: .any)["state-error"]
        XCTAssertTrue(errorState.waitForExistence(timeout: 8))

        let retryButton = app.buttons["state-retry"]
        XCTAssertTrue(retryButton.exists)
        retryButton.tap()
        XCTAssertTrue(errorState.waitForExistence(timeout: 8))
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
}
