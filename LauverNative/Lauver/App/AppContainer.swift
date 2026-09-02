import Foundation

struct AppContainer {
    let configuration: AppConfiguration
    let healthService: any HealthServicing
    let tokenStore: any SecureTokenStoring
    let uiStateStore: any UIStateStoring

    static func live(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) throws -> AppContainer {
        var configuration = try AppConfiguration.from(bundle: bundle)
        let arguments = processInfo.arguments
        let uiStateStore = UIStateStore()

        if arguments.contains("-ui-testing-reset-state") {
            uiStateStore.reset()
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

        return AppContainer(
            configuration: configuration,
            healthService: healthService,
            tokenStore: KeychainStore(),
            uiStateStore: uiStateStore
        )
    }
}

private struct UITestHealthService: HealthServicing {
    func fetchHealth() async throws -> HealthResponse {
        HealthResponse(status: "ok", service: "lauver-api")
    }
}
