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

    func testPublicProfileContractDecodesWithoutCoordinates() throws {
        let json = #"{"profile":{"id":"other-user","displayName":"Taylor","bio":null,"photoURL":null,"city":{"name":"Shanghai","regionCode":"SH","countryCode":"CN"},"sports":[],"trainingTimes":[],"isComplete":true}}"#
        let envelope = try JSONDecoder().decode(ProfileEnvelopeForTest.self, from: Data(json.utf8))

        XCTAssertNil(envelope.profile.city?.latitude)
        XCTAssertNil(envelope.profile.city?.longitude)
    }

    private static let profileJSON = #"{"profile":{"id":"profile-user","displayName":"Alex Runner","bio":"Morning miles","photoURL":null,"city":{"name":"Shanghai","regionCode":"SH","countryCode":"CN","latitude":31.2304,"longitude":121.4737},"sports":[{"sport":"running","paceValue":5.2,"paceUnit":"min/km","paceBracket":"moderate"}],"trainingTimes":[{"weekday":1,"timeBucket":"morning"}],"isComplete":true}}"#

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
