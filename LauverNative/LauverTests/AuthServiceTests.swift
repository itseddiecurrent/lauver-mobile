import Foundation
import XCTest
@testable import Lauver

final class AuthServiceTests: XCTestCase {
    private var urlSession: URLSession!
    private var service: AuthService!

    override func setUp() {
        super.setUp()
        AuthURLProtocolStub.requestHandler = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthURLProtocolStub.self]
        urlSession = URLSession(configuration: configuration)
        service = AuthService(client: APIClient(
            baseURL: URL(string: "https://api.example.test")!,
            session: urlSession,
            retryPolicy: RetryPolicy(maxAttempts: 1)
        ))
    }

    override func tearDown() {
        urlSession.invalidateAndCancel()
        AuthURLProtocolStub.requestHandler = nil
        service = nil
        urlSession = nil
        super.tearDown()
    }

    func testRegisterSendsCredentialsAndDecodesSession() async throws {
        AuthURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/auth/register")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try XCTUnwrap(Self.bodyData(from: request))
            let payload = try JSONSerialization.jsonObject(with: body) as? [String: String]
            XCTAssertEqual(payload, ["email": "runner@example.com", "password": "CorrectHorse9"])
            return Self.response(request, statusCode: 201, body: Self.sessionJSON)
        }

        let session = try await service.register(
            email: "runner@example.com",
            password: "CorrectHorse9"
        )

        XCTAssertEqual(session.user.email, "runner@example.com")
        XCTAssertEqual(session.refreshToken, "refresh-token")
    }

    func testForgotPasswordUsesTheContractPathAndOnlySendsEmail() async throws {
        AuthURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/auth/password/forgot")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try XCTUnwrap(Self.bodyData(from: request))
            let payload = try JSONSerialization.jsonObject(with: body) as? [String: String]
            XCTAssertEqual(payload, ["email": "runner@example.com"])
            return Self.response(request, statusCode: 202, body: #"{"message":"Reset requested"}"#)
        }

        try await service.forgotPassword(email: "runner@example.com")
    }

    func testResetPasswordUsesTheContractPathAndDoesNotSendAnIdentity() async throws {
        AuthURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/auth/password/reset")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try XCTUnwrap(Self.bodyData(from: request))
            let payload = try JSONSerialization.jsonObject(with: body) as? [String: String]
            XCTAssertEqual(payload, [
                "token": "one-time-reset-token",
                "password": "ReplacementHorse8"
            ])
            XCTAssertNil(payload?["userId"])
            return Self.response(request, statusCode: 200, body: #"{"message":"Password reset completed"}"#)
        }

        try await service.resetPassword(
            token: "one-time-reset-token",
            password: "ReplacementHorse8"
        )
    }

    func testRestoreUsesBearerTokenRatherThanARequestBodyUserID() async throws {
        AuthURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/auth/session")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer signed-token")
            XCTAssertNil(request.httpBody)
            return Self.response(
                request,
                statusCode: 200,
                body: #"{"user":{"id":"trusted-user","email":"runner@example.com"}}"#
            )
        }

        let user = try await service.restore(accessToken: "signed-token")

        XCTAssertEqual(user.id, "trusted-user")
    }

    func testLogoutAcceptsAnEmptySuccessResponse() async throws {
        AuthURLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/auth/logout")
            return Self.response(request, statusCode: 204, body: "")
        }

        try await service.logout(refreshToken: "refresh-token")
    }

    private static let sessionJSON = #"{"user":{"id":"user-id","email":"runner@example.com"},"accessToken":"access-token","refreshToken":"refresh-token","expiresIn":900}"#

    private static func response(
        _ request: URLRequest,
        statusCode: Int,
        body: String
    ) -> (HTTPURLResponse, Data) {
        (
            HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!,
            Data(body.utf8)
        )
    }

    private static func bodyData(from request: URLRequest) -> Data? {
        if let httpBody = request.httpBody { return httpBody }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1_024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1_024)
            if count < 0 { return nil }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class AuthURLProtocolStub: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let requestHandler = Self.requestHandler else { throw URLError(.unknown) }
            let (response, data) = try requestHandler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
