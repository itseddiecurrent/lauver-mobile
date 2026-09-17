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

    func testRuntimeSessionExpiryReturnsToLoginAndClearsAccountState() async {
        let sessionStore = TestAuthSessionStore()
        let appleStore = TestAppleUserIdentifierStore(userIdentifier: "old-apple-user")
        let model = makeViewModel(authSessionStore: sessionStore, appleUserIdentifierStore: appleStore)
        await model.login(email: "runner@example.com", password: "CorrectHorse9")
        model.selectedTab = .profile
        model.handleSessionExpired()
        XCTAssertEqual(model.authenticationState, .signedOut)
        XCTAssertNil(model.authenticatedEmail)
        XCTAssertNil(sessionStore.tokens)
        XCTAssertNil(appleStore.userIdentifier)
        XCTAssertEqual(model.selectedTab, .discover)
        XCTAssertTrue(model.authMessage?.contains("sign in again") == true)
    }

    func testLoginTimeoutStopsSubmittingAndAllowsSuccessfulRetry() async {
        let authService = TestAuthService()
        authService.loginResult = .failure(.transport(.timedOut))
        let sessionStore = TestAuthSessionStore()
        let model = makeViewModel(authService: authService, authSessionStore: sessionStore)

        await model.login(email: "runner@example.com", password: "CorrectHorse9")

        XCTAssertFalse(model.isAuthSubmitting)
        XCTAssertEqual(model.authenticationState, .signedOut)
        XCTAssertNil(sessionStore.tokens)
        XCTAssertEqual(model.authMessage, APIError.transport(.timedOut).userMessage)

        authService.loginResult = .success(TestAuthService.session)
        await model.login(email: "runner@example.com", password: "CorrectHorse9")

        XCTAssertFalse(model.isAuthSubmitting)
        XCTAssertEqual(model.authenticationState, .authenticated)
        XCTAssertEqual(sessionStore.savedSession, TestAuthService.session)
        XCTAssertNil(model.authMessage)
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

    func testAppleSignInSavesOnlyTheLocalCredentialIdentifierAfterBackendSuccess() async {
        let authService = TestAuthService()
        let sessionStore = TestAuthSessionStore()
        let appleStore = TestAppleUserIdentifierStore()
        let viewModel = makeViewModel(
            authService: authService,
            authSessionStore: sessionStore,
            appleUserIdentifierStore: appleStore
        )
        let credential = AppleSignInCredential(
            identityToken: "signed-identity-token",
            authorizationCode: "single-use-code",
            nonce: "raw-nonce-with-at-least-thirty-two-characters",
            userIdentifier: "local-apple-user-id",
            email: "runner@privaterelay.appleid.com",
            givenName: "Alex",
            familyName: "Runner"
        )

        await viewModel.signInWithApple(credential: credential)

        XCTAssertEqual(authService.appleCredential, credential)
        XCTAssertEqual(appleStore.userIdentifier, "local-apple-user-id")
        XCTAssertEqual(viewModel.authenticationState, .authenticated)
    }

    func testRevokedAppleCredentialClearsSessionBeforeCallingBackendRestore() async {
        let authService = TestAuthService()
        let sessionStore = TestAuthSessionStore(tokens: SessionTokens(
            accessToken: "saved-access",
            refreshToken: "saved-refresh"
        ))
        let appleStore = TestAppleUserIdentifierStore(userIdentifier: "revoked-apple-user")
        let viewModel = makeViewModel(
            authService: authService,
            authSessionStore: sessionStore,
            appleUserIdentifierStore: appleStore,
            appleCredentialStateChecker: TestAppleCredentialStateChecker(state: .revoked)
        )

        await viewModel.restoreSession()

        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        XCTAssertTrue(sessionStore.clearCalled)
        XCTAssertNil(appleStore.userIdentifier)
        XCTAssertFalse(authService.restoreCalled)
    }

    private func makeViewModel(
        healthResult: Result<HealthResponse, APIError> = .success(HealthResponse(status: "ok", service: "lauver-api")),
        authService: TestAuthService = TestAuthService(),
        authSessionStore: TestAuthSessionStore = TestAuthSessionStore(),
        appleUserIdentifierStore: TestAppleUserIdentifierStore = TestAppleUserIdentifierStore(),
        appleCredentialStateChecker: TestAppleCredentialStateChecker = TestAppleCredentialStateChecker(),
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
            appleUserIdentifierStore: appleUserIdentifierStore,
            appleCredentialStateChecker: appleCredentialStateChecker,
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
    var appleCredential: AppleSignInCredential?

    func register(email: String, password: String) async throws -> AuthSession { Self.session }
    var loginResult: Result<AuthSession, APIError> = .success(TestAuthService.session)
    func login(email: String, password: String) async throws -> AuthSession { try loginResult.get() }
    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession {
        appleCredential = credential
        return Self.session
    }

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

private final class TestAppleUserIdentifierStore: AppleUserIdentifierStoring {
    var userIdentifier: String?

    init(userIdentifier: String? = nil) {
        self.userIdentifier = userIdentifier
    }

    func read() throws -> String? { userIdentifier }
    func save(_ userIdentifier: String) throws { self.userIdentifier = userIdentifier }
    func clear() throws { userIdentifier = nil }
}

private struct TestAppleCredentialStateChecker: AppleCredentialStateChecking {
    var state: AppleCredentialState = .authorized

    func state(for userIdentifier: String) async throws -> AppleCredentialState {
        state
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

@MainActor
final class EventsPaginationTests: XCTestCase {
    func testCreatedEventBeyondFirstPageSurvivesRefreshAndPaginationWithoutDuplicates() async {
        let service = EventPagingStub()
        let model = EventsViewModel(service: service)
        await model.load()
        XCTAssertEqual(model.events.count, 20)
        let created = service.makeEvent(21)
        model.insert(created)
        await model.load()
        XCTAssertTrue(model.events.contains { $0.id == created.id })
        XCTAssertNotNil(model.nextCursor)
        await model.load(refresh: false)
        XCTAssertEqual(model.events.count, 21)
        XCTAssertEqual(Set(model.events.map(\.id)).count, 21)
        XCTAssertNil(model.nextCursor)
        service.cancelled = true
        model.replace(service.makeEvent(21, status: "cancelled"))
        await model.load()
        await model.load(refresh: false)
        XCTAssertFalse(model.events.contains { $0.id == created.id })
    }

    func testFailedNextPageKeepsRowsAndCursorForRetry() async {
        let service = EventPagingStub()
        let model = EventsViewModel(service: service)
        await model.load()
        service.failNextPage = true
        await model.load(refresh: false)
        XCTAssertEqual(model.events.count, 20)
        XCTAssertEqual(model.nextCursor, "page-two")
        XCTAssertNotNil(model.error)
        service.failNextPage = false
        await model.load(refresh: false)
        XCTAssertEqual(model.events.count, 21)
        XCTAssertNil(model.error)
    }

    func testServerCancellationReplacesLocallySavedEventOnRefresh() async {
        let service = EventPagingStub()
        let model = EventsViewModel(service: service)
        model.insert(service.makeEvent(21))
        service.cancelled = true
        await model.load()
        XCTAssertFalse(model.events.contains { $0.id == "event-21" })
    }

    func testMutationDuringOlderListRequestSurvivesResponse() async {
        let service = EventPagingStub()
        let model = EventsViewModel(service: service)
        service.beforePage = { model.insert(service.makeEvent(1, status: "cancelled")) }
        await model.load()
        XCTAssertFalse(model.events.contains { $0.id == "event-1" })
    }
}

private final class EventPagingStub: EventsServicing {
    var failNextPage = false
    var cancelled = false
    var beforePage: (@MainActor () -> Void)?
    func makeEvent(_ n: Int, status: String = "upcoming") -> PublicEvent {
        PublicEvent(id: "event-\(n)", title: "Event \(n)", description: nil,
                    sport: "running", startsAt: String(format: "2030-10-%02dT10:00:00Z", n),
                    endsAt: String(format: "2030-10-%02dT11:00:00Z", n), capacity: 10,
                    attendeeCount: 1, venue: EventVenue(name: "Park", address: nil, latitude: 31, longitude: 121),
                    status: status, creator: EventCreator(id: "owner", displayName: "Owner"),
                    isAttendee: true, isCreator: true)
    }
    func events(sport: String?, city: String?, cursor: String?) async throws -> EventPage {
        await beforePage?()
        if cursor != nil {
            if failNextPage { throw URLError(.notConnectedToInternet) }
            return EventPage(events: [makeEvent(20)] + (cancelled ? [] : [makeEvent(21)]), nextCursor: nil)
        }
        return EventPage(events: (1...20).map { makeEvent($0) }, nextCursor: "page-two")
    }
    func event(id: String) async throws -> PublicEvent { makeEvent(21, status: cancelled ? "cancelled" : "upcoming") }
    func joinEvent(id: String) async throws -> PublicEvent { throw URLError(.unsupportedURL) }
    func leaveEvent(id: String) async throws -> PublicEvent { throw URLError(.unsupportedURL) }
    func createEvent(_ draft: EventDraft) async throws -> PublicEvent { throw URLError(.unsupportedURL) }
    func updateEvent(id: String, draft: EventDraft) async throws -> PublicEvent { throw URLError(.unsupportedURL) }
    func cancelEvent(id: String) async throws -> PublicEvent { throw URLError(.unsupportedURL) }
    func reportEvent(id: String, reason: String, details: String?, targetType: String) async throws -> String { throw URLError(.unsupportedURL) }
}
