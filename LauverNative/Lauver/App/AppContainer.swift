import Foundation

struct AppContainer {
    let configuration: AppConfiguration
    let healthService: any HealthServicing
    let authService: any AuthServicing
    let authSessionStore: any AuthSessionStoring
    let tokenStore: any SecureTokenStoring
    let uiStateStore: any UIStateStoring

    static func live(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) throws -> AppContainer {
        var configuration = try AppConfiguration.from(bundle: bundle)
        let arguments = processInfo.arguments
        let uiStateStore = UIStateStore()
        let tokenStore = KeychainStore()
        let authSessionStore = KeychainAuthSessionStore(tokenStore: tokenStore)

        if arguments.contains("-ui-testing-reset-state") {
            uiStateStore.reset()
        }
        if arguments.contains("-ui-testing-reset-auth") {
            try? authSessionStore.clear()
        }

        let sessionConfiguration = URLSessionConfiguration.ephemeral
        if arguments.contains("-ui-testing-offline") {
            configuration = configuration.overridingAPIBaseURL(URL(string: "https://127.0.0.1:1")!)
            sessionConfiguration.timeoutIntervalForRequest = 1
            sessionConfiguration.timeoutIntervalForResource = 1
        }

        let client = APIClient(
            baseURL: configuration.apiBaseURL,
            session: URLSession(configuration: sessionConfiguration),
            retryPolicy: arguments.contains("-ui-testing-offline")
                ? RetryPolicy(maxAttempts: 1)
                : .standard
        )

        let healthService: any HealthServicing = arguments.contains("-ui-testing-health-success")
            ? UITestHealthService()
            : HealthService(client: client)
        let authService: any AuthServicing = arguments.contains("-ui-testing-auth-flow")
            ? UITestAuthService()
            : AuthService(client: client)

        return AppContainer(
            configuration: configuration,
            healthService: healthService,
            authService: authService,
            authSessionStore: authSessionStore,
            tokenStore: tokenStore,
            uiStateStore: uiStateStore
        )
    }
}

private struct UITestAuthService: AuthServicing {
    func register(email: String, password: String) async throws -> AuthSession {
        session(email: email)
    }

    func login(email: String, password: String) async throws -> AuthSession {
        session(email: email)
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        session(email: "runner@example.com")
    }

    func logout(refreshToken: String) async throws {}

    func forgotPassword(email: String) async throws {}

    func resetPassword(token: String, password: String) async throws {}

    func restore(accessToken: String) async throws -> AuthUser {
        AuthUser(id: "ui-test-user", email: "runner@example.com")
    }

    private func session(email: String) -> AuthSession {
        AuthSession(
            user: AuthUser(id: "ui-test-user", email: email.lowercased()),
            accessToken: "ui-test-access-token",
            refreshToken: "ui-test-refresh-token",
            expiresIn: 900
        )
    }
}

private struct UITestHealthService: HealthServicing {
    func fetchHealth() async throws -> HealthResponse {
        HealthResponse(status: "ok", service: "lauver-api")
    }
}
