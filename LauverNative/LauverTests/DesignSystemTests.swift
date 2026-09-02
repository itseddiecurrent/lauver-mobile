import XCTest
@testable import Lauver

final class DesignSystemTests: XCTestCase {
    func testFourStateComponentsHaveStableDistinctIdentifiers() {
        let identifiers = [
            StateComponentIdentifiers.loading,
            StateComponentIdentifiers.empty,
            StateComponentIdentifiers.error,
            StateComponentIdentifiers.retry
        ]

        XCTAssertEqual(Set(identifiers).count, 4)
        XCTAssertEqual(identifiers, ["state-loading", "state-empty", "state-error", "state-retry"])

        _ = LoadingStateView(title: "Loading")
        _ = EmptyStateView(systemImage: "circle", title: "Empty", message: "Nothing here")
        _ = ErrorStateView(message: "Failed", requestID: "request-id")
        _ = RetryButton(action: {})
    }

    func testMVPContainsOnlyApprovedTabs() {
        XCTAssertEqual(AppTab.allCases.map(\.rawValue), ["discover", "events", "messages", "profile"])
        XCTAssertFalse(AppTab.allCases.map(\.rawValue).contains("swipe"))
        XCTAssertFalse(AppTab.allCases.map(\.rawValue).contains("match"))
    }
}
