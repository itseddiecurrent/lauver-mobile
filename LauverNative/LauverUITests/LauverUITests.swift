import XCTest

final class LauverUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesWithNativeMVPTitle() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["lauver-title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["lauver-subtitle"].exists)
    }
}
