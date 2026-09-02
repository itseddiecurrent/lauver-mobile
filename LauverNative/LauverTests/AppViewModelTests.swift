import Foundation
import XCTest
@testable import Lauver

@MainActor
final class AppViewModelTests: XCTestCase {
    func testHealthSuccessShowsOnlineAndRestoresNonSensitiveTabState() async {
        let uiStateStore = TestUIStateStore(selectedTab: .messages)
        let viewModel = makeViewModel(
            healthResult: .success(HealthResponse(status: "ok", service: "lauver-api")),
            uiStateStore: uiStateStore
        )

        XCTAssertEqual(viewModel.selectedTab, .messages)
        await viewModel.checkHealth()
        XCTAssertEqual(viewModel.serviceStatus, .online)
    }

    func testHealthFailurePreservesPublicRequestIDForSupport() async {
        let viewModel = makeViewModel(
            healthResult: .failure(.server(statusCode: 503, requestID: "request-support"))
        )

        await viewModel.checkHealth()

        XCTAssertEqual(
            viewModel.serviceStatus,
            .offline(message: "The service is temporarily unavailable.", requestID: "request-support")
        )
    }

    func testAuthenticationShellAndSignOutFlow() async {
        let uiStateStore = TestUIStateStore(selectedTab: .events)
        let viewModel = makeViewModel(uiStateStore: uiStateStore)

        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        viewModel.enterAppShell()
        XCTAssertEqual(viewModel.authenticationState, .authenticated)

        viewModel.selectedTab = .profile
        XCTAssertEqual(uiStateStore.selectedTab, .profile)

        await viewModel.signOut()
        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        XCTAssertEqual(viewModel.selectedTab, .discover)
    }

    func testRegisterSavesTokensAndAuthenticates() async {
        let authService = TestAuthService()
        let sessionStore = TestAuthSessionStore()
        let viewModel = makeViewModel(authService: authService, authSessionStore: sessionStore)

        await viewModel.register(email: "runner@example.com", password: "CorrectHorse9")

        XCTAssertEqual(viewModel.authenticationState, .authenticated)
        XCTAssertEqual(sessionStore.savedSession, TestAuthService.session)
        XCTAssertEqual(viewModel.authenticatedEmail, "runner@example.com")
    }

    func testSessionRestoreRotatesRefreshTokenAfterUnauthorizedAccessToken() async {
        let authService = TestAuthService()
        authService.restoreResult = .failure(.unauthorized(
            code: "invalid_session",
            message: nil,
            requestID: "expired"
        ))
        let sessionStore = TestAuthSessionStore(tokens: SessionTokens(
            accessToken: "expired-access",
            refreshToken: "valid-refresh"
        ))
        let viewModel = makeViewModel(authService: authService, authSessionStore: sessionStore)

        await viewModel.restoreSession()

        XCTAssertEqual(viewModel.authenticationState, .authenticated)
        XCTAssertEqual(authService.refreshedToken, "valid-refresh")
        XCTAssertEqual(sessionStore.savedSession, TestAuthService.session)
    }

    func testDeletedKeychainTokensReturnToLoginWithoutNetworkAuth() async {
        let authService = TestAuthService()
        let sessionStore = TestAuthSessionStore(tokens: nil)
        let viewModel = makeViewModel(authService: authService, authSessionStore: sessionStore)

        await viewModel.restoreSession()

        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        XCTAssertFalse(authService.restoreCalled)
    }

    func testInvalidRefreshTokenClearsSavedSessionAndReturnsToLogin() async {
        let authService = TestAuthService()
        authService.restoreResult = .failure(.unauthorized(
            code: "invalid_session",
            message: nil,
            requestID: "expired-access"
        ))
        authService.refreshResult = .failure(.unauthorized(
            code: "invalid_session",
            message: "The session is invalid or expired",
            requestID: "invalid-refresh"
        ))
        let sessionStore = TestAuthSessionStore(tokens: SessionTokens(
            accessToken: "expired-access",
            refreshToken: "invalid-refresh"
        ))
        let viewModel = makeViewModel(authService: authService, authSessionStore: sessionStore)

        await viewModel.restoreSession()

        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        XCTAssertNil(sessionStore.tokens)
        XCTAssertTrue(sessionStore.clearCalled)
        XCTAssertEqual(viewModel.authMessage, "The session is invalid or expired")
    }

    private func makeViewModel(
        healthResult: Result<HealthResponse, APIError> = .success(HealthResponse(status: "ok", service: "lauver-api")),
        authService: TestAuthService = TestAuthService(),
        authSessionStore: TestAuthSessionStore = TestAuthSessionStore(),
        uiStateStore: TestUIStateStore = TestUIStateStore()
    ) -> AppViewModel {
        AppViewModel(
            configuration: AppConfiguration(
                environment: .staging,
                apiBaseURL: URL(string: "https://lauver-api-staging.onrender.com")!
            ),
            healthService: StubHealthService(result: healthResult),
            authService: authService,
            authSessionStore: authSessionStore,
            uiStateStore: uiStateStore,
            startsAuthenticated: false
        )
    }
}

private final class TestAuthService: AuthServicing {
    static let session = AuthSession(
        user: AuthUser(id: "user-id", email: "runner@example.com"),
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 900
    )

    var restoreResult: Result<AuthUser, APIError> = .success(session.user)
    var refreshResult: Result<AuthSession, APIError> = .success(session)
    var restoreCalled = false
    var refreshedToken: String?

    func register(email: String, password: String) async throws -> AuthSession { Self.session }
    func login(email: String, password: String) async throws -> AuthSession { Self.session }

    func refresh(refreshToken: String) async throws -> AuthSession {
        refreshedToken = refreshToken
        return try refreshResult.get()
    }

    func logout(refreshToken: String) async throws {}
    func forgotPassword(email: String) async throws {}
    func resetPassword(token: String, password: String) async throws {}

    func restore(accessToken: String) async throws -> AuthUser {
        restoreCalled = true
        return try restoreResult.get()
    }
}

private final class TestAuthSessionStore: AuthSessionStoring {
    var tokens: SessionTokens?
    var savedSession: AuthSession?
    var clearCalled = false

    init(tokens: SessionTokens? = nil) {
        self.tokens = tokens
    }

    func read() throws -> SessionTokens? { tokens }

    func save(_ session: AuthSession) throws {
        savedSession = session
        tokens = SessionTokens(accessToken: session.accessToken, refreshToken: session.refreshToken)
    }

    func clear() throws {
        clearCalled = true
        tokens = nil
    }
}

private struct StubHealthService: HealthServicing {
    let result: Result<HealthResponse, APIError>

    func fetchHealth() async throws -> HealthResponse {
        try result.get()
    }
}

private final class TestUIStateStore: UIStateStoring {
    var selectedTab: AppTab

    init(selectedTab: AppTab = .discover) {
        self.selectedTab = selectedTab
    }

    func reset() {
        selectedTab = .discover
    }
}
