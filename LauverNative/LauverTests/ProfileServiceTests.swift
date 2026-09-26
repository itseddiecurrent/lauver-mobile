import Foundation
import UIKit
import XCTest
@testable import Lauver

final class ProfileServiceTests: XCTestCase {
    private var session: URLSession!
    private var tokenStore: ProfileTestSessionStore!
    private var authService: ProfileTestAuthService!
    private var service: ProfileService!

    override func setUp() {
        super.setUp()
        ProfileURLProtocolStub.requestHandler = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProfileURLProtocolStub.self]
        session = URLSession(configuration: configuration)
        tokenStore = ProfileTestSessionStore(tokens: SessionTokens(
            accessToken: "profile-access-token",
            refreshToken: "profile-refresh-token"
        ))
        authService = ProfileTestAuthService()
        service = ProfileService(
            client: APIClient(
                baseURL: URL(string: "https://api.example.test")!,
                session: session,
                retryPolicy: RetryPolicy(maxAttempts: 1)
            ),
            authService: authService,
            sessionStore: tokenStore
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        ProfileURLProtocolStub.requestHandler = nil
        service = nil
        authService = nil
        tokenStore = nil
        session = nil
        super.tearDown()
    }

    func testStravaRequestsUseSharedAuthenticationAndOnlyReturnSummaries() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            XCTAssertNil(request.url?.query)
            if request.url?.path == "/v1/integrations/strava/start" {
                XCTAssertEqual(request.httpMethod, "POST")
                return Self.response(request, status: 200, body: """
                {"authorizationURL":"https://www.strava.com/oauth/mobile/authorize?state=\(String(repeating: "a", count: 43))&scope=read,activity:read","state":"\(String(repeating: "a", count: 43))","expiresIn":600}
                """)
            }
            return Self.response(request, status: 200, body: """
            {"status":"connected","athleteName":"Test Runner","lastSyncedAt":"2026-09-14T01:00:00.000Z","scopes":["read","activity:read"],
            "activities":[{"id":"123","title":"Morning run","sport":"Run","startedAt":"2026-09-14T01:00:00.000Z","durationSeconds":3600,"distanceMeters":10000}]}
            """)
        }
        let status = try await service.stravaStatus()
        XCTAssertEqual(status.athleteName, "Test Runner")
        let flow = try await service.startStrava()
        try flow.validate()
        let refreshed = try await service.syncStrava()
        XCTAssertEqual(refreshed.activities.first?.id, "123")
        let disconnected = try await service.disconnectStrava()
        XCTAssertEqual(disconnected.status, .connected)
    }

    @MainActor
    func testStravaStatus401DoesNotExpireTheLauverSession() async throws {
        let expired = expectation(forNotification: .authenticationSessionExpired, object: nil)
        expired.isInverted = true
        var requests = 0
        ProfileURLProtocolStub.requestHandler = { request in
            requests += 1
            if requests == 1 {
                return Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access-token")
            return Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Still expired"}"#)
        }
        authService.refreshHandler = { _ in ProfileTestAuthService.rotatedSession }

        do {
            _ = try await service.stravaStatus()
            XCTFail("Expected the optional Strava status request to fail")
        } catch let error as APIError {
            guard case .unauthorized = error else { return XCTFail("Expected unauthorized") }
        }
        await fulfillment(of: [expired], timeout: 0.2)
        XCTAssertEqual(authService.refreshCalls, 1)
        XCTAssertEqual(tokenStore.tokens?.accessToken, "rotated-access-token")
    }

    @MainActor
    func testConcurrentPrimaryRequestExpiresSessionWhenOptionalStatusRefreshIsRejected() async throws {
        let expiredAccessRequests = expectation(description: "Both requests receive 401 with the old access token")
        expiredAccessRequests.expectedFulfillmentCount = 2
        let refreshStarted = expectation(description: "Optional status request starts the shared refresh")
        let sessionExpired = expectation(forNotification: .authenticationSessionExpired, object: nil)
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            expiredAccessRequests.fulfill()
            return Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
        }
        authService.refreshHandler = { _ in
            refreshStarted.fulfill()
            await self.fulfillment(of: [expiredAccessRequests], timeout: 5)
            throw APIError.unauthorized(code: "invalid_session", message: "Refresh revoked", requestID: nil)
        }

        async let optionalStatus: StravaStatus = service.stravaStatus()
        // Let the optional request own the shared refresh task, then race a
        // normal application request against the same rejected refresh.
        await fulfillment(of: [refreshStarted], timeout: 5)
        async let primaryProfile: WorkoutProfile = service.getOwnProfile()
        _ = try? await optionalStatus
        _ = try? await primaryProfile

        await fulfillment(of: [sessionExpired], timeout: 5)
        XCTAssertEqual(authService.refreshCalls, 1)
        XCTAssertNil(tokenStore.tokens)
    }

    func testDeleteAccountUsesBearerTokenAndDecodesDeletionJob() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/account")
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try XCTUnwrap(Self.bodyData(request))
            XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? [String: String], ["confirmation": "DELETE", "currentPassword": "test-password"])
            return Self.response(request, status: 202, body: "{\"status\":\"pending\",\"jobId\":\"job-id\"}")
        }

        try await service.deleteAccount(currentPassword: "test-password")
    }

    func testMatchVisibilityReadsAndPersistsWithExistingPreferences() async throws {
        var requestCount = 0
        ProfileURLProtocolStub.requestHandler = { request in
            requestCount += 1
            if requestCount <= 2 {
                XCTAssertEqual(request.url?.path, "/v1/match/preferences")
                XCTAssertEqual(request.httpMethod, "GET")
                return Self.response(request, status: 200, body: """
                {"preferences":{"visibleInMatch":false,"gender":null,"preferredGender":"all","maxDistanceKm":25,"sports":["running"]}}
                """)
            }
            XCTAssertEqual(request.url?.path, "/v1/match/preferences")
            XCTAssertEqual(request.httpMethod, "PATCH")
            let body = try XCTUnwrap(Self.bodyData(request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["visibleInMatch"] as? Bool, true)
            XCTAssertEqual(json["preferredGender"] as? String, "all")
            XCTAssertEqual(json["maxDistanceKm"] as? Int, 25)
            XCTAssertEqual(json["sports"] as? [String], ["running"])
            return Self.response(request, status: 200, body: """
            {"preferences":{"visibleInMatch":true,"gender":null,"preferredGender":"all","maxDistanceKm":25,"sports":["running"]}}
            """)
        }

        let initialPreferences = try await service.getMatchPreferences()
        XCTAssertFalse(initialPreferences.visibleInMatch)
        let updatedPreferences = try await service.updateMatchVisibility(true)
        XCTAssertTrue(updatedPreferences.visibleInMatch)
        XCTAssertEqual(requestCount, 3)
    }

    func testStravaStartDoesNotAutomaticallyReplayLostResponse() async {
        var attempts = 0
        ProfileURLProtocolStub.requestHandler = { _ in attempts += 1; throw URLError(.networkConnectionLost) }
        do { _ = try await service.startStrava(); XCTFail("Expected failure") } catch {}
        XCTAssertEqual(attempts, 1)
    }

    func testCreateEventDoesNotReplayWhenCommittedResponseIsLost() async {
        let service = ProfileService(client: APIClient(baseURL: URL(string: "https://api.example.test")!,
            session: session, retryPolicy: RetryPolicy(maxAttempts: 3)), authService: authService, sessionStore: tokenStore)
        var attempts = 0
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/events")
            attempts += 1
            throw URLError(.networkConnectionLost)
        }
        let draft = EventDraft(title: "Run", description: nil, sport: "running", startsAt: "2030-01-01T10:00:00Z",
            endsAt: "2030-01-01T11:00:00Z", capacity: 10, venueName: "Park", venueAddress: nil, venueLatitude: 31, venueLongitude: 121)
        do { _ = try await service.createEvent(draft); XCTFail("Expected lost response") } catch {}
        XCTAssertEqual(attempts, 1)
    }

    func testDiscoverSendsAuthenticatedFiltersAndDecodesCityWithoutCoordinates() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/discover")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertTrue(query.contains(URLQueryItem(name: "paceMin", value: "5.0")))
            return Self.response(request, status: 200, body: """
            {"users":[{"id":"partner","displayName":"Runner","photoURL":null,
            "city":{"name":"Shanghai","regionCode":"SH","countryCode":"CN"},
            "approximateDistanceKm":0,"sports":[],"commonSports":["running"]}],"nextCursor":"signed-cursor"}
            """)
        }
        let page = try await service.discover(filters: DiscoverFilters(sport: .running, radius: 10, paceMin: 5, paceMax: 6), cursor: nil)
        XCTAssertNil(page.users.first?.city.latitude)
        XCTAssertNil(page.users.first?.city.longitude)
        XCTAssertEqual(page.users.first?.commonSports, [.running])
        XCTAssertEqual(page.nextCursor, "signed-cursor")
    }

    func testSafetyWritesDeriveIdentityFromTokensAndDecodeReportReference() async throws {
        let targetID = "e1700000-0000-4000-8000-000000000002"
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            if request.url?.path == "/v1/reports" {
                XCTAssertEqual(request.httpMethod, "POST")
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(Self.bodyData(request))) as? [String: Any])
                XCTAssertEqual(body["targetId"] as? String, targetID)
                XCTAssertEqual(body["targetType"] as? String, "user")
                XCTAssertEqual(body["reason"] as? String, "hate_abuse")
                XCTAssertEqual(body["blockUser"] as? Bool, true)
                XCTAssertNil(body["reporterId"])
                XCTAssertNil(body["snapshot"])
                return Self.response(request, status: 201, body: "{\"referenceId\":\"reference\",\"blockedUser\":true}")
            }
            XCTAssertEqual(request.url?.path, "/v1/blocks/\(targetID)")
            return Self.response(request, status: 204, body: "")
        }
        try await service.block(userID: targetID)
        try await service.unblock(userID: targetID)
        let receipt = try await service.report(userID: targetID, reason: .hateAbuse, details: "Evidence", blockUser: true)
        XCTAssertEqual(receipt.referenceId, "reference")
        XCTAssertTrue(receipt.blockedUser)
    }

    func testBlockedUsersCursorAndPrivateCityContract() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/blocks")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "cursor")
            return Self.response(request, status: 200, body: "{\"users\":[{\"id\":\"blocked\",\"displayName\":\"Runner\",\"cityName\":\"Shanghai\"}],\"nextCursor\":null}")
        }
        let page = try await service.blockedUsers(cursor: "cursor")
        XCTAssertEqual(page.users.first?.displayName, "Runner")
        XCTAssertEqual(page.users.first?.cityName, "Shanghai")
        XCTAssertNil(page.nextCursor)
    }

    func testReportsDoNotAutomaticallyRetryLostResponses() async {
        var calls = 0
        ProfileURLProtocolStub.requestHandler = { _ in calls += 1; throw URLError(.networkConnectionLost) }
        let client = APIClient(baseURL: URL(string: "https://api.example.test")!, session: session, retryPolicy: RetryPolicy(maxAttempts: 2))
        let service = ProfileService(client: client, authService: authService, sessionStore: tokenStore)
        do {
            _ = try await service.report(userID: "e1700000-0000-4000-8000-000000000002", reason: .other, details: "", blockUser: false)
            XCTFail("Expected transport failure")
        } catch { XCTAssertEqual(calls, 1) }
    }

    func testReadsOwnProfileWithBearerToken() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/me")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            return Self.response(request, status: 200, body: Self.profileJSON)
        }

        let profile = try await service.getOwnProfile()

        XCTAssertEqual(profile.displayName, "Alex Runner")
        XCTAssertEqual(profile.city?.latitude, 31.2304)
        XCTAssertEqual(profile.sports.first?.paceUnit, "min/km")
        XCTAssertTrue(profile.isComplete)
    }

    func testUpdateSendsCityCenterAndPaceValueWithoutDerivedFieldsOrIdentity() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/me")
            XCTAssertEqual(request.httpMethod, "PATCH")
            let data = try XCTUnwrap(Self.bodyData(request))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertNil(body["userId"])
            let sports = try XCTUnwrap(body["sports"] as? [[String: Any]])
            XCTAssertEqual(sports.first?["sport"] as? String, "running")
            XCTAssertEqual(sports.first?["paceValue"] as? Double, 5.25)
            XCTAssertNil(sports.first?["paceUnit"])
            XCTAssertNil(sports.first?["paceBracket"])
            let swimming = try XCTUnwrap(sports.first { ($0["sport"] as? String) == "swimming" })
            XCTAssertTrue(swimming["paceValue"] is NSNull)
            let city = try XCTUnwrap(body["city"] as? [String: Any])
            XCTAssertEqual(city["name"] as? String, "Shanghai")
            return Self.response(request, status: 200, body: Self.profileJSON)
        }
        let profile = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(Self.profileJSON.utf8)).profile
        var draft = ProfileDraft(profile: profile)
        draft.paceValues[.running] = "5:15"
        draft.selectedSports.insert(.swimming)

        _ = try await service.updateProfile(draft)
    }

    func testDurationPaceFormattingAndParsing() throws {
        for sport in WorkoutSport.allCases where sport.usesDurationPace {
            XCTAssertEqual(sport.formattedPace(5.2), "5:12")
            XCTAssertEqual(try XCTUnwrap(sport.parsedPace("5:12")), 5.2, accuracy: 0.0001)
            XCTAssertEqual(sport.formattedPace(5.983333), "5:59")
            for invalid in ["5.2", "5:60", "5:2", ":12", "0:00", "-1:12", "5:12:00"] {
                XCTAssertNil(sport.parsedPace(invalid), invalid)
            }
        }
        XCTAssertEqual(WorkoutSport.cycling.parsedPace("25.5"), 25.5)
        XCTAssertNil(WorkoutSport.cycling.parsedPace("5:12"))
    }

    func testDraftBackfillsPaceAsMinutesAndSeconds() throws {
        let profile = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(Self.profileJSON.utf8)).profile
        XCTAssertEqual(ProfileDraft(profile: profile).paceValues[.running], "5:12")
    }

    func testUpdateEncodesMissingCityRegionAsExplicitNull() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            let data = try XCTUnwrap(Self.bodyData(request))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let city = try XCTUnwrap(body["city"] as? [String: Any])
            XCTAssertTrue(city["regionCode"] is NSNull)
            return Self.response(request, status: 200, body: Self.profileJSON)
        }
        let profile = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(Self.profileJSON.utf8)).profile
        var draft = ProfileDraft(profile: profile)
        draft.city = ProfileCity(name: "Shanghai", regionCode: nil, countryCode: "CN", latitude: 31.2304, longitude: 121.4737)
        _ = try await service.updateProfile(draft)
    }

    func testInvalidDurationPaceDoesNotSendRequest() async throws {
        ProfileURLProtocolStub.requestHandler = { _ in
            XCTFail("Invalid pace must be rejected before making a network request")
            throw URLError(.unknown)
        }
        let profile = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(Self.profileJSON.utf8)).profile
        var draft = ProfileDraft(profile: profile)
        draft.paceValues[.running] = "5:60"
        do {
            _ = try await service.updateProfile(draft)
            XCTFail("Expected pace validation error")
        } catch let error as APIError {
            XCTAssertTrue(error.userMessage.contains("mm:ss"))
        }
    }

    func testUnauthorizedProfileRequestRefreshesAndPersistsRotatedTokens() async throws {
        var requests = 0
        ProfileURLProtocolStub.requestHandler = { request in
            requests += 1
            if requests == 1 {
                return Self.response(
                    request,
                    status: 401,
                    body: #"{"code":"invalid_session","message":"Expired","requestId":"expired"}"#
                )
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access-token")
            return Self.response(request, status: 200, body: Self.profileJSON)
        }

        _ = try await service.getOwnProfile()

        XCTAssertEqual(authService.refreshToken, "profile-refresh-token")
        XCTAssertEqual(tokenStore.savedSession?.accessToken, "rotated-access-token")
        XCTAssertEqual(requests, 2)
    }

    @MainActor
    func testConcurrentProfileAndSafetyRequestsRotateRefreshTokenOnlyOnce() async throws {
        let expiredRequests = expectation(description: "Both features used the expired access token")
        expiredRequests.expectedFulfillmentCount = 2
        ProfileURLProtocolStub.requestHandler = { request in
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer profile-access-token" {
                expiredRequests.fulfill()
                return Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access-token")
            return Self.response(request, status: 200,
                                 body: request.url?.path == "/v1/blocks" ? #"{"users":[],"nextCursor":null}"# : Self.profileJSON)
        }
        authService.refreshHandler = { _ in
            await self.fulfillment(of: [expiredRequests], timeout: 5)
            return ProfileTestAuthService.rotatedSession
        }
        async let profile = service.getOwnProfile()
        async let blocked = service.blockedUsers(cursor: nil)
        _ = try await (profile, blocked)
        XCTAssertEqual(authService.refreshCalls, 1)
        XCTAssertEqual(tokenStore.tokens?.refreshToken, "rotated-refresh-token")
    }

    @MainActor
    func testRefreshCannotRestoreTokensAfterSignOut() async throws {
        ProfileURLProtocolStub.requestHandler = { request in
            Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
        }
        authService.refreshHandler = { _ in
            try self.tokenStore.clear()
            return ProfileTestAuthService.rotatedSession
        }
        do {
            _ = try await service.getOwnProfile()
            XCTFail("A signed-out session must not be restored by a pending refresh")
        } catch let error as APIError {
            guard case .unauthorized = error else { return XCTFail("Expected unauthorized") }
        }
        XCTAssertNil(tokenStore.tokens)
        XCTAssertNil(tokenStore.savedSession)
    }

    @MainActor
    func testRefreshCannotOverwriteANewlySignedInAccount() async throws {
        let newTokens = SessionTokens(accessToken: "new-account-access", refreshToken: "new-account-refresh")
        ProfileURLProtocolStub.requestHandler = { request in
            Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
        }
        authService.refreshHandler = { _ in
            self.tokenStore.tokens = newTokens
            return ProfileTestAuthService.rotatedSession
        }
        do {
            _ = try await service.getOwnProfile()
            XCTFail("An old request must not overwrite the new account")
        } catch let error as APIError {
            guard case .unauthorized = error else { return XCTFail("Expected unauthorized") }
        }
        XCTAssertEqual(tokenStore.tokens, newTokens)
        XCTAssertNil(tokenStore.savedSession)
    }

    func testRejectedRefreshClearsTokensAndNotifiesSessionExpiry() async throws {
        let expired = expectation(forNotification: .authenticationSessionExpired, object: nil)
        ProfileURLProtocolStub.requestHandler = { request in
            Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
        }
        authService.refreshHandler = { _ in
            throw APIError.unauthorized(code: "invalid_session", message: "Refresh revoked", requestID: "refresh-rejected")
        }
        do {
            _ = try await service.getOwnProfile()
            XCTFail("Expected rejected refresh")
        } catch let error as APIError {
            XCTAssertEqual(error.requestID, "refresh-rejected")
        }
        await fulfillment(of: [expired], timeout: 5)
        XCTAssertNil(tokenStore.tokens)
    }

    func testOfflineRefreshPreservesTokensForRecovery() async throws {
        let original = tokenStore.tokens
        ProfileURLProtocolStub.requestHandler = { request in
            Self.response(request, status: 401, body: #"{"code":"invalid_session","message":"Expired"}"#)
        }
        authService.refreshHandler = { _ in throw APIError.transport(.notConnectedToInternet) }
        do {
            _ = try await service.getOwnProfile()
            XCTFail("Expected offline error")
        } catch let error as APIError {
            XCTAssertEqual(error, .transport(.notConnectedToInternet))
        }
        XCTAssertEqual(tokenStore.tokens, original)
    }

    func testPhotoProcessingCenterCropsAndCompressesToJPEG() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 400))
        let source = renderer.image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
        }
        let sourceData = try XCTUnwrap(source.pngData())

        let photo = try ProfilePhoto.processedJPEG(from: sourceData)
        let processed = try XCTUnwrap(UIImage(data: photo.data))

        XCTAssertEqual(photo.contentType, "image/jpeg")
        XCTAssertEqual(photo.fileName, "profile.jpg")
        XCTAssertEqual(processed.size.width, processed.size.height)
        XCTAssertLessThanOrEqual(photo.data.count, 5 * 1_024 * 1_024)
    }

    func testLargePhotoOutputIsBoundedInPixelsRegardlessOfScreenScale() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 4096, height: 2048), format: format)
        let image = renderer.image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4096, height: 2048))
        }
        let photo = try ProfilePhoto.processedJPEG(from: XCTUnwrap(image.pngData()))
        let result = try XCTUnwrap(UIImage(data: photo.data)?.cgImage)
        XCTAssertEqual(result.width, 1600)
        XCTAssertEqual(result.height, 1600)
    }

    func testPhotoUploadPostsMultipartFileAndOrder() async throws {
        let uploadPath = "/v1/me/photos"
        let photo = ProfilePhoto(data: Data([1, 2, 3]), fileName: "profile.jpg", contentType: "image/jpeg")
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, uploadPath)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=LauverPhoto-") == true)
            let body = try XCTUnwrap(Self.bodyData(request))
            let text = String(decoding: body, as: UTF8.self)
            XCTAssertTrue(text.contains("name=\"photoOrder\"\r\n\r\n1"))
            XCTAssertTrue(text.contains("name=\"photo\"; filename=\"profile.jpg\""))
            XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
            return Self.response(request, status: 201, body: Self.profileJSON.replacingOccurrences(of: "}}", with: "},\"photo\":{\"id\":\"photo-1\",\"url\":\"https://photos.example.test/photo.jpg\",\"sortOrder\":0,\"isPrimary\":true}}"))
        }
        let result = try await service.uploadPhotoWithReference(photo)
        XCTAssertEqual(result.photoID, "photo-1")
    }

    func testPhotoUploadDoesNotRetryLostMultipartResponse() async throws {
        var requests = 0
        ProfileURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/me/photos")
            requests += 1
            throw URLError(.networkConnectionLost)
        }
        do {
            _ = try await service.uploadPhoto(ProfilePhoto(data: Data([1]), fileName: "profile.jpg", contentType: "image/jpeg"))
            XCTFail("Expected upload failure")
        } catch {
            XCTAssertEqual(error as? APIError, .transport(.networkConnectionLost))
        }
        XCTAssertEqual(requests, 1)
    }

    func testPublicProfileContractDecodesWithoutCoordinates() throws {
        let json = #"{"profile":{"id":"other-user","displayName":"Taylor","bio":null,"photoURL":null,"city":{"name":"Shanghai","regionCode":"SH","countryCode":"CN"},"sports":[],"trainingTimes":[],"isComplete":true}}"#
        let envelope = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(json.utf8))

        XCTAssertNil(envelope.profile.city?.latitude)
        XCTAssertNil(envelope.profile.city?.longitude)
    }

    private static let profileJSON = #"{"profile":{"id":"profile-user","displayName":"Alex Runner","bio":"Morning miles","photoURL":null,"city":{"name":"Shanghai","regionCode":"SH","countryCode":"CN","latitude":31.2304,"longitude":121.4737},"sports":[{"sport":"running","paceValue":5.2,"paceUnit":"min/km"}],"trainingTimes":[{"weekday":1,"timeBucket":"morning"}],"isComplete":true}}"#

    private static func response(_ request: URLRequest, status: Int, body: String) -> (HTTPURLResponse, Data) {
        (
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!,
            Data(body.utf8)
        )
    }

    private static func bodyData(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var result = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 2_048)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 2_048)
            if count <= 0 { break }
            result.append(buffer, count: count)
        }
        return result
    }
}

private struct ProfileEnvelopeForTest: Decodable { let profile: WorkoutProfile }

private final class ProfileTestSessionStore: AuthSessionStoring {
    var tokens: SessionTokens?
    var savedSession: AuthSession?

    init(tokens: SessionTokens?) { self.tokens = tokens }
    func read() throws -> SessionTokens? { tokens }
    func save(_ session: AuthSession) throws {
        savedSession = session
        tokens = SessionTokens(accessToken: session.accessToken, refreshToken: session.refreshToken)
    }
    func clear() throws { tokens = nil }
}

private final class ProfileTestAuthService: AuthServicing {
    var refreshToken: String?
    var refreshCalls = 0
    var refreshHandler: ((String) async throws -> AuthSession)?
    func register(email: String, password: String) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func login(email: String, password: String) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func signInWithGoogle() async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func refresh(refreshToken: String) async throws -> AuthSession {
        self.refreshToken = refreshToken
        refreshCalls += 1
        if let refreshHandler { return try await refreshHandler(refreshToken) }
        return Self.rotatedSession
    }
    static var rotatedSession: AuthSession {
        AuthSession(
            user: AuthUser(id: "profile-user", email: "runner@example.com"),
            accessToken: "rotated-access-token",
            refreshToken: "rotated-refresh-token",
            expiresIn: 900
        )
    }
    func logout(refreshToken: String) async throws {}
    func forgotPassword(email: String) async throws {}
    func resetPassword(token: String, password: String) async throws {}
    func restore(accessToken: String) async throws -> AuthUser { throw URLError(.unsupportedURL) }
}

private final class ProfileURLProtocolStub: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.requestHandler else { throw URLError(.unknown) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

@MainActor
final class SafetyViewModelTests: XCTestCase {
    func testReportFailureCanRetryButSuccessCannotBeSubmittedTwice() async {
        let service = SafetyViewModelTestService()
        let model = ReportViewModel(service: service)
        service.fail = true
        await model.submit(userID: "target", reason: .harassment, details: "Note", blockUser: false)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.receipt)
        XCTAssertFalse(model.isSubmitting)
        service.fail = false
        await model.submit(userID: "target", reason: .harassment, details: "Note", blockUser: false)
        XCTAssertNotNil(model.receipt)
        XCTAssertNil(model.errorMessage)
        await model.submit(userID: "target", reason: .harassment, details: "Note", blockUser: false)
        XCTAssertEqual(service.reportCount, 2)
    }
    func testFailedUnblockKeepsEntryAndSuccessfulRetryRemovesIt() async throws {
        let service = SafetyViewModelTestService()
        let model = BlockedUsersViewModel(service: service)
        await model.load()
        let user = try XCTUnwrap(model.users.first)
        service.fail = true
        await model.unblock(user)
        XCTAssertEqual(model.users.count, 1)
        XCTAssertNotNil(model.errorMessage)
        service.fail = false
        await model.unblock(user)
        XCTAssertTrue(model.users.isEmpty)
        XCTAssertNil(model.errorMessage)
    }
    func testBlockedPageFailureKeepsCursorButFailedRefreshRetriesFirstPage() async {
        let service = SafetyViewModelTestService()
        service.pageCursor = "next-page"
        let model = BlockedUsersViewModel(service: service)
        await model.load()
        service.failLoad = true
        await model.load(refresh: false)
        XCTAssertEqual(model.nextCursor, "next-page")
        XCTAssertEqual(model.users.count, 1)
        await model.load()
        XCTAssertNil(model.nextCursor)
        XCTAssertEqual(model.users.count, 1)
        service.failLoad = false
        await model.load(refresh: model.nextCursor == nil)
        XCTAssertNil(service.requestedCursor)
        XCTAssertNil(model.errorMessage)
    }
}

private final class SafetyViewModelTestService: SafetyServicing {
    var fail = false
    var reportCount = 0
    var failLoad = false
    var pageCursor: String?
    var requestedCursor: String?
    func block(userID: String) async throws {}
    func unblock(userID: String) async throws { if fail { throw APIError.transport(.notConnectedToInternet) } }
    func blockedUsers(cursor: String?) async throws -> BlockedUsersPage {
        requestedCursor = cursor
        if failLoad { throw APIError.transport(.notConnectedToInternet) }
        return BlockedUsersPage(users: [BlockedUser(id: "target", displayName: "Runner", cityName: "City")], nextCursor: pageCursor)
    }
    func report(userID: String, reason: ReportReason, details: String, blockUser: Bool) async throws -> ReportReceipt {
        reportCount += 1
        if fail { throw APIError.transport(.notConnectedToInternet) }
        return ReportReceipt(referenceId: "reference", blockedUser: blockUser)
    }
}

@MainActor
final class ProfileViewModelCancellationTests: XCTestCase {
    func testRetryAfterReorderFailureDoesNotReuploadCommittedPhotos() async throws {
        let service = ProfileViewModelTestService()
        let model = ProfileViewModel(service: service)
        await model.load()
        let draft = ProfileDraft(profile: try XCTUnwrap(model.profile))
        let photos = [
            ProfilePhoto(data: Data([1]), fileName: "one.jpg", contentType: "image/jpeg"),
            ProfilePhoto(data: Data([2]), fileName: "two.jpg", contentType: "image/jpeg"),
        ]
        let edits = photos.map { ProfilePhotoEdit(id: UUID().uuidString, existing: nil, replacementOf: nil, upload: $0) }
        service.reorderError = APIError.server(statusCode: 500, requestID: nil)

        let firstAttempt = await model.savePhotoEdits(draft: draft, photoEdits: edits)

        XCTAssertFalse(firstAttempt.saved)
        XCTAssertEqual(service.uploadCount, 2)
        XCTAssertTrue(firstAttempt.edits.allSatisfy { $0.uploadedPhotoID != nil })

        service.reorderError = nil
        let retry = await model.savePhotoEdits(draft: draft, photoEdits: firstAttempt.edits)

        XCTAssertTrue(retry.saved)
        XCTAssertEqual(service.uploadCount, 2)
        XCTAssertEqual(service.reorderCount, 2)
    }

    func testCancelledReloadKeepsTheUploadedPhotoWithoutAnError() async throws {
        let service = ProfileViewModelTestService()
        let model = ProfileViewModel(service: service)
        await model.load()
        let draft = ProfileDraft(profile: try XCTUnwrap(model.profile))
        let saved = await model.save(draft: draft, photo: ProfilePhoto(
            data: Data([1]), fileName: "profile.jpg", contentType: "image/jpeg"
        ))
        XCTAssertTrue(saved)
        service.loadError = APIError.transport(.cancelled)

        await model.load()

        XCTAssertEqual(model.profile?.photoURL, service.uploadedProfile.photoURL)
        XCTAssertNil(model.errorMessage)
        XCTAssertNil(model.requestID)
        XCTAssertFalse(model.isLoading)
        service.loadError = nil
        service.currentProfile = service.uploadedProfile
        await model.load()
        XCTAssertEqual(model.profile, service.uploadedProfile)
    }

    func testAllCancellationRepresentationsAreSilentAndAllowAnotherLoad() async {
        for error in [CancellationError(), URLError(.cancelled), APIError.transport(.cancelled)] as [Error] {
            let service = ProfileViewModelTestService()
            service.loadError = error
            let model = ProfileViewModel(service: service)
            await model.load()
            XCTAssertNil(model.errorMessage)
            XCTAssertFalse(model.isLoading)
            service.loadError = nil
            await model.load()
            XCTAssertEqual(model.profile, service.currentProfile)
        }
    }

    func testAlreadyCancelledLoadDoesNotSendARequest() async {
        let service = ProfileViewModelTestService()
        let model = ProfileViewModel(service: service)
        let loading = Task { await model.load() }
        loading.cancel()
        await loading.value
        XCTAssertEqual(service.loadCount, 0)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isLoading)
    }

    func testCancelledLoadCannotOverwriteANewerSavedPhoto() async throws {
        let service = ProfileViewModelTestService()
        let model = ProfileViewModel(service: service)
        await model.load()
        let draft = ProfileDraft(profile: try XCTUnwrap(model.profile))
        var response: CheckedContinuation<WorkoutProfile, Error>?
        let started = expectation(description: "Profile load started")
        service.loadHandler = {
            try await withCheckedThrowingContinuation {
                response = $0
                started.fulfill()
            }
        }
        let loading = Task { await model.load() }
        await fulfillment(of: [started], timeout: 2)
        let pendingResponse = try XCTUnwrap(response)
        let saved = await model.save(draft: draft, photo: ProfilePhoto(
            data: Data([1]), fileName: "profile.jpg", contentType: "image/jpeg"
        ))
        XCTAssertTrue(saved)
        loading.cancel()
        pendingResponse.resume(returning: service.currentProfile)
        await loading.value
        XCTAssertEqual(model.profile, service.uploadedProfile)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isLoading)
    }

    func testActualNetworkFailureIsStillShownWithTheExistingProfile() async {
        let service = ProfileViewModelTestService()
        let model = ProfileViewModel(service: service)
        await model.load()
        service.loadError = APIError.transport(.notConnectedToInternet)
        await model.load()
        XCTAssertEqual(model.profile, service.currentProfile)
        XCTAssertEqual(model.errorMessage, APIError.transport(.notConnectedToInternet).userMessage)
        XCTAssertFalse(model.isLoading)
    }
}

@MainActor
private final class ProfileViewModelTestService: ProfileServicing {
    var currentProfile = WorkoutProfile(
        id: "test-profile", displayName: "Runner", bio: nil, photoURL: nil,
        city: nil, sports: [], trainingTimes: [], isComplete: false
    )
    let uploadedProfile = WorkoutProfile(
        id: "test-profile", displayName: "Runner", bio: nil,
        photoURL: URL(string: "https://photos.example.test/profile.jpg"),
        city: nil, sports: [], trainingTimes: [], isComplete: false
    )
    var loadError: Error?
    var loadHandler: (() async throws -> WorkoutProfile)?
    var loadCount = 0
    var uploadCount = 0
    var reorderCount = 0
    var reorderError: Error?

    func getOwnProfile() async throws -> WorkoutProfile {
        loadCount += 1
        if let loadHandler { return try await loadHandler() }
        if let loadError { throw loadError }
        return currentProfile
    }
    func previewOwnProfile() async throws -> WorkoutProfile { currentProfile }
    func getProfile(userID: String) async throws -> WorkoutProfile { currentProfile }
    func getMatchPreferences() async throws -> MatchPreferences { MatchPreferences(visibleInMatch: false, gender: nil, preferredGender: "all", maxDistanceKm: 25, sports: []) }
    func updateMatchVisibility(_ visible: Bool) async throws -> MatchPreferences { MatchPreferences(visibleInMatch: visible, gender: nil, preferredGender: "all", maxDistanceKm: 25, sports: []) }
    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile { currentProfile }
    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile { uploadedProfile }
    func createPhotoUploadTickets(_ requests: [PhotoUploadRequest]) async throws -> [PhotoUploadTicket] {
        requests.map { PhotoUploadTicket(clientID: $0.clientID, photoOrder: $0.photoOrder) }
    }
    func uploadPhoto(_ photo: ProfilePhoto, using ticket: PhotoUploadTicket) async throws -> PhotoUploadResult {
        uploadCount += 1
        return PhotoUploadResult(profile: uploadedProfile, photoID: "photo-\(uploadCount)")
    }
    func deletePhoto(photoID: String) async throws {}
    func reorderPhotos(_ photoIDs: [String]) async throws -> WorkoutProfile {
        reorderCount += 1
        if let reorderError { throw reorderError }
        return uploadedProfile
    }
    func deletePhoto() async throws {}
}
