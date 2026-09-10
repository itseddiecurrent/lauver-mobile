import AuthenticationServices
import CryptoKit
import Foundation
import Security

struct AppleSignInCredential: Equatable {
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let userIdentifier: String
    let email: String?
    let givenName: String?
    let familyName: String?

    init(authorization: ASAuthorization, nonce: String) throws {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8),
              let authorizationCodeData = credential.authorizationCode,
              let authorizationCode = String(data: authorizationCodeData, encoding: .utf8),
              !nonce.isEmpty else {
            throw AppleSignInError.invalidCredential
        }
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.nonce = nonce
        userIdentifier = credential.user
        email = credential.email
        givenName = credential.fullName?.givenName
        familyName = credential.fullName?.familyName
    }

    init(
        identityToken: String,
        authorizationCode: String,
        nonce: String,
        userIdentifier: String,
        email: String?,
        givenName: String?,
        familyName: String?
    ) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.nonce = nonce
        self.userIdentifier = userIdentifier
        self.email = email
        self.givenName = givenName
        self.familyName = familyName
    }
}

enum AppleSignInError: LocalizedError {
    case invalidCredential
    case nonceGenerationFailed

    var errorDescription: String? {
        switch self {
        case .invalidCredential:
            return "Apple did not return a complete sign-in credential."
        case .nonceGenerationFailed:
            return "A secure Apple sign-in request could not be created."
        }
    }
}

enum AppleSignInNonce {
    static func generate() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw AppleSignInError.nonceGenerationFailed
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func hash(_ rawNonce: String) -> String {
        SHA256.hash(data: Data(rawNonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

enum AppleCredentialState: Equatable {
    case authorized
    case revoked
    case notFound
    case transferred
    case unknown
}

protocol AppleCredentialStateChecking {
    func state(for userIdentifier: String) async throws -> AppleCredentialState
}

struct AppleCredentialStateChecker: AppleCredentialStateChecking {
    func state(for userIdentifier: String) async throws -> AppleCredentialState {
        let state = try await ASAuthorizationAppleIDProvider().credentialState(forUserID: userIdentifier)
        switch state {
        case .authorized: return .authorized
        case .revoked: return .revoked
        case .notFound: return .notFound
        case .transferred: return .transferred
        @unknown default: return .unknown
        }
    }
}
