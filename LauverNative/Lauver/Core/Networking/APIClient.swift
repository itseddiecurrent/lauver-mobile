import Foundation
import os

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct APIRequest<Response: Decodable> {
    let method: HTTPMethod
    let path: String
    let body: Data?
    let headers: [String: String]
    /// A per-operation total request budget. Apple authorization codes are
    /// single-use, so callers must not turn a timeout into a retried POST.
    let timeoutInterval: TimeInterval?
    // Opt in only when repeating the same body after a lost response is safe.
    let allowsConnectionRetry: Bool

    init(
        method: HTTPMethod = .get,
        path: String,
        body: Data? = nil,
        headers: [String: String] = [:],
        allowsConnectionRetry: Bool = false,
        timeoutInterval: TimeInterval? = nil
    ) {
        self.method = method
        self.path = path
        self.body = body
        self.headers = headers
        self.allowsConnectionRetry = allowsConnectionRetry
        self.timeoutInterval = timeoutInterval
    }
}

struct APIErrorPayload: Codable, Equatable {
    let code: String
    let message: String
    let retryAfter: Int?
    let requestId: String?

    init(code: String, message: String, retryAfter: Int? = nil, requestId: String? = nil) {
        self.code = code
        self.message = message
        self.retryAfter = retryAfter
        self.requestId = requestId
    }
}

struct EmptyResponse: Decodable, Equatable {}

enum APIError: Error, Equatable {
    case invalidRequest
    case invalidResponse
    case unauthorized(code: String, message: String?, requestID: String?)
    case validation(code: String, message: String, requestID: String?)
    case notFound(code: String, message: String, requestID: String?)
    case conflict(code: String, message: String, requestID: String?)
    case rateLimited(message: String, retryAfter: Int?, requestID: String?)
    case server(statusCode: Int, requestID: String?)
    case transport(URLError.Code)
    case decoding

    /// Safe diagnostic text for auth/network troubleshooting. It deliberately
    /// excludes response messages and request bodies, which may contain
    /// credentials or provider data.
    var diagnosticDescription: String {
        switch self {
        case .invalidRequest: "invalidRequest"
        case .invalidResponse: "invalidResponse"
        case let .unauthorized(code, _, requestID): "unauthorized code=\(code) requestID=\(requestID ?? "none")"
        case let .validation(code, _, requestID): "validation code=\(code) requestID=\(requestID ?? "none")"
        case let .notFound(code, _, requestID): "notFound code=\(code) requestID=\(requestID ?? "none")"
        case let .conflict(code, _, requestID): "conflict code=\(code) requestID=\(requestID ?? "none")"
        case let .rateLimited(_, retryAfter, requestID): "rateLimited retryAfter=\(retryAfter.map(String.init) ?? "none") requestID=\(requestID ?? "none")"
        case let .server(statusCode, requestID): "server status=\(statusCode) requestID=\(requestID ?? "none")"
        case let .transport(code): "transport code=\(code.rawValue) (\(code))"
        case .decoding: "decoding"
        }
    }

    var requestID: String? {
        switch self {
        case let .unauthorized(_, _, requestID),
             let .validation(_, _, requestID),
             let .notFound(_, _, requestID),
             let .conflict(_, _, requestID),
             let .rateLimited(_, _, requestID),
             let .server(_, requestID):
            requestID
        case .invalidRequest, .invalidResponse, .transport, .decoding:
            nil
        }
    }

    var userMessage: String {
        switch self {
        case let .unauthorized(_, message, _):
            message ?? "Your session is no longer valid."
        case let .validation(_, message, _):
            message
        case let .notFound(_, message, _):
            message
        case let .conflict(_, message, _):
            message
        case let .rateLimited(message, retryAfter, _):
            if let retryAfter { "\(message) Try again in \(retryAfter) seconds." } else { message }
        case .server:
            "The service is temporarily unavailable."
        case .transport(.notConnectedToInternet):
            "You appear to be offline."
        case .transport(.timedOut):
            "Unable to contact the authentication server. Please try again."
        case .transport(.networkConnectionLost):
            "The connection was interrupted (error -1005). Please try again."
        case let .transport(code):
            "The network request failed (error \(code.rawValue)). Please try again."
        case .invalidRequest, .invalidResponse, .decoding:
            "The service returned an unexpected response."
        }
    }
}

struct RetryPolicy: Equatable {
    let maxAttempts: Int
    let delayNanoseconds: UInt64

    static let standard = RetryPolicy(maxAttempts: 2, delayNanoseconds: 250_000_000)

    init(maxAttempts: Int, delayNanoseconds: UInt64 = 0) {
        self.maxAttempts = max(1, maxAttempts)
        self.delayNanoseconds = delayNanoseconds
    }

    func permitsRetry(method: HTTPMethod, error: APIError, attempt: Int, allowsConnectionRetry: Bool = false) -> Bool {
        guard attempt < maxAttempts else { return false }
        if method != .get {
            guard [.patch, .post].contains(method), allowsConnectionRetry,
                  case let .transport(code) = error else { return false }
            return permitsIdempotentConnectionRetry(code: code, attempt: attempt)
        }

        switch error {
        case let .server(statusCode, _):
            return (500...599).contains(statusCode)
        case let .transport(code):
            return [.timedOut, .networkConnectionLost, .notConnectedToInternet].contains(code)
        case .invalidRequest, .invalidResponse, .unauthorized, .validation, .notFound, .conflict, .rateLimited, .decoding:
            return false
        }
    }

    func permitsIdempotentConnectionRetry(code: URLError.Code, attempt: Int) -> Bool {
        attempt < maxAttempts && [.networkConnectionLost, .timedOut].contains(code)
    }
}

final class APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let retryPolicy: RetryPolicy

    init(
        baseURL: URL,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        retryPolicy: RetryPolicy = .standard
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
        self.retryPolicy = retryPolicy
    }

    func send<Response: Decodable>(_ request: APIRequest<Response>) async throws -> Response {
        guard let url = URL(string: request.path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.invalidRequest
        }

        var urlRequest = URLRequest(url: url)
        if let timeoutInterval = request.timeoutInterval { urlRequest.timeoutInterval = timeoutInterval }
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }

        let operation: String
        switch request.path {
        case "/v1/auth/apple": operation = "auth-apple"
        case "/v1/auth/login": operation = "auth-login"
        case "/v1/auth/register": operation = "auth-register"
        case "/v1/me/photo/upload-url": operation = "photo-upload-url"
        case "/v1/me/photo/complete": operation = "photo-complete"
        case "/v1/me": operation = "profile"
        default: operation = "api"
        }
        var attempt = 1
        while true {
            do {
                let startedAt = Date()
                Self.logTransport("[AppleAuth] BACKEND_AUTH_REQUEST_START operation=\(operation) api_host=\(url.host ?? "unknown") attempt=\(attempt) method=\(request.method.rawValue)")
                let (data, response) = try await session.data(for: urlRequest)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                Self.logTransport("[AppleAuth] http_status=\(status) operation=\(operation) backend_request_ms=\(Self.elapsedMilliseconds(since: startedAt)) request_id=\((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-request-id") ?? "none")")
                if operation == "auth-apple", status >= 400,
                   let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data) {
                    Self.logTransport("[AppleAuth] backend_error_code=\(payload.code) http_status=\(status) request_id=\(payload.requestId ?? "none")")
                }
                let decoded: Response = try decode(data: data, response: response)
                return decoded
            } catch let error as APIError {
                if operation.hasPrefix("auth-") {
                    Self.logTransport("[AppleAuth] api_error operation=\(operation) category=\(error.diagnosticDescription)")
                }
                guard !Task.isCancelled,
                      retryPolicy.permitsRetry(method: request.method, error: error, attempt: attempt, allowsConnectionRetry: request.allowsConnectionRetry) else {
                    throw error
                }
            } catch let error as URLError {
                Self.logTransport("[AppleAuth] transport_error type=\(Self.transportCategory(error)) operation=\(operation) url_error=\(error.code.rawValue) domain=\((error as NSError).domain) code=\((error as NSError).code) \(Self.describeNetworkError(error))")
                let apiError = APIError.transport(error.code)
                guard !Task.isCancelled,
                      retryPolicy.permitsRetry(method: request.method, error: apiError, attempt: attempt, allowsConnectionRetry: request.allowsConnectionRetry) else {
                    throw apiError
                }
            } catch {
                throw APIError.transport(.unknown)
            }

            attempt += 1
            if retryPolicy.delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: retryPolicy.delayNanoseconds)
            }
        }
    }

    private static let transportLogger = Logger(subsystem: "ai.lauver.app", category: "Transport")

    private static func logTransport(_ message: String) {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-diagnose-network") {
            transportLogger.debug("LauverTransport \(message, privacy: .public)")
        }
        #else
        // Keep auth diagnostics available in TestFlight without logging
        // request bodies, Apple tokens, or bearer tokens.
        if message.contains("operation=auth-") {
            transportLogger.error("LauverTransport \(message, privacy: .public)")
        }
        #endif
    }

    private static func elapsedMilliseconds(since date: Date) -> Int {
        Int(Date().timeIntervalSince(date) * 1_000)
    }

    private static func transportCategory(_ error: URLError) -> String {
        switch error.code {
        case .timedOut: return "backend_timeout"
        case .notConnectedToInternet: return "network_unreachable"
        case .cannotFindHost, .dnsLookupFailed: return "dns_failure"
        case .cannotConnectToHost, .networkConnectionLost: return "connection_failure"
        case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid: return "tls_failure"
        case .cancelled: return "cancelled"
        default: return "transport_failure"
        }
    }

    /// Preserve the full URLSession/NSError failure chain in TestFlight device
    /// logs. It contains no request body, headers, tokens, or authorization
    /// code, so it is safe to emit for authentication diagnostics.
    private static func describeNetworkError(_ error: URLError) -> String {
        var descriptions: [String] = []
        var current: NSError? = error as NSError
        var depth = 0

        while let nsError = current, depth < 4 {
            let userInfo = nsError.userInfo
            let failureReason = userInfo[NSLocalizedFailureReasonErrorKey] as? String ?? "none"
            let recoverySuggestion = userInfo[NSLocalizedRecoverySuggestionErrorKey] as? String ?? "none"
            let debugDescription = userInfo[NSDebugDescriptionErrorKey] as? String ?? "none"
            descriptions.append(
                "depth=\(depth) domain=\(nsError.domain) code=\(nsError.code) "
                + "description=\(nsError.localizedDescription) "
                + "failureReason=\(failureReason) recoverySuggestion=\(recoverySuggestion) "
                + "debugDescription=\(debugDescription)"
            )
            current = userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }

        return descriptions.joined(separator: " | underlying: ")
    }

    func upload(data: Data, to url: URL, contentType: String, requiredHeaders: [String: String] = [:]) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        requiredHeaders.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        // The signed URL includes content-length; send the exact compressed byte count.
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        var attempt = 1
        while true {
            do {
                Self.logTransport("start method=PUT attempt=\(attempt) swiftCancelled=\(Task.isCancelled)")
                let (_, response) = try await session.upload(for: request, from: data)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.invalidResponse
                }
                Self.logTransport("response method=PUT status=\(httpResponse.statusCode)")
                guard (200...299).contains(httpResponse.statusCode) else {
                    throw APIError.server(
                        statusCode: httpResponse.statusCode,
                        requestID: httpResponse.value(forHTTPHeaderField: "x-request-id")
                    )
                }
                return
            } catch let error as APIError {
                throw error
            } catch let error as URLError {
                Self.logTransport("failure method=PUT attempt=\(attempt) swiftCancelled=\(Task.isCancelled) \(Self.describeNetworkError(error))")
                guard !Task.isCancelled,
                      retryPolicy.permitsIdempotentConnectionRetry(code: error.code, attempt: attempt) else {
                    throw APIError.transport(error.code)
                }
            } catch {
                throw APIError.transport(.unknown)
            }
            attempt += 1
            if retryPolicy.delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: retryPolicy.delayNanoseconds)
            }
        }
    }

    private func decode<Response: Decodable>(data: Data, response: URLResponse) throws -> Response {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        let requestID = httpResponse.value(forHTTPHeaderField: "x-request-id")
        switch httpResponse.statusCode {
        case 200...299:
            if Response.self == EmptyResponse.self {
                return EmptyResponse() as! Response
            }
            do {
                return try decoder.decode(Response.self, from: data)
            } catch {
                throw APIError.decoding
            }
        case 401:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.unauthorized(
                code: payload?.code ?? "unauthorized",
                message: payload?.message,
                requestID: payload?.requestId ?? requestID
            )
        case 422:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.validation(
                code: payload?.code ?? "validation_failed",
                message: payload?.message ?? "The request could not be validated.",
                requestID: payload?.requestId ?? requestID
            )
        case 404:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.notFound(
                code: payload?.code ?? "not_found",
                message: payload?.message ?? "The requested item was not found.",
                requestID: payload?.requestId ?? requestID
            )
        case 409:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.conflict(
                code: payload?.code ?? "conflict",
                message: payload?.message ?? "The request could not be completed.",
                requestID: payload?.requestId ?? requestID
            )
        case 429:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.rateLimited(
                message: payload?.message ?? "Too many requests. Try again later.",
                retryAfter: payload?.retryAfter ?? httpResponse.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init),
                requestID: payload?.requestId ?? requestID
            )
        case 500...599:
            throw APIError.server(statusCode: httpResponse.statusCode, requestID: requestID)
        default:
            throw APIError.server(statusCode: httpResponse.statusCode, requestID: requestID)
        }
    }
}

struct HealthResponse: Codable, Equatable {
    let status: String
    let service: String
}

protocol HealthServicing {
    func fetchHealth() async throws -> HealthResponse
}

struct HealthService: HealthServicing {
    let client: APIClient

    func fetchHealth() async throws -> HealthResponse {
        try await client.send(APIRequest(path: "/healthz"))
    }
}
