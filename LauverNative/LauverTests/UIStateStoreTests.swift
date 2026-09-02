import Foundation
import XCTest
@testable import Lauver

final class UIStateStoreTests: XCTestCase {
    private let suiteName = "ai.lauver.tests.ui-state"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testPersistsOnlySelectedTabAsNonSensitiveUIState() {
        let store = UIStateStore(defaults: defaults)
        store.selectedTab = .profile

        XCTAssertEqual(UIStateStore(defaults: defaults).selectedTab, .profile)
        XCTAssertEqual(
            defaults.persistentDomain(forName: suiteName) as? [String: String],
            ["ui.selectedTab": "profile"]
        )
        XCTAssertNil(defaults.object(forKey: "accessToken"))
        XCTAssertNil(defaults.object(forKey: "refreshToken"))
    }

    func testUnknownTabFallsBackToDiscoverAndResetRemovesState() {
        defaults.set("legacy-tab", forKey: "ui.selectedTab")
        let store = UIStateStore(defaults: defaults)

        XCTAssertEqual(store.selectedTab, .discover)
        store.reset()
        XCTAssertNil(defaults.object(forKey: "ui.selectedTab"))
    }
}
