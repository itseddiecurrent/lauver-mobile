import XCTest
@testable import Lauver

@MainActor
final class DiscoverTests: XCTestCase {
    func testFilterPathEncodesQueryAndOmitsPaceWithoutSport() throws {
        let filters = DiscoverFilters(sport: .cycling, radius: 50, paceBracket: "fast")
        let components = try XCTUnwrap(URLComponents(string: filters.path(cursor: "signed+cursor/=")))
        let query = Dictionary(uniqueKeysWithValues: components.queryItems!.map { ($0.name, $0.value!) })
        XCTAssertEqual(query["sport"], "cycling")
        XCTAssertEqual(query["radius"], "50")
        XCTAssertEqual(query["paceBracket"], "fast")
        XCTAssertEqual(query["cursor"], "signed+cursor/=")
        XCTAssertFalse(DiscoverFilters(paceBracket: "fast").path().contains("paceBracket"))
    }

    func testPaginationRetryPreservesRowsAndCursor() async {
        let service = DiscoverFakeService()
        let model = DiscoverViewModel(service: service)
        await model.load()
        XCTAssertEqual(model.users.map(\.id), ["first"])
        XCTAssertEqual(model.nextCursor, "page-two")
        service.failPage = true
        await model.load(refresh: false)
        XCTAssertEqual(model.users.map(\.id), ["first"])
        XCTAssertEqual(model.nextCursor, "page-two")
        XCTAssertNotNil(model.errorMessage)
        service.failPage = false
        await model.load(refresh: false)
        XCTAssertEqual(model.users.map(\.id), ["first", "second"])
        XCTAssertNil(model.nextCursor)
        XCTAssertNil(model.errorMessage)
        await model.apply(DiscoverFilters(sport: .cycling))
        XCTAssertTrue(model.users.isEmpty)
        XCTAssertTrue(model.hasLoaded)
    }

    func testStalePageCannotOverwriteNewFilters() async {
        let service = DiscoverFakeService()
        let model = DiscoverViewModel(service: service)
        await model.load()
        service.holdPage = true
        let oldPage = Task { await model.load(refresh: false) }
        while service.pendingPage == nil { await Task.yield() }
        await model.apply(DiscoverFilters(sport: .cycling))
        service.pendingPage?.resume(returning: DiscoverPage(users: [Self.user("stale")], nextCursor: nil))
        await oldPage.value
        XCTAssertTrue(model.users.isEmpty)
        XCTAssertEqual(model.filters.sport, .cycling)
        XCTAssertFalse(model.isLoading)
    }

    func testChangedCursorRetriesFromFirstPage() async {
        let service = DiscoverFakeService()
        let model = DiscoverViewModel(service: service)
        await model.load()
        service.invalidCursor = true
        await model.load(refresh: false)
        XCTAssertNil(model.nextCursor)
        XCTAssertNotNil(model.errorMessage)
        service.invalidCursor = false
        await model.load()
        XCTAssertEqual(model.users.map(\.id), ["first"])
        XCTAssertEqual(model.nextCursor, "page-two")
    }

    func testFailedFilterChangeDoesNotShowOldRowsUnderNewFilters() async {
        let service = DiscoverFakeService()
        let model = DiscoverViewModel(service: service)
        await model.load()
        service.failFilter = true
        await model.apply(DiscoverFilters(sport: .cycling))
        XCTAssertTrue(model.users.isEmpty)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertEqual(model.filters.sport, .cycling)
    }

    func testCancellationDoesNotShowConnectionError() async {
        let service = DiscoverFakeService()
        service.cancel = true
        let model = DiscoverViewModel(service: service)
        await model.load()
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isLoading)
    }

    static func user(_ id: String) -> DiscoverUser {
        DiscoverUser(id: id, displayName: id, photoURL: nil,
                     city: ProfileCity(name: "City", regionCode: nil, countryCode: "CN", latitude: nil, longitude: nil),
                     approximateDistanceKm: 0, sports: [], commonSports: [])
    }
}

@MainActor
private final class DiscoverFakeService: DiscoverServicing {
    var invalidCursor = false
    var failFilter = false
    var failPage = false
    var holdPage = false
    var cancel = false
    var pendingPage: CheckedContinuation<DiscoverPage, Never>?

    func discover(filters: DiscoverFilters, cursor: String?) async throws -> DiscoverPage {
        if cancel { throw CancellationError() }
        if filters.sport == .cycling {
            if failFilter { throw APIError.transport(.notConnectedToInternet) }
            return DiscoverPage(users: [], nextCursor: nil)
        }
        if cursor != nil {
            if invalidCursor { throw APIError.validation(code: "invalid_discover_cursor", message: "Refresh", requestID: nil) }
            if failPage { throw APIError.transport(.notConnectedToInternet) }
            if holdPage { return await withCheckedContinuation { pendingPage = $0 } }
            return DiscoverPage(users: [DiscoverTests.user("first"), DiscoverTests.user("second")], nextCursor: nil)
        }
        return DiscoverPage(users: [DiscoverTests.user("first")], nextCursor: "page-two")
    }
}
