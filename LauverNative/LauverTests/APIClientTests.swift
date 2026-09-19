import Foundation
import XCTest
@testable import Lauver

final class APIClientTests: XCTestCase {
    private var session: URLSession!
    private var client: APIClient!

    override func setUp() {
        super.setUp()
        URLProtocolStub.requestHandler = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        session = URLSession(configuration: configuration)
        client = APIClient(
            baseURL: URL(string: "https://api.example.test")!,
            session: session,
            retryPolicy: RetryPolicy(maxAttempts: 2)
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        URLProtocolStub.requestHandler = nil
        client = nil
        session = nil
        super.tearDown()
    }

    func testDecodesSuccessfulResponse() async throws {
        URLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.test/healthz")
            XCTAssertEqual(request.httpMethod, "GET")
            return Self.response(
                request: request,
                statusCode: 200,
                body: #"{"status":"ok","service":"lauver-api"}"#
            )
        }

        let response: HealthResponse = try await client.send(APIRequest(path: "/healthz"))

        XCTAssertEqual(response, HealthResponse(status: "ok", service: "lauver-api"))
    }

    func testMaps401AndDoesNotRetry() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(
                request: request,
                statusCode: 401,
                headers: ["x-request-id": "request-401"],
                body: #"{"code":"unauthorized","message":"Unauthorized","requestId":"request-401"}"#
            )
        }

        await assertError(.unauthorized(
            code: "unauthorized",
            message: "Unauthorized",
            requestID: "request-401"
        ))
        XCTAssertEqual(attempts, 1)
    }

    func testMaps422PayloadAndDoesNotRetry() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(
                request: request,
                statusCode: 422,
                body: #"{"code":"invalid_email","message":"Email is invalid","requestId":"request-422"}"#
            )
        }

        await assertError(.validation(
            code: "invalid_email",
            message: "Email is invalid",
            requestID: "request-422"
        ))
        XCTAssertEqual(attempts, 1)
    }

    func testRetries500WithinBoundaryThenReturnsServerError() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(
                request: request,
                statusCode: 500,
                headers: ["x-request-id": "request-500"],
                body: #"{"code":"internal_error","message":"Failed","requestId":"request-500"}"#
            )
        }

        await assertError(.server(statusCode: 500, requestID: "request-500"))
        XCTAssertEqual(attempts, 2)
    }

    func testMaps409And429WithoutRetry() async {
        var statusCode = 409
        URLProtocolStub.requestHandler = { request in
            Self.response(
                request: request,
                statusCode: statusCode,
                body: statusCode == 409
                    ? #"{"code":"registration_unavailable","message":"Registration could not be completed","requestId":"conflict-id"}"#
                    : #"{"code":"rate_limited","message":"Too many requests","retryAfter":7,"requestId":"rate-id"}"#
            )
        }

        await assertError(.conflict(
            code: "registration_unavailable",
            message: "Registration could not be completed",
            requestID: "conflict-id"
        ))
        statusCode = 429
        await assertError(.rateLimited(message: "Too many requests", retryAfter: 7, requestID: "rate-id"))
    }

    func testMaps404WithPublicMessageAndRequestID() async {
        URLProtocolStub.requestHandler = { request in
            Self.response(
                request: request,
                statusCode: 404,
                body: #"{"code":"profile_not_found","message":"Profile not found","requestId":"missing-profile"}"#
            )
        }

        await assertError(.notFound(
            code: "profile_not_found",
            message: "Profile not found",
            requestID: "missing-profile"
        ))
    }

    func testRetriesTimeoutWithinBoundary() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { _ in
            attempts += 1
            throw URLError(.timedOut)
        }

        await assertError(.transport(.timedOut))
        XCTAssertEqual(attempts, 2)
    }

    func testRetriesNoNetworkWithinBoundary() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { _ in
            attempts += 1
            throw URLError(.notConnectedToInternet)
        }

        await assertError(.transport(.notConnectedToInternet))
        XCTAssertEqual(attempts, 2)
    }

    func testPostRequestsNeverRetry() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(request: request, statusCode: 500, body: "{}")
        }

        let request: APIRequest<HealthResponse> = APIRequest(method: .post, path: "/healthz")
        do {
            _ = try await client.send(request)
            XCTFail("Expected request to fail")
        } catch {
            XCTAssertEqual(error as? APIError, .server(statusCode: 500, requestID: nil))
        }
        XCTAssertEqual(attempts, 1)
    }

    func testExplicitlyIdempotentPatchRecoversFromLostConnection() async throws {
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            XCTAssertEqual(request.httpMethod, "PATCH")
            if attempts == 1 { throw URLError(.networkConnectionLost) }
            return Self.response(request: request, statusCode: 200, body: "{}")
        }
        let _: EmptyResponse = try await client.send(APIRequest(
            method: .patch, path: "/v1/me", body: Data("{}".utf8), allowsConnectionRetry: true
        ))
        XCTAssertEqual(attempts, 2)
    }

    func testPatchWithoutExplicitOptInDoesNotRetry() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { _ in
            attempts += 1
            throw URLError(.networkConnectionLost)
        }
        do {
            let _: EmptyResponse = try await client.send(APIRequest(method: .patch, path: "/v1/me"))
            XCTFail("Expected connection error")
        } catch { XCTAssertEqual(error as? APIError, .transport(.networkConnectionLost)) }
        XCTAssertEqual(attempts, 1)
    }

    func testCancelledIdempotentPatchIsNotRetried() async {
        var attempts = 0
        URLProtocolStub.requestHandler = { _ in
            attempts += 1
            throw URLError(.cancelled)
        }
        do {
            let _: EmptyResponse = try await client.send(APIRequest(method: .patch, path: "/v1/me", allowsConnectionRetry: true))
            XCTFail("Expected cancellation")
        } catch { XCTAssertEqual(error as? APIError, .transport(.cancelled)) }
        XCTAssertEqual(attempts, 1)
    }

    func testPostConnectionRetriesRequireOptInAndRespectFailureBoundaries() async {
        let scenarios: [(URLError.Code, Bool, Int)] = [
            (.networkConnectionLost, false, 1),
            (.networkConnectionLost, true, 2),
            (.timedOut, true, 2),
            (.cancelled, true, 1),
            (.notConnectedToInternet, true, 1),
        ]
        for (code, optIn, expectedAttempts) in scenarios {
            var attempts = 0
            URLProtocolStub.requestHandler = { _ in
                attempts += 1
                throw URLError(code)
            }
            do {
                let _: EmptyResponse = try await client.send(APIRequest(
                    method: .post, path: "/v1/me/photo/upload-url", allowsConnectionRetry: optIn
                ))
                XCTFail("Expected connection error")
            } catch { XCTAssertEqual(error as? APIError, .transport(code)) }
            XCTAssertEqual(attempts, expectedAttempts)
        }
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(request: request, statusCode: 500, body: "{}")
        }
        do {
            let _: EmptyResponse = try await client.send(APIRequest(
                method: .post, path: "/v1/me/photo/complete", allowsConnectionRetry: true
            ))
            XCTFail("Expected server error")
        } catch { XCTAssertEqual(error as? APIError, .server(statusCode: 500, requestID: nil)) }
        XCTAssertEqual(attempts, 1)
    }

    func testSignedPutRetriesTheSameURLOnConnectionLoss() async throws {
        let uploadURL = URL(string: "https://storage.example.test/same-object")!
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            XCTAssertEqual(request.url, uploadURL)
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
            if attempts == 1 { throw URLError(.networkConnectionLost) }
            return Self.response(request: request, statusCode: 200, body: "")
        }
        try await client.upload(data: Data([1, 2, 3]), to: uploadURL, contentType: "image/jpeg")
        XCTAssertEqual(attempts, 2)
    }

    func testSignedPutRetryIsBoundedAndDoesNotRetryCancellationOrHTTPFailures() async {
        let uploadURL = URL(string: "https://storage.example.test/same-object")!
        for (failure, expectedAttempts) in [(URLError.Code.networkConnectionLost, 2), (.cancelled, 1)] {
            var attempts = 0
            URLProtocolStub.requestHandler = { _ in
                attempts += 1
                throw URLError(failure)
            }
            do {
                try await client.upload(data: Data([1]), to: uploadURL, contentType: "image/jpeg")
                XCTFail("Expected upload error")
            } catch { XCTAssertEqual(error as? APIError, .transport(failure)) }
            XCTAssertEqual(attempts, expectedAttempts)
        }
        var attempts = 0
        URLProtocolStub.requestHandler = { request in
            attempts += 1
            return Self.response(request: request, statusCode: 403, body: "")
        }
        do {
            try await client.upload(data: Data([1]), to: uploadURL, contentType: "image/jpeg")
            XCTFail("Expected forbidden upload")
        } catch { XCTAssertEqual(error as? APIError, .server(statusCode: 403, requestID: nil)) }
        XCTAssertEqual(attempts, 1)
    }

    private func assertError(_ expectedError: APIError) async {
        let request: APIRequest<HealthResponse> = APIRequest(path: "/healthz")
        do {
            _ = try await client.send(request)
            XCTFail("Expected request to fail")
        } catch {
            XCTAssertEqual(error as? APIError, expectedError)
        }
    }

    private static func response(
        request: URLRequest,
        statusCode: Int,
        headers: [String: String]? = nil,
        body: String
    ) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: headers
        )!
        return (response, Data(body.utf8))
    }
}

private final class URLProtocolStub: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let requestHandler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }

        do {
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
