import Foundation

struct AuthUser: Codable, Equatable {
    let id: String
    let email: String
}

struct AuthSession: Codable, Equatable {
    let user: AuthUser
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

private struct EmailPasswordPayload: Encodable {
    let email: String
    let password: String
}

private struct RefreshTokenPayload: Encodable {
    let refreshToken: String
}

private struct ForgotPasswordPayload: Encodable {
    let email: String
}

private struct ResetPasswordPayload: Encodable {
    let token: String
    let password: String
}

private struct AuthSessionEnvelope: Decodable {
    let user: AuthUser
}

private struct MessageResponse: Decodable {
    let message: String
}

protocol AuthServicing {
    func register(email: String, password: String) async throws -> AuthSession
    func login(email: String, password: String) async throws -> AuthSession
    func refresh(refreshToken: String) async throws -> AuthSession
    func logout(refreshToken: String) async throws
    func forgotPassword(email: String) async throws
    func resetPassword(token: String, password: String) async throws
    func restore(accessToken: String) async throws -> AuthUser
}

struct AuthService: AuthServicing {
    let client: APIClient
    private let encoder = JSONEncoder()

    func register(email: String, password: String) async throws -> AuthSession {
        try await sendSession(
            path: "/v1/auth/register",
            payload: EmailPasswordPayload(email: email, password: password)
        )
    }

    func login(email: String, password: String) async throws -> AuthSession {
        try await sendSession(
            path: "/v1/auth/login",
            payload: EmailPasswordPayload(email: email, password: password)
        )
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        try await sendSession(
            path: "/v1/auth/refresh",
            payload: RefreshTokenPayload(refreshToken: refreshToken)
        )
    }

    func logout(refreshToken: String) async throws {
        let request: APIRequest<EmptyResponse> = try makeRequest(
            path: "/v1/auth/logout",
            payload: RefreshTokenPayload(refreshToken: refreshToken)
        )
        _ = try await client.send(request)
    }

    func forgotPassword(email: String) async throws {
        let request: APIRequest<MessageResponse> = try makeRequest(
            path: "/v1/auth/password/forgot",
            payload: ForgotPasswordPayload(email: email)
        )
        _ = try await client.send(request)
    }

    func resetPassword(token: String, password: String) async throws {
        let request: APIRequest<MessageResponse> = try makeRequest(
            path: "/v1/auth/password/reset",
            payload: ResetPasswordPayload(token: token, password: password)
        )
        _ = try await client.send(request)
    }

    func restore(accessToken: String) async throws -> AuthUser {
        let response: AuthSessionEnvelope = try await client.send(APIRequest(
            path: "/v1/auth/session",
            headers: ["Authorization": "Bearer \(accessToken)"]
        ))
        return response.user
    }

    private func sendSession<Payload: Encodable>(
        path: String,
        payload: Payload
    ) async throws -> AuthSession {
        try await client.send(makeRequest(path: path, payload: payload))
    }

    private func makeRequest<Response: Decodable, Payload: Encodable>(
        path: String,
        payload: Payload
    ) throws -> APIRequest<Response> {
        APIRequest(
            method: .post,
            path: path,
            body: try encoder.encode(payload),
            headers: ["Content-Type": "application/json"]
        )
    }
}
