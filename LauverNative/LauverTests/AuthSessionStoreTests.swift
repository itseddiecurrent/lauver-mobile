import Foundation
import XCTest
@testable import Lauver

final class AuthSessionStoreTests: XCTestCase {
    func testSavesReadsAndClearsBothTokens() throws {
        let secureStore = MemorySecureTokenStore()
        let store = KeychainAuthSessionStore(tokenStore: secureStore)
        let session = AuthSession(
            user: AuthUser(id: "user-id", email: "runner@example.com"),
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresIn: 900
        )

        try store.save(session)
        XCTAssertEqual(
            try store.read(),
            SessionTokens(accessToken: "access-token", refreshToken: "refresh-token")
        )

        try store.clear()
        XCTAssertNil(try store.read())
        XCTAssertTrue(secureStore.values.isEmpty)
    }

    func testMissingOneTokenDeletesTheIncompleteSession() throws {
        let secureStore = MemorySecureTokenStore(values: ["auth.access-token": "orphaned-access"])
        let store = KeychainAuthSessionStore(tokenStore: secureStore)

        XCTAssertNil(try store.read())
        XCTAssertTrue(secureStore.values.isEmpty)
    }

    func testPartialSaveFailureRollsBackEveryToken() {
        let secureStore = MemorySecureTokenStore(failingAccount: "auth.refresh-token")
        let store = KeychainAuthSessionStore(tokenStore: secureStore)
        let session = AuthSession(
            user: AuthUser(id: "user-id", email: "runner@example.com"),
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresIn: 900
        )

        XCTAssertThrowsError(try store.save(session))
        XCTAssertTrue(secureStore.values.isEmpty)
    }

    func testAppleUserIdentifierUsesTheDedicatedSecureAccountAndCanBeCleared() throws {
        let secureStore = MemorySecureTokenStore()
        let store = KeychainAppleUserIdentifierStore(tokenStore: secureStore)

        try store.save("apple-local-user-id")
        XCTAssertEqual(try store.read(), "apple-local-user-id")
        XCTAssertEqual(secureStore.values, ["auth.apple-user-id": "apple-local-user-id"])

        try store.clear()
        XCTAssertNil(try store.read())
    }
}

private final class MemorySecureTokenStore: SecureTokenStoring {
    var values: [String: String]
    let failingAccount: String?

    init(values: [String: String] = [:], failingAccount: String? = nil) {
        self.values = values
        self.failingAccount = failingAccount
    }

    func save(_ token: String, for account: String) throws {
        if account == failingAccount { throw KeychainError.invalidData }
        values[account] = token
    }

    func readToken(for account: String) throws -> String? {
        values[account]
    }

    func deleteToken(for account: String) throws {
        values.removeValue(forKey: account)
    }
}
