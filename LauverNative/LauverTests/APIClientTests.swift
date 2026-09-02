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

        await assertError(.unauthorized(requestID: "request-401"))
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
