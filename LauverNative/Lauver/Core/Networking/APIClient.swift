import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
}

struct APIRequest<Response: Decodable> {
    let method: HTTPMethod
    let path: String
    let body: Data?
    let headers: [String: String]

    init(
        method: HTTPMethod = .get,
        path: String,
        body: Data? = nil,
        headers: [String: String] = [:]
    ) {
        self.method = method
        self.path = path
        self.body = body
        self.headers = headers
    }
}

struct APIErrorPayload: Codable, Equatable {
    let code: String
    let message: String
    let requestId: String?
}

enum APIError: Error, Equatable {
    case invalidRequest
    case invalidResponse
    case unauthorized(requestID: String?)
    case validation(code: String, message: String, requestID: String?)
    case server(statusCode: Int, requestID: String?)
    case transport(URLError.Code)
    case decoding

    var requestID: String? {
        switch self {
        case let .unauthorized(requestID),
             let .validation(_, _, requestID),
             let .server(_, requestID):
            requestID
        case .invalidRequest, .invalidResponse, .transport, .decoding:
            nil
        }
    }

    var userMessage: String {
        switch self {
        case .unauthorized:
            "Your session is no longer valid."
        case let .validation(_, message, _):
            message
        case .server:
            "The service is temporarily unavailable."
        case .transport(.notConnectedToInternet):
            "You appear to be offline."
        case .transport(.timedOut):
            "The request timed out."
        case .transport:
            "The network request failed."
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

    func permitsRetry(method: HTTPMethod, error: APIError, attempt: Int) -> Bool {
        guard method == .get, attempt < maxAttempts else { return false }

        switch error {
        case let .server(statusCode, _):
            return (500...599).contains(statusCode)
        case let .transport(code):
            return [.timedOut, .networkConnectionLost, .notConnectedToInternet].contains(code)
        case .invalidRequest, .invalidResponse, .unauthorized, .validation, .decoding:
            return false
        }
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

        var attempt = 1
        while true {
            do {
                let (data, response) = try await session.data(for: urlRequest)
                let decoded: Response = try decode(data: data, response: response)
                return decoded
            } catch let error as APIError {
                guard retryPolicy.permitsRetry(method: request.method, error: error, attempt: attempt) else {
                    throw error
                }
            } catch let error as URLError {
                let apiError = APIError.transport(error.code)
                guard retryPolicy.permitsRetry(method: request.method, error: apiError, attempt: attempt) else {
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

    private func decode<Response: Decodable>(data: Data, response: URLResponse) throws -> Response {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        let requestID = httpResponse.value(forHTTPHeaderField: "x-request-id")
        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(Response.self, from: data)
            } catch {
                throw APIError.decoding
            }
        case 401:
            throw APIError.unauthorized(requestID: requestID)
        case 422:
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.validation(
                code: payload?.code ?? "validation_failed",
                message: payload?.message ?? "The request could not be validated.",
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
