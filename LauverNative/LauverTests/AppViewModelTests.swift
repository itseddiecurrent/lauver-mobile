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

    func testAuthenticationShellAndSignOutFlow() {
        let uiStateStore = TestUIStateStore(selectedTab: .events)
        let viewModel = makeViewModel(uiStateStore: uiStateStore)

        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        viewModel.enterAppShell()
        XCTAssertEqual(viewModel.authenticationState, .authenticated)

        viewModel.selectedTab = .profile
        XCTAssertEqual(uiStateStore.selectedTab, .profile)

        viewModel.signOut()
        XCTAssertEqual(viewModel.authenticationState, .signedOut)
        XCTAssertEqual(viewModel.selectedTab, .discover)
    }

    private func makeViewModel(
        healthResult: Result<HealthResponse, APIError> = .success(HealthResponse(status: "ok", service: "lauver-api")),
        uiStateStore: TestUIStateStore = TestUIStateStore()
    ) -> AppViewModel {
        AppViewModel(
            configuration: AppConfiguration(
                environment: .staging,
                apiBaseURL: URL(string: "https://lauver-api-staging.onrender.com")!
            ),
            healthService: StubHealthService(result: healthResult),
            uiStateStore: uiStateStore,
            startsAuthenticated: false
        )
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
