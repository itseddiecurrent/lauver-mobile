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

    func testPhotoUploadRecoversFromConnectionLossAtEveryStage() async throws {
        let uploadPath = "/v1/me/photo/upload-url"
        let putPath = "/signed-avatar"
        let completePath = "/v1/me/photo/complete"
        let photo = ProfilePhoto(data: Data([1, 2, 3]), fileName: "profile.jpg", contentType: "image/jpeg")
        let recoveringService = ProfileService(
            client: APIClient(baseURL: URL(string: "https://api.example.test")!, session: session,
                              retryPolicy: RetryPolicy(maxAttempts: 2)),
            authService: authService, sessionStore: tokenStore
        )
        for failedPath in [uploadPath, putPath, completePath] {
            var attempts: [String: Int] = [:]
            ProfileURLProtocolStub.requestHandler = { request in
                let path = try XCTUnwrap(request.url?.path)
                attempts[path, default: 0] += 1
                if path == putPath {
                    XCTAssertEqual(request.httpMethod, "PUT")
                    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), photo.contentType)
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Length"), "3")
                    XCTAssertEqual(request.value(forHTTPHeaderField: "x-amz-meta-upload"), "avatar")
                } else {
                    XCTAssertEqual(request.httpMethod, "POST")
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer profile-access-token")
                    let body = try XCTUnwrap(Self.bodyData(request))
                    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                    if path == uploadPath {
                        XCTAssertEqual(json["byteSize"] as? Int, 3)
                    } else {
                        XCTAssertEqual(json["objectKey"] as? String, "pending-avatar")
                    }
                }
                if path == failedPath, attempts[path] == 1 { throw URLError(.networkConnectionLost) }
                if path == uploadPath {
                    return Self.response(request, status: 201, body: #"{"objectKey":"pending-avatar","uploadURL":"https://storage.example.test/signed-avatar","expiresIn":600,"requiredHeaders":{"Content-Type":"image/jpeg","x-amz-meta-upload":"avatar"}}"#)
                }
                if path == putPath { return Self.response(request, status: 200, body: "") }
                XCTAssertEqual(path, completePath)
                return Self.response(request, status: 200, body: Self.profileJSON)
            }
            _ = try await recoveringService.uploadPhoto(photo)
            for path in [uploadPath, putPath, completePath] {
                XCTAssertEqual(attempts[path], path == failedPath ? 2 : 1, failedPath)
            }
        }
    }

    func testFailedPhotoPutDoesNotCompleteUpload() async throws {
        var paths: [String] = []
        ProfileURLProtocolStub.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            paths.append(path)
            if request.httpMethod == "PUT" { throw URLError(.networkConnectionLost) }
            return Self.response(request, status: 201, body: #"{"objectKey":"pending-avatar","uploadURL":"https://storage.example.test/signed-avatar","expiresIn":600,"requiredHeaders":{"Content-Type":"image/jpeg"}}"#)
        }
        do {
            _ = try await service.uploadPhoto(ProfilePhoto(data: Data([1]), fileName: "profile.jpg", contentType: "image/jpeg"))
            XCTFail("Expected upload failure")
        } catch {
            XCTAssertEqual(error as? APIError, .transport(.networkConnectionLost))
        }
        XCTAssertEqual(paths, ["/v1/me/photo/upload-url", "/signed-avatar"])
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
    func register(email: String, password: String) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func login(email: String, password: String) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession { throw URLError(.unsupportedURL) }
    func refresh(refreshToken: String) async throws -> AuthSession {
        self.refreshToken = refreshToken
        return AuthSession(
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
final class ProfileViewModelCancellationTests: XCTestCase {
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

    func getOwnProfile() async throws -> WorkoutProfile {
        loadCount += 1
        if let loadHandler { return try await loadHandler() }
        if let loadError { throw loadError }
        return currentProfile
    }
    func getProfile(userID: String) async throws -> WorkoutProfile { currentProfile }
    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile { currentProfile }
    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile { uploadedProfile }
    func deletePhoto() async throws {}
}
