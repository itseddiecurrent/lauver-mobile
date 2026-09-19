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
    // Opt in only when repeating the same body after a lost response is safe.
    let allowsConnectionRetry: Bool

    init(
        method: HTTPMethod = .get,
        path: String,
        body: Data? = nil,
        headers: [String: String] = [:],
        allowsConnectionRetry: Bool = false
    ) {
        self.method = method
        self.path = path
        self.body = body
        self.headers = headers
        self.allowsConnectionRetry = allowsConnectionRetry
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
            "The request timed out. Check your connection and try again."
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
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }

        let operation: String
        switch request.path {
        case "/v1/me/photo/upload-url": operation = "photo-upload-url"
        case "/v1/me/photo/complete": operation = "photo-complete"
        case "/v1/me": operation = "profile"
        default: operation = "api"
        }
        var attempt = 1
        while true {
            do {
                Self.logTransport("start operation=\(operation) attempt=\(attempt) method=\(request.method.rawValue) swiftCancelled=\(Task.isCancelled)")
                let (data, response) = try await session.data(for: urlRequest)
                Self.logTransport("response operation=\(operation) method=\(request.method.rawValue) status=\((response as? HTTPURLResponse)?.statusCode ?? 0)")
                let decoded: Response = try decode(data: data, response: response)
                return decoded
            } catch let error as APIError {
                guard !Task.isCancelled,
                      retryPolicy.permitsRetry(method: request.method, error: error, attempt: attempt, allowsConnectionRetry: request.allowsConnectionRetry) else {
                    throw error
                }
            } catch let error as URLError {
                let underlying = (error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError
                Self.logTransport("failure operation=\(operation) attempt=\(attempt) method=\(request.method.rawValue) code=\(error.code.rawValue) swiftCancelled=\(Task.isCancelled) underlyingDomain=\(underlying?.domain ?? "none") underlyingCode=\(underlying?.code ?? 0)")
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
        #endif
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
                let underlying = (error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError
                Self.logTransport("failure method=PUT attempt=\(attempt) code=\(error.code.rawValue) swiftCancelled=\(Task.isCancelled) underlyingDomain=\(underlying?.domain ?? "none") underlyingCode=\(underlying?.code ?? 0)")
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
