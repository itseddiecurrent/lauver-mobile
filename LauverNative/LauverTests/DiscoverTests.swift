import XCTest
@testable import Lauver

@MainActor
final class DiscoverTests: XCTestCase {
    func testFilterPathEncodesQueryAndOmitsPaceWithoutSport() throws {
        let filters = DiscoverFilters(sport: .cycling, radius: 50, paceMin: 20, paceMax: 30)
        let components = try XCTUnwrap(URLComponents(string: filters.path(cursor: "signed+cursor/=")))
        let query = Dictionary(uniqueKeysWithValues: components.queryItems!.map { ($0.name, $0.value!) })
        XCTAssertEqual(query["sport"], "cycling")
        XCTAssertEqual(query["radius"], "50")
        XCTAssertEqual(query["paceMin"], "20.0")
        XCTAssertEqual(query["paceMax"], "30.0")
        XCTAssertEqual(query["cursor"], "signed+cursor/=")
        XCTAssertFalse(DiscoverFilters(paceMin: 5, paceMax: 6).path().contains("paceMin"))
    }

    func testUnlimitedRadiusIsExplicitAndChangingRadiusStartsANewTraversal() async throws {
        let filters = DiscoverFilters(radius: nil)
        let components = try XCTUnwrap(URLComponents(string: filters.path()))
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "radius" })?.value, "unlimited")
        XCTAssertEqual(filters.radiusTitle, "Unlimited distance")
        XCTAssertEqual(DiscoverFilters(radius: 100).radiusTitle, "Within 100 km")
        let service = DiscoverFakeService()
        let model = DiscoverViewModel(service: service)
        await model.load()
        await model.load(refresh: false)
        await model.apply(filters)
        XCTAssertNil(model.filters.radius)
        XCTAssertEqual(model.users.map(\.id), ["first"])
        XCTAssertEqual(model.nextCursor, "page-two")
    }

    func testDurationAndSpeedRangeSummariesUseActualUnits() throws {
        for sport in WorkoutSport.allCases {
            let low = try XCTUnwrap(sport.parsedPace(sport.usesDurationPace ? "5:01" : "20.5"))
            let high = try XCTUnwrap(sport.parsedPace(sport.usesDurationPace ? "6:30" : "30"))
            let filters = DiscoverFilters(sport: sport, paceMin: low, paceMax: high)
            XCTAssertEqual(filters.paceTitle, "\(sport.usesDurationPace ? "5:01–6:30" : "20.5–30") \(sport.paceUnit)")
            XCTAssertEqual(DiscoverFilters(sport: sport, paceMin: low).paceTitle, "From \(sport.formattedPace(low)) \(sport.paceUnit)")
            XCTAssertEqual(DiscoverFilters(sport: sport, paceMax: high).paceTitle, "Up to \(sport.formattedPace(high)) \(sport.paceUnit)")
        }
        XCTAssertNil(DiscoverFilters(paceMin: 5).paceTitle)
        XCTAssertEqual(DiscoverFilters(sport: .cycling, paceMin: 25.123456, paceMax: 25.123457).paceTitle, "25.123456–25.123457 km/h")
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
