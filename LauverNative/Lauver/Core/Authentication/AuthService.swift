import Foundation
import AuthenticationServices
import CryptoKit
import UIKit
import os

private let appleAuthLogger = Logger(subsystem: "ai.lauver.app", category: "Authentication")

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

private struct AppleSignInPayload: Encodable {
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let email: String?
    let givenName: String?
    let familyName: String?
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
    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession
    func signInWithGoogle() async throws -> AuthSession
    func refresh(refreshToken: String) async throws -> AuthSession
    func logout(refreshToken: String) async throws
    func forgotPassword(email: String) async throws
    func resetPassword(token: String, password: String) async throws
    func restore(accessToken: String) async throws -> AuthUser
}

struct AuthService: AuthServicing {
    let client: APIClient
    private let googleAuthenticator: GoogleFirebaseAuthenticator?
    private let encoder = JSONEncoder()

    init(
        client: APIClient,
        firebaseAPIKey: String? = nil,
        googleIOSClientID: String? = nil,
        googleReversedClientID: String? = nil
    ) {
        self.client = client
        if let firebaseAPIKey, !firebaseAPIKey.isEmpty,
           let googleIOSClientID, !googleIOSClientID.isEmpty,
           let googleReversedClientID, !googleReversedClientID.isEmpty {
            self.googleAuthenticator = GoogleFirebaseAuthenticator(
                firebaseAPIKey: firebaseAPIKey,
                googleClientID: googleIOSClientID,
                reversedClientID: googleReversedClientID
            )
        } else {
            self.googleAuthenticator = nil
        }
    }

    func register(email: String, password: String) async throws -> AuthSession {
        return try await sendSession(
            path: "/v1/auth/register",
            payload: EmailPasswordPayload(email: email, password: password)
        )
    }

    func login(email: String, password: String) async throws -> AuthSession {
        return try await sendSession(
            path: "/v1/auth/login",
            payload: EmailPasswordPayload(email: email, password: password)
        )
    }

    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession {
        let startedAt = Date()
        appleAuthLogger.info("[AppleAuth] BACKEND_AUTH_REQUEST_START")
        defer {
            let elapsed = Int(Date().timeIntervalSince(startedAt) * 1_000)
            appleAuthLogger.info("[AppleAuth] BACKEND_AUTH_REQUEST_COMPLETE backend_request_ms=\(elapsed)")
        }
        return try await sendSession(
            path: "/v1/auth/apple",
            payload: AppleSignInPayload(
                identityToken: credential.identityToken,
                authorizationCode: credential.authorizationCode,
                nonce: credential.nonce,
                email: credential.email,
                givenName: credential.givenName,
                familyName: credential.familyName
            ),
            timeoutInterval: 8
        )
    }

    func signInWithGoogle() async throws -> AuthSession {
        guard let googleAuthenticator else {
            throw APIError.invalidRequest
        }
        let firebaseIDToken = try await googleAuthenticator.signIn()
        return try await sendSession(
            path: "/v1/auth/google",
            payload: GoogleSignInPayload(idToken: firebaseIDToken)
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
        payload: Payload,
        timeoutInterval: TimeInterval? = nil
    ) async throws -> AuthSession {
        try await client.send(makeRequest(path: path, payload: payload, timeoutInterval: timeoutInterval))
    }

    private func makeRequest<Response: Decodable, Payload: Encodable>(
        path: String,
        payload: Payload,
        timeoutInterval: TimeInterval? = nil
    ) throws -> APIRequest<Response> {
        APIRequest(
            method: .post,
            path: path,
            body: try encoder.encode(payload),
            headers: ["Content-Type": "application/json"],
            timeoutInterval: timeoutInterval
        )
    }
}

private struct GoogleSignInPayload: Encodable {
    let idToken: String
}

private struct GoogleTokenResponse: Decodable {
    let accessToken: String
    let idToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case idToken = "id_token"
    }
}

private struct FirebaseIdentityResponse: Decodable {
    let idToken: String

    enum CodingKeys: String, CodingKey {
        case idToken = "idToken"
    }
}

/// Native Google sign-in without putting a Google client secret in the app.
/// Google returns an authorization code through ASWebAuthenticationSession;
/// Firebase Identity Toolkit then exchanges Google's token for a Firebase ID
/// token, which is verified by Lauver's existing backend route.
private final class GoogleFirebaseAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let firebaseAPIKey: String
    private let googleClientID: String
    private let reversedClientID: String
    private let session = URLSession(configuration: .ephemeral)
    private var browserSession: ASWebAuthenticationSession?

    init(firebaseAPIKey: String, googleClientID: String, reversedClientID: String) {
        self.firebaseAPIKey = firebaseAPIKey
        self.googleClientID = googleClientID
        self.reversedClientID = reversedClientID
    }

    func signIn() async throws -> String {
        let verifier = Self.randomURLSafeString(length: 64)
        let state = Self.randomURLSafeString(length: 32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let redirectURI = "\(reversedClientID):/oauthredirect"

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: googleClientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "access_type", value: "offline"),
        ]
        guard let authorizationURL = components.url else { throw APIError.invalidRequest }

        let callback = try await openBrowser(url: authorizationURL, callbackScheme: reversedClientID)
        let callbackValues = callback.queryItemValues
        if let providerError = callbackValues["error"] {
            let description = callbackValues["error_description"] ?? providerError
            throw APIError.validation(
                code: "google_authorization_failed",
                message: description,
                requestID: nil
            )
        }
        guard callbackValues["state"] == state,
              let code = callbackValues["code"] else {
            throw APIError.invalidRequest
        }

        let googleTokens = try await exchangeCode(
            code: code,
            verifier: verifier,
            redirectURI: redirectURI
        )
        return try await exchangeWithFirebase(googleTokens: googleTokens, redirectURI: redirectURI)
    }

    private func openBrowser(url: URL, callbackScheme: String) async throws -> URLComponents {
        try await withCheckedThrowingContinuation { continuation in
            let webSession = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                self?.browserSession = nil
                if let error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: APIError.invalidRequest)
                    } else {
                        continuation.resume(throwing: APIError.transport(.unknown))
                    }
                    return
                }
                guard let callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    continuation.resume(throwing: APIError.invalidResponse)
                    return
                }
                continuation.resume(returning: components)
            }
            webSession.presentationContextProvider = self
            // Reuse the user's existing Google/Safari session when available.
            // This avoids a full account-selection/login page on every attempt.
            webSession.prefersEphemeralWebBrowserSession = false
            browserSession = webSession
            guard webSession.start() else {
                browserSession = nil
                continuation.resume(throwing: APIError.invalidRequest)
                return
            }
        }
    }

    private func exchangeCode(code: String, verifier: String, redirectURI: String) async throws -> GoogleTokenResponse {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncodedData([
            "client_id": googleClientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirectURI,
        ])
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw APIError.validation(
                code: "google_token_exchange_failed",
                message: Self.externalErrorMessage(from: data),
                requestID: nil
            )
        }
        return try JSONDecoder().decode(GoogleTokenResponse.self, from: data)
    }

    private func exchangeWithFirebase(googleTokens: GoogleTokenResponse, redirectURI: String) async throws -> String {
        var components = URLComponents(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp")!
        components.queryItems = [URLQueryItem(name: "key", value: firebaseAPIKey)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let postBody = formEncodedString([
            "access_token": googleTokens.accessToken,
            "id_token": googleTokens.idToken,
            "providerId": "google.com",
        ])
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "postBody": postBody,
            // Identity Toolkit only uses this as the originating request URI;
            // the native Google callback has already completed. The REST API
            // documents http://localhost for native/non-web OAuth exchanges.
            "requestUri": "http://localhost",
            "returnIdpCredential": true,
            "returnSecureToken": true,
        ])
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw APIError.validation(
                code: "firebase_google_exchange_failed",
                message: Self.externalErrorMessage(from: data),
                requestID: nil
            )
        }
        return try JSONDecoder().decode(FirebaseIdentityResponse.self, from: data).idToken
    }

    private static func externalErrorMessage(from data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = object["error"] as? [String: Any],
           let message = error["message"] as? String {
            return message
        }
        return "Google authentication was rejected by the provider."
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first(where: \.isKeyWindow) }
            .first ?? UIWindow()
    }

    private static func randomURLSafeString(length: Int) -> String {
        base64URL(Data((0..<length).map { _ in UInt8.random(in: 0...255) })).prefix(length).description
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func formEncodedData(_ values: [String: String]) -> Data {
        formEncodedString(values).data(using: .utf8)!
    }

    private func formEncodedString(_ values: [String: String]) -> String {
        values.map { key, value in
            "\(Self.percentEncode(key))=\(Self.percentEncode(value))"
        }.sorted().joined(separator: "&")
    }

    private static func percentEncode(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

private extension URLComponents {
    var queryItemValues: [String: String] {
        Dictionary(uniqueKeysWithValues: (queryItems ?? []).compactMap { item in
            guard let value = item.value else { return nil }
            return (item.name, value)
        })
    }
}
