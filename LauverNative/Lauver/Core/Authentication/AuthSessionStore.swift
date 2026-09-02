import Foundation

struct SessionTokens: Equatable {
    let accessToken: String
    let refreshToken: String
}

protocol AuthSessionStoring {
    func read() throws -> SessionTokens?
    func save(_ session: AuthSession) throws
    func clear() throws
}

struct KeychainAuthSessionStore: AuthSessionStoring {
    private enum Accounts {
        static let accessToken = "auth.access-token"
        static let refreshToken = "auth.refresh-token"
    }

    let tokenStore: any SecureTokenStoring

    func read() throws -> SessionTokens? {
        let accessToken = try tokenStore.readToken(for: Accounts.accessToken)
        let refreshToken = try tokenStore.readToken(for: Accounts.refreshToken)
        guard let accessToken, let refreshToken else {
            try? clear()
            return nil
        }
        return SessionTokens(accessToken: accessToken, refreshToken: refreshToken)
    }

    func save(_ session: AuthSession) throws {
        do {
            try tokenStore.save(session.accessToken, for: Accounts.accessToken)
            try tokenStore.save(session.refreshToken, for: Accounts.refreshToken)
        } catch {
            try? clear()
            throw error
        }
    }

    func clear() throws {
        var firstError: Error?
        do {
            try tokenStore.deleteToken(for: Accounts.accessToken)
        } catch {
            firstError = error
        }
        do {
            try tokenStore.deleteToken(for: Accounts.refreshToken)
        } catch {
            firstError = firstError ?? error
        }
        if let firstError { throw firstError }
    }
}
