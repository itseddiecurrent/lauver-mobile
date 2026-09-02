import SwiftUI

enum AuthenticationState: Equatable {
    case signedOut
    case authenticated
}

enum ServiceStatus: Equatable {
    case loading
    case online
    case offline(message: String, requestID: String?)
}

@MainActor
final class AppViewModel: ObservableObject {
    @Published private(set) var authenticationState: AuthenticationState
    @Published private(set) var serviceStatus: ServiceStatus = .loading
    @Published var selectedTab: AppTab {
        didSet { uiStateStore.selectedTab = selectedTab }
    }

    let configuration: AppConfiguration
    private let healthService: any HealthServicing
    private let uiStateStore: any UIStateStoring

    init(
        configuration: AppConfiguration,
        healthService: any HealthServicing,
        uiStateStore: any UIStateStoring,
        startsAuthenticated: Bool = ProcessInfo.processInfo.arguments.contains("-ui-testing-authenticated")
    ) {
        self.configuration = configuration
        self.healthService = healthService
        self.uiStateStore = uiStateStore
        authenticationState = startsAuthenticated ? .authenticated : .signedOut
        selectedTab = uiStateStore.selectedTab
    }

    func checkHealth() async {
        serviceStatus = .loading
        do {
            _ = try await healthService.fetchHealth()
            serviceStatus = .online
        } catch let error as APIError {
            serviceStatus = .offline(message: error.userMessage, requestID: error.requestID)
        } catch {
            serviceStatus = .offline(message: "The network request failed.", requestID: nil)
        }
    }

    func enterAppShell() {
        authenticationState = .authenticated
    }

    func signOut() {
        authenticationState = .signedOut
        selectedTab = .discover
    }
}

struct ContentView: View {
    @StateObject private var viewModel: AppViewModel

    init(container: AppContainer) {
        _viewModel = StateObject(wrappedValue: AppViewModel(
            configuration: container.configuration,
            healthService: container.healthService,
            uiStateStore: container.uiStateStore
        ))
    }

    var body: some View {
        Group {
            switch viewModel.authenticationState {
            case .signedOut:
                LoginPlaceholderView(viewModel: viewModel)
            case .authenticated:
                AuthenticatedShellView(viewModel: viewModel)
            }
        }
        .task {
            await viewModel.checkHealth()
        }
    }
}

private struct LoginPlaceholderView: View {
    @ObservedObject var viewModel: AppViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: LauverDesign.Spacing.large) {
                VStack(spacing: LauverDesign.Spacing.small) {
                    Text(AppMetadata.displayName)
                        .font(.largeTitle.bold())
                        .accessibilityIdentifier("lauver-title")

                    Text("\(viewModel.configuration.environment.rawValue.capitalized) environment")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("app-environment")
                }

                ServiceStatusView(status: viewModel.serviceStatus) {
                    Task { await viewModel.checkHealth() }
                }

                Button("Continue to App Shell") {
                    viewModel.enterAppShell()
                }
                .buttonStyle(.borderedProminent)
                .tint(LauverDesign.ColorToken.accent)
                .accessibilityIdentifier("auth-continue")

                Text("Email and Apple authentication arrive in the next MVP steps.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(LauverDesign.Spacing.large)
            .navigationTitle("Welcome")
        }
    }
}

private struct AuthenticatedShellView: View {
    @ObservedObject var viewModel: AppViewModel

    var body: some View {
        TabView {
            NavigationStack {
                PlaceholderScreen(
                    tab: .discover,
                    message: "Discover local runners and communities.",
                    serviceStatus: viewModel.serviceStatus,
                    retry: { Task { await viewModel.checkHealth() } }
                )
            }
            .tabItem { Label(AppTab.discover.title, systemImage: AppTab.discover.systemImage) }

            NavigationStack {
                PlaceholderScreen(tab: .events, message: "Upcoming runs will appear here.")
            }
            .tabItem { Label(AppTab.events.title, systemImage: AppTab.events.systemImage) }

            NavigationStack {
                PlaceholderScreen(tab: .messages, message: "Your conversations will appear here.")
            }
            .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.systemImage) }

            NavigationStack {
                VStack(spacing: LauverDesign.Spacing.large) {
                    PlaceholderScreen(tab: .profile, message: "Your runner profile will appear here.")
                    Button("Sign Out", action: viewModel.signOut)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("auth-sign-out")
                }
            }
            .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.systemImage) }
        }
        .tint(LauverDesign.ColorToken.accent)
    }
}

private struct PlaceholderScreen: View {
    let tab: AppTab
    let message: String
    var serviceStatus: ServiceStatus?
    var retry: (() -> Void)?

    init(
        tab: AppTab,
        message: String,
        serviceStatus: ServiceStatus? = nil,
        retry: (() -> Void)? = nil
    ) {
        self.tab = tab
        self.message = message
        self.serviceStatus = serviceStatus
        self.retry = retry
    }

    var body: some View {
        VStack(spacing: LauverDesign.Spacing.large) {
            if let serviceStatus, let retry {
                ServiceStatusView(status: serviceStatus, retry: retry)
            }

            EmptyStateView(systemImage: tab.systemImage, title: tab.title, message: message)
        }
        .padding()
        .navigationTitle(tab.title)
        .accessibilityIdentifier("screen-\(tab.rawValue)")
    }
}

private struct ServiceStatusView: View {
    let status: ServiceStatus
    let retry: () -> Void

    var body: some View {
        VStack(spacing: LauverDesign.Spacing.medium) {
            switch status {
            case .loading:
                LoadingStateView(title: "Checking Lauver API")
            case .online:
                Label("API Online", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(LauverDesign.ColorToken.accent)
                    .accessibilityIdentifier("api-online")
            case let .offline(message, requestID):
                ErrorStateView(message: message, requestID: requestID)
                RetryButton(action: retry)
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(LauverDesign.ColorToken.surface, in: RoundedRectangle(cornerRadius: LauverDesign.Radius.card))
    }
}
