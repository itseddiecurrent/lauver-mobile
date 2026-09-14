import XCTest
@testable import Lauver

@MainActor
final class StravaTests: XCTestCase {
    func testAuthorizationURLAndCallbackRequireExpectedHostReadOnlyScopeAndExactState() throws {
        let flow = StravaFakeService.flow
        try flow.validate()
        XCTAssertEqual(try flow.callbackResult(StravaFakeAuthorizer.callback("connected")), "connected")
        for url in ["lauver://oauth/strava?state=wrong&result=connected", "lauver://other/strava?state=\(flow.state)&result=connected",
                    "lauver://oauth/strava?state=\(flow.state)&state=\(flow.state)&result=connected",
                    "lauver://oauth/strava?state=\(flow.state)&result=connected&access_token=private",
                    "https://oauth/strava?state=\(flow.state)&result=connected"] {
            XCTAssertThrowsError(try flow.callbackResult(URL(string: url)!))
        }
        let bad = StravaStart(authorizationURL: URL(string: "https://evil.test/oauth/mobile/authorize?state=\(flow.state)&scope=read,activity:read")!, state: flow.state, expiresIn: 600)
        XCTAssertThrowsError(try bad.validate())
        let broad = StravaStart(authorizationURL: URL(string: "https://www.strava.com/oauth/mobile/authorize?state=\(flow.state)&scope=read,activity:write")!, state: flow.state, expiresIn: 600)
        XCTAssertThrowsError(try broad.validate())
    }
    func testLoadAndConnectUseServerStatusRatherThanCallbackClaim() async {
        let service = StravaFakeService()
        let authorizer = StravaFakeAuthorizer()
        let model = StravaViewModel(service: service, authorizer: authorizer)
        await model.load()
        XCTAssertEqual(model.connection?.status, .disconnected)
        service.status = .connectedFixture
        await model.connect()
        XCTAssertEqual(model.connection?.status, .connected)
        XCTAssertEqual(model.connection?.activities.first?.title, "Morning run")
        XCTAssertEqual(authorizer.calls, 1)
        XCTAssertNil(model.errorMessage)
        service.status = .disconnected
        await model.connect()
        XCTAssertEqual(model.connection?.status, .disconnected)
    }
    func testUserCancellationIsExplainedWithoutAnErrorOrAutomaticReconnect() async {
        let service = StravaFakeService(), authorizer = StravaFakeAuthorizer()
        authorizer.error = StravaConnectionError.cancelled
        let model = StravaViewModel(service: service, authorizer: authorizer)
        await model.load(); await model.connect()
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.connection?.status, .disconnected)
        XCTAssertEqual(model.notice, "Strava connection was cancelled.")
        XCTAssertEqual(authorizer.calls, 1)
    }
    func testRejectedScopesAndInvalidStateAreActionable() async {
        let service = StravaFakeService(), authorizer = StravaFakeAuthorizer()
        authorizer.result = "scope_missing"
        let model = StravaViewModel(service: service, authorizer: authorizer)
        await model.connect()
        XCTAssertEqual(model.connection?.status, .disconnected)
        XCTAssertTrue(model.errorMessage?.contains("activity access") == true)
        authorizer.url = URL(string: "lauver://oauth/strava?state=wrong&result=connected")!
        await model.connect()
        XCTAssertTrue(model.errorMessage?.contains("could not be verified") == true)
    }
    func testPendingDisconnectRemovesCachedDisplayAndRetryShowsAuthoritativeCompletion() async {
        let service = StravaFakeService(); service.status = .connectedFixture
        let model = StravaViewModel(service: service, authorizer: StravaFakeAuthorizer())
        await model.load()
        service.disconnectResult = StravaStatus(status: .revocationPending, athleteName: nil, lastSyncedAt: nil, scopes: [], activities: [])
        await model.disconnect()
        XCTAssertEqual(model.connection?.status, .revocationPending)
        XCTAssertTrue(model.connection?.activities.isEmpty == true)
        service.disconnectResult = .disconnected
        await model.disconnect()
        XCTAssertEqual(model.connection?.status, .disconnected)
    }
    func testRefreshFailureRechecksExpiredAuthorizationAndAllowsLaterRecovery() async {
        let service = StravaFakeService(); service.status = .connectedFixture
        let model = StravaViewModel(service: service, authorizer: StravaFakeAuthorizer())
        await model.load()
        service.status = StravaStatus(status: .reconnectRequired, athleteName: nil, lastSyncedAt: nil, scopes: [], activities: [])
        service.syncError = StravaConnectionError.authorizationFailed
        await model.refresh()
        XCTAssertEqual(model.connection?.status, .reconnectRequired)
        XCTAssertTrue(model.connection?.activities.isEmpty == true)
        XCTAssertNotNil(model.errorMessage)
        service.syncError = nil; service.status = .connectedFixture
        await model.refresh()
        XCTAssertEqual(model.connection?.status, .connected)
        XCTAssertNil(model.errorMessage)
    }
    func testOfflineDisconnectKeepsConnectionAndReportsFailure() async {
        let service = StravaFakeService(); service.status = .connectedFixture
        let model = StravaViewModel(service: service, authorizer: StravaFakeAuthorizer())
        await model.load(); service.disconnectError = APIError.transport(.notConnectedToInternet)
        await model.disconnect()
        XCTAssertEqual(model.connection?.status, .connected)
        XCTAssertNotNil(model.errorMessage)
    }
    func testLostDisconnectResponseNotifiesProfileToRemoveRevokedActivities() async {
        let service = StravaFakeService(); service.status = .connectedFixture
        let model = StravaViewModel(service: service, authorizer: StravaFakeAuthorizer())
        await model.load()
        service.status = .disconnected
        service.disconnectError = APIError.transport(.networkConnectionLost)
        let update = expectation(forNotification: .stravaConnectionChanged, object: nil)
        await model.disconnect()
        await fulfillment(of: [update], timeout: 1)
        XCTAssertEqual(model.connection?.status, .disconnected)
        XCTAssertTrue(model.connection?.activities.isEmpty == true)
        XCTAssertNotNil(model.errorMessage)
    }
    func testActivityDatesAcceptFractionalSecondsAndRejectInvalidDates() {
        XCTAssertNotNil(StravaDate.parse("2026-09-14T01:00:00.000Z"))
        XCTAssertNotNil(StravaDate.parse("2026-09-14T01:00:00Z"))
        XCTAssertNil(StravaDate.parse("not-a-date"))
    }
}

private extension StravaStatus {
    static let connectedFixture = StravaStatus(status: .connected, athleteName: "Test Runner", lastSyncedAt: "2026-09-14T01:00:00.000Z", scopes: ["read", "activity:read"], activities: [
        StravaActivity(id: "123", title: "Morning run", sport: "Run", startedAt: "2026-09-14T01:00:00.000Z", durationSeconds: 3600, distanceMeters: 10000)
    ])
}
private final class StravaFakeService: StravaServicing {
    static let flow = StravaStart(authorizationURL: URL(string: "https://www.strava.com/oauth/mobile/authorize?state=\(String(repeating: "a", count: 43))&scope=read,activity:read")!, state: String(repeating: "a", count: 43), expiresIn: 600)
    var status: StravaStatus = .disconnected
    var disconnectResult: StravaStatus = .disconnected
    var syncError: Error?
    var disconnectError: Error?
    func stravaStatus() async throws -> StravaStatus { status }
    func startStrava() async throws -> StravaStart { Self.flow }
    func syncStrava() async throws -> StravaStatus { if let syncError { throw syncError }; return status }
    func disconnectStrava() async throws -> StravaStatus { if let disconnectError { throw disconnectError }; status = disconnectResult; return status }
}
@MainActor
private final class StravaFakeAuthorizer: StravaAuthorizing {
    var result = "connected"
    var error: Error?
    var url: URL?
    var calls = 0
    static func callback(_ result: String) -> URL { URL(string: "lauver://oauth/strava?state=\(String(repeating: "a", count: 43))&result=\(result)")! }
    func authorize(_ flow: StravaStart) async throws -> URL { calls += 1; if let error { throw error }; return url ?? Self.callback(result) }
}
