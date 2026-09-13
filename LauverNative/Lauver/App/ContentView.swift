import AuthenticationServices
import SwiftUI

enum AuthenticationState: Equatable {
    case signedOut
    case authenticated
}

enum AuthScreenMode: Equatable {
    case login
    case register
    case forgotPassword
    case resetPassword
    case resetComplete
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
    @Published var authScreenMode: AuthScreenMode = .login
    @Published private(set) var authMessage: String?
    @Published private(set) var isAuthSubmitting = false
    @Published private(set) var authenticatedEmail: String?
    @Published var selectedTab: AppTab {
        didSet { uiStateStore.selectedTab = selectedTab }
    }

    let configuration: AppConfiguration
    private let healthService: any HealthServicing
    private let authService: any AuthServicing
    private let authSessionStore: any AuthSessionStoring
    private let appleUserIdentifierStore: any AppleUserIdentifierStoring
    private let appleCredentialStateChecker: any AppleCredentialStateChecking
    private let uiStateStore: any UIStateStoring
    private let startsAuthenticated: Bool

    init(
        configuration: AppConfiguration,
        healthService: any HealthServicing,
        authService: any AuthServicing,
        authSessionStore: any AuthSessionStoring,
        appleUserIdentifierStore: any AppleUserIdentifierStoring,
        appleCredentialStateChecker: any AppleCredentialStateChecking,
        uiStateStore: any UIStateStoring,
        startsAuthenticated: Bool = ProcessInfo.processInfo.arguments.contains("-ui-testing-authenticated")
    ) {
        self.configuration = configuration
        self.healthService = healthService
        self.authService = authService
        self.authSessionStore = authSessionStore
        self.appleUserIdentifierStore = appleUserIdentifierStore
        self.appleCredentialStateChecker = appleCredentialStateChecker
        self.uiStateStore = uiStateStore
        self.startsAuthenticated = startsAuthenticated
        authenticationState = startsAuthenticated ? .authenticated : .signedOut
        selectedTab = uiStateStore.selectedTab
    }

    func restoreSession() async {
        guard !startsAuthenticated, authenticationState == .signedOut else { return }
        do {
            if let appleUserIdentifier = try appleUserIdentifierStore.read() {
                do {
                    let state = try await appleCredentialStateChecker.state(for: appleUserIdentifier)
                    if [.revoked, .notFound, .transferred].contains(state) {
                        clearLocalAuthentication()
                        authMessage = "Your Apple authorization is no longer active. Please sign in again."
                        return
                    }
                } catch {
                    // A transient Apple status failure must not destroy a valid Lauver session.
                }
            }
            guard let tokens = try authSessionStore.read() else {
                try? appleUserIdentifierStore.clear()
                return
            }
            do {
                let user = try await authService.restore(accessToken: tokens.accessToken)
                authenticatedEmail = user.email
                authenticationState = .authenticated
            } catch APIError.unauthorized {
                let session = try await authService.refresh(refreshToken: tokens.refreshToken)
                try authSessionStore.save(session)
                authenticatedEmail = session.user.email
                authenticationState = .authenticated
            }
        } catch let error as APIError {
            if case .unauthorized = error {
                clearLocalAuthentication()
            }
            authMessage = error.userMessage
        } catch {
            clearLocalAuthentication()
            authMessage = "Your saved session could not be restored."
        }
    }

    func register(email: String, password: String) async {
        await authenticate(appleUserIdentifier: nil) {
            try await authService.register(email: email, password: password)
        }
    }

    func login(email: String, password: String) async {
        await authenticate(appleUserIdentifier: nil) {
            try await authService.login(email: email, password: password)
        }
    }

    func signInWithApple(credential: AppleSignInCredential) async {
        await authenticate(appleUserIdentifier: credential.userIdentifier) {
            try await authService.signInWithApple(credential: credential)
        }
    }

    func appleSignInDidFail(_ error: Error) {
        if let authorizationError = error as? ASAuthorizationError,
           authorizationError.code == .canceled {
            return
        }
        authMessage = (error as? LocalizedError)?.errorDescription
            ?? "Sign in with Apple could not be completed."
    }

    func handleAppleCredentialRevoked() async {
        await signOut()
        authMessage = "Your Apple authorization was revoked. Please sign in again."
    }

    func forgotPassword(email: String) async {
        await performAuthAction {
            try await authService.forgotPassword(email: email)
            authMessage = "If the account is eligible, check your email for a reset token."
            authScreenMode = .resetPassword
        }
    }

    func resetPassword(token: String, password: String) async {
        await performAuthAction {
            try await authService.resetPassword(token: token, password: password)
            authScreenMode = .resetComplete
            authMessage = nil
        }
    }

    func showAuthScreen(_ mode: AuthScreenMode) {
        authMessage = nil
        authScreenMode = mode
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

    func signOut() async {
        let refreshToken = try? authSessionStore.read()?.refreshToken
        if let refreshToken {
            try? await authService.logout(refreshToken: refreshToken)
        }
        try? authSessionStore.clear()
        try? appleUserIdentifierStore.clear()
        authenticationState = .signedOut
        authenticatedEmail = nil
        authScreenMode = .login
        authMessage = nil
        selectedTab = .discover
    }

    private func authenticate(
        appleUserIdentifier: String?,
        _ action: () async throws -> AuthSession
    ) async {
        await performAuthAction {
            let session = try await action()
            do {
                try authSessionStore.save(session)
                if let appleUserIdentifier {
                    try appleUserIdentifierStore.save(appleUserIdentifier)
                } else {
                    try appleUserIdentifierStore.clear()
                }
            } catch {
                try? authSessionStore.clear()
                try? appleUserIdentifierStore.clear()
                throw error
            }
            authenticatedEmail = session.user.email
            authenticationState = .authenticated
            authMessage = nil
        }
    }

    private func performAuthAction(_ action: () async throws -> Void) async {
        guard !isAuthSubmitting else { return }
        isAuthSubmitting = true
        authMessage = nil
        defer { isAuthSubmitting = false }
        do {
            try await action()
        } catch let error as APIError {
            authMessage = error.userMessage
        } catch {
            authMessage = "The authentication request failed."
        }
    }

    private func clearLocalAuthentication() {
        try? authSessionStore.clear()
        try? appleUserIdentifierStore.clear()
        authenticationState = .signedOut
        authenticatedEmail = nil
        authScreenMode = .login
    }
}

struct ContentView: View {
    @StateObject private var viewModel: AppViewModel
    private let discoverService: any DiscoverServicing
    private let profileService: any ProfileServicing
    private let safetyService: any SafetyServicing

    init(container: AppContainer) {
        discoverService = container.discoverService
        profileService = container.profileService
        safetyService = container.safetyService
        _viewModel = StateObject(wrappedValue: AppViewModel(
            configuration: container.configuration,
            healthService: container.healthService,
            authService: container.authService,
            authSessionStore: container.authSessionStore,
            appleUserIdentifierStore: container.appleUserIdentifierStore,
            appleCredentialStateChecker: container.appleCredentialStateChecker,
            uiStateStore: container.uiStateStore
        ))
    }

    var body: some View {
        Group {
            switch viewModel.authenticationState {
            case .signedOut:
                LoginPlaceholderView(viewModel: viewModel)
            case .authenticated:
                AuthenticatedShellView(viewModel: viewModel, profileService: profileService, discoverService: discoverService, safetyService: safetyService)
            }
        }
        .task {
            async let health: Void = viewModel.checkHealth()
            async let session: Void = viewModel.restoreSession()
            _ = await (health, session)
        }
        .onReceive(NotificationCenter.default.publisher(
            for: ASAuthorizationAppleIDProvider.credentialRevokedNotification
        )) { _ in
            Task { await viewModel.handleAppleCredentialRevoked() }
        }
    }
}

private struct LoginPlaceholderView: View {
    @ObservedObject var viewModel: AppViewModel
    @State private var email = ""
    @State private var password = ""
    @State private var resetToken = ""
    @State private var appleNonce: String?

    var body: some View {
        NavigationStack {
            ScrollView {
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

                    authForm

                    if let authMessage = viewModel.authMessage {
                        Text(authMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("auth-message")
                    }
                }
                .padding(LauverDesign.Spacing.large)
            }
            .navigationTitle("Welcome")
        }
    }

    @ViewBuilder
    private var authForm: some View {
        switch viewModel.authScreenMode {
        case .login, .register:
            credentialsForm
        case .forgotPassword:
            forgotPasswordForm
        case .resetPassword:
            resetPasswordForm
        case .resetComplete:
            resetCompleteView
        }
    }

    private var credentialsForm: some View {
        VStack(spacing: LauverDesign.Spacing.medium) {
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("auth-email")

            SecureField("Password", text: $password)
                .textContentType(viewModel.authScreenMode == .register ? .newPassword : .password)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("auth-password")

            Button(viewModel.authScreenMode == .register ? "Create Account" : "Log In") {
                Task {
                    if viewModel.authScreenMode == .register {
                        await viewModel.register(email: email, password: password)
                    } else {
                        await viewModel.login(email: email, password: password)
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(LauverDesign.ColorToken.accent)
            .disabled(viewModel.isAuthSubmitting)
            .accessibilityIdentifier(viewModel.authScreenMode == .register ? "auth-register" : "auth-login")

            HStack {
                Divider()
                Text("or").font(.caption).foregroundStyle(.secondary)
                Divider()
            }

            SignInWithAppleButton(.continue) { request in
                do {
                    let nonce = try AppleSignInNonce.generate()
                    appleNonce = nonce
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = AppleSignInNonce.hash(nonce)
                } catch {
                    appleNonce = nil
                    viewModel.appleSignInDidFail(error)
                }
            } onCompletion: { result in
                defer { appleNonce = nil }
                do {
                    guard let nonce = appleNonce else {
                        throw AppleSignInError.nonceGenerationFailed
                    }
                    let authorization = try result.get()
                    let credential = try AppleSignInCredential(
                        authorization: authorization,
                        nonce: nonce
                    )
                    Task { await viewModel.signInWithApple(credential: credential) }
                } catch {
                    viewModel.appleSignInDidFail(error)
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 48)
            .disabled(viewModel.isAuthSubmitting)
            .accessibilityIdentifier("auth-apple")

            Button(viewModel.authScreenMode == .register ? "Already have an account?" : "Create an account") {
                viewModel.showAuthScreen(viewModel.authScreenMode == .register ? .login : .register)
            }
            .accessibilityIdentifier(viewModel.authScreenMode == .register ? "auth-show-login" : "auth-show-register")

            if viewModel.authScreenMode == .login {
                Button("Forgot password?") {
                    viewModel.showAuthScreen(.forgotPassword)
                }
                .accessibilityIdentifier("auth-forgot-link")
            }

            Text("Passwords must be 12–128 characters and include a letter and number.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var forgotPasswordForm: some View {
        VStack(spacing: LauverDesign.Spacing.medium) {
            Text("Reset Password").font(.title2.bold())
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("auth-email")
            Button("Send Reset Instructions") {
                Task { await viewModel.forgotPassword(email: email) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isAuthSubmitting)
            .accessibilityIdentifier("auth-forgot-submit")
            Button("Back to Log In") { viewModel.showAuthScreen(.login) }
                .accessibilityIdentifier("auth-back-login")
        }
    }

    private var resetPasswordForm: some View {
        VStack(spacing: LauverDesign.Spacing.medium) {
            Text("Enter Reset Token").font(.title2.bold())
            TextField("Reset token", text: $resetToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("auth-reset-token")
            SecureField("New password", text: $password)
                .textContentType(.newPassword)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("auth-reset-password")
            Button("Reset Password") {
                Task { await viewModel.resetPassword(token: resetToken, password: password) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isAuthSubmitting)
            .accessibilityIdentifier("auth-reset-submit")
            Button("Back to Log In") { viewModel.showAuthScreen(.login) }
                .accessibilityIdentifier("auth-back-login")
        }
    }

    private var resetCompleteView: some View {
        VStack(spacing: LauverDesign.Spacing.medium) {
            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(LauverDesign.ColorToken.accent)
            Text("Password Reset Complete").font(.title2.bold())
            Text("You can now log in with your new password.")
                .foregroundStyle(.secondary)
            Button("Return to Log In") { viewModel.showAuthScreen(.login) }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("auth-reset-complete")
        }
    }
}

private struct AuthenticatedShellView: View {
    @ObservedObject var viewModel: AppViewModel
    let profileService: any ProfileServicing
    let discoverService: any DiscoverServicing
    let safetyService: any SafetyServicing

    var body: some View {
        TabView {
            NavigationStack {
                DiscoverView(service: discoverService, profileService: profileService, safetyService: safetyService)
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
                OwnProfileView(service: profileService, safetyService: safetyService) {
                    Task { await viewModel.signOut() }
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
