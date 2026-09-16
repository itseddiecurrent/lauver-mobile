import AuthenticationServices
import SwiftUI
import MapKit
import CoreLocation

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

    func handleSessionExpired() {
        clearLocalAuthentication()
        selectedTab = .discover
        authMessage = "Your session expired. Please sign in again."
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
    private let eventsService: any EventsServicing
    private let stravaService: any StravaServicing

    init(container: AppContainer) {
        discoverService = container.discoverService
        profileService = container.profileService
        safetyService = container.safetyService
        eventsService = container.eventsService
        stravaService = container.stravaService
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
                AuthenticatedShellView(viewModel: viewModel, profileService: profileService, discoverService: discoverService, safetyService: safetyService, eventsService: eventsService, stravaService: stravaService, chatService: profileService as? any ChatServicing)
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
        .onReceive(NotificationCenter.default.publisher(for: .authenticationSessionExpired)) { _ in
            viewModel.handleSessionExpired()
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
    let eventsService: any EventsServicing
    let stravaService: any StravaServicing
    let chatService: (any ChatServicing)?
    @StateObject private var chat = ChatConnection()


    var body: some View {
        TabView {
            NavigationStack {
                DiscoverView(service: discoverService, profileService: profileService, safetyService: safetyService)
            }
            .tabItem { Label(AppTab.discover.title, systemImage: AppTab.discover.systemImage) }

            NavigationStack {
                EventsView(service: eventsService)
            }
            .tabItem { Label(AppTab.events.title, systemImage: AppTab.events.systemImage) }

            NavigationStack {
                if let chatService {
                    MessagesView(service: chatService, discoverService: discoverService, safetyService: safetyService)
                } else {
                    PlaceholderScreen(tab: .messages, message: "Your conversations will appear here.")
                }
            }
            .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.systemImage) }
            .badge(chat.unreadMessages > 0 ? min(chat.unreadMessages, 99) : 0)

            NavigationStack {
                OwnProfileView(service: profileService, safetyService: safetyService, stravaService: stravaService, healthUploader: profileService as? any HealthWorkoutUploading) {
                    Task { await viewModel.signOut() }
                }
            }
            .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.systemImage) }
        }
        .tint(LauverDesign.ColorToken.accent)
        .environmentObject(chat)
        .onDisappear { chat.stop() }
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
import SwiftUI

@MainActor
final class EventsViewModel: ObservableObject {
    @Published private(set) var events: [PublicEvent] = []
    @Published private(set) var loading = false
    @Published var error: String?
    private let service: any EventsServicing
    init(service: any EventsServicing) { self.service = service }
    func load() async {
        guard !loading else { return }; loading = true; error = nil
        defer { loading = false }
        do { events = try await service.events(sport: nil, city: nil, cursor: nil).events }
        catch let caught { error = (caught as? APIError)?.userMessage ?? "Events could not be loaded." }
    }
    func join(_ event: PublicEvent) async -> PublicEvent { do { let updated = try await service.joinEvent(id: event.id); replace(updated); return updated } catch let caught { error = (caught as? APIError)?.userMessage ?? "Could not join this event."; return event } }
    func leave(_ event: PublicEvent) async -> PublicEvent { do { let updated = try await service.leaveEvent(id: event.id); replace(updated); return updated } catch let caught { error = (caught as? APIError)?.userMessage ?? "Could not leave this event."; return event } }
    fileprivate func replace(_ event: PublicEvent) { if let i = events.firstIndex(where: { $0.id == event.id }) { events[i] = event } }
}

struct EventsView: View {
    @StateObject private var model: EventsViewModel
    let service: any EventsServicing
    @State private var showCreate = false
    @StateObject private var location = UserLocationModel()
    init(service: any EventsServicing) { self.service = service; _model = StateObject(wrappedValue: EventsViewModel(service: service)) }
    var body: some View {
        List {
            Section { Map(initialPosition: .userLocation(fallback: .automatic)) { UserAnnotation() }.frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 12)) }
            if model.loading && model.events.isEmpty { LoadingStateView(title: "Loading events") }
            if let error = model.error { ErrorStateView(message: error, requestID: nil); RetryButton { Task { await model.load() } } }
            if !model.loading && model.events.isEmpty && model.error == nil { EmptyStateView(systemImage: "calendar", title: "No upcoming events", message: "Check back soon for public workouts.") }
            ForEach(model.events) { event in
                NavigationLink { EventDetailView(event: event, model: model, service: service) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(event.title).font(.headline)
                        Text("\(event.sport.replacingOccurrences(of: "_", with: " ").capitalized) · \(event.venue.name)").font(.subheadline).foregroundStyle(.secondary)
                        Text(event.startsAt).font(.footnote).foregroundStyle(.secondary)
                        Text("\(event.attendeeCount)/\(event.capacity) attendees").font(.footnote)
                    }
                }
            }
        }
        .navigationTitle("Events")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Create", systemImage: "plus") { showCreate = true }.accessibilityIdentifier("events-create") } }
        .sheet(isPresented: $showCreate) { CreateEventView(service: service) { showCreate = false; Task { await model.load() } } }
        .task { await model.load() }
        .task { location.request() }
        .refreshable { await model.load() }
        .accessibilityIdentifier("screen-events")
    }
}

@MainActor
private final class UserLocationModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyHundredMeters }
    func request() { manager.requestWhenInUseAuthorization(); manager.startUpdatingLocation() }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { manager.startUpdatingLocation() }
    }
}

private struct EventDetailView: View {
    let event: PublicEvent
    @ObservedObject var model: EventsViewModel
    let service: any EventsServicing
    @State private var currentEvent: PublicEvent
    @State private var showEdit = false
    @State private var showCancelConfirm = false
    @State private var showReport = false
    @State private var error: String?
    init(event: PublicEvent, model: EventsViewModel, service: any EventsServicing) {
        self.event = event; self.model = model; self.service = service
        _currentEvent = State(initialValue: event)
    }
    var body: some View {
        List {
            Section { Text(currentEvent.title).font(.title2.bold()); Text(currentEvent.description ?? "No description") }
            Section("Venue") { Text(currentEvent.venue.name); if let address = currentEvent.venue.address { Text(address).foregroundStyle(.secondary) } }
            Section("Your status") { Label(currentEvent.isAttendee == true ? "You’re attending this event" : "You’re not attending this event", systemImage: currentEvent.isAttendee == true ? "checkmark.circle.fill" : "circle") }
            Section("Attendees") { Text("\(currentEvent.attendeeCount) of \(currentEvent.capacity)") }
            Section {
                if currentEvent.isAttendee == true { Button("Leave Event", role: .destructive) { Task { currentEvent = await model.leave(currentEvent) } } }
                else if currentEvent.status == "upcoming" { Button("Join Event") { Task { currentEvent = await model.join(currentEvent) } }.buttonStyle(.borderedProminent) }
            }
            Section("Safety") {
                Button("Report Event", role: .destructive) { Task { _ = try? await service.reportEvent(id: currentEvent.id, reason: "unsafe_event", details: nil) } }
                Button("Report Organizer", role: .destructive) { Task { _ = try? await service.reportEvent(id: currentEvent.id, reason: "harassment", details: "Report organizer from event detail") } }
            }
            Section("Manage") {
                Button("Edit Event") { showEdit = true }
                Button("Cancel Event", role: .destructive) { showCancelConfirm = true }
            }
        }
        .navigationTitle("Event Details")
        .alert("Cancel this event?", isPresented: $showCancelConfirm) { Button("Cancel Event", role: .destructive) { Task { do { let updated = try await service.cancelEvent(id: event.id); model.replace(updated) } catch let caught { error = (caught as? APIError)?.userMessage ?? "Could not cancel event." } } }; Button("Keep Event", role: .cancel) {} }
        .alert("Unable to update event", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK", role: .cancel) {} } message: { Text(error ?? "Please try again.") }
        .sheet(isPresented: $showEdit) { CreateEventView(service: service, existing: currentEvent) { showEdit = false } }
        .task { if let refreshed = try? await service.event(id: event.id) { currentEvent = refreshed } }
    }
}

private struct CreateEventView: View {
    let service: any EventsServicing
    let done: () -> Void
    let existing: PublicEvent?
    @State private var title = ""
    @State private var venue = ""
    @State private var description = ""
    @State private var capacity = 10
    @State private var starts = Date().addingTimeInterval(3600)
    @State private var ends = Date().addingTimeInterval(7200)
    @State private var error: String?
    @State private var latitude = 31.2304
    @State private var longitude = 121.4737
    @State private var showVenueSearch = false
    init(service: any EventsServicing, existing: PublicEvent? = nil, done: @escaping () -> Void) {
        self.service = service; self.existing = existing; self.done = done
        _title = State(initialValue: existing?.title ?? "")
        _venue = State(initialValue: existing?.venue.name ?? "")
        _description = State(initialValue: existing?.description ?? "")
        _capacity = State(initialValue: existing?.capacity ?? 10)
        _latitude = State(initialValue: existing?.venue.latitude ?? 31.2304)
        _longitude = State(initialValue: existing?.venue.longitude ?? 121.4737)
    }
    var body: some View {
        NavigationStack { Form {
            TextField("Title", text: $title)
            HStack { TextField("Venue", text: $venue); Button("Search") { showVenueSearch = true } }
            TextField("Description", text: $description)
            Stepper("Capacity: \(capacity)", value: $capacity, in: 2...1000)
            DatePicker("Starts", selection: $starts, in: Date()...)
            DatePicker("Ends", selection: $ends, in: starts...)
            if let error { Text(error).foregroundStyle(.red) }
            Button(existing == nil ? "Create Event" : "Save Changes") { Task { await create() } }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || venue.trimmingCharacters(in: .whitespaces).isEmpty)
        }.navigationTitle("Create Event").toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel", action: done) } } }
        .sheet(isPresented: $showVenueSearch) { VenueSearchView { item in venue = item.name; latitude = item.latitude; longitude = item.longitude; showVenueSearch = false } }
    }
    private func create() async {
        do { let draft = EventDraft(title: title, description: description.isEmpty ? nil : description, sport: existing?.sport ?? "running", startsAt: starts.ISO8601Format(), endsAt: ends.ISO8601Format(), capacity: capacity, venueName: venue, venueAddress: nil, venueLatitude: latitude, venueLongitude: longitude); if let existing { _ = try await service.updateEvent(id: existing.id, draft: draft) } else { _ = try await service.createEvent(draft) }; done() }
        catch let caught { error = (caught as? APIError)?.userMessage ?? "Could not create event." }
    }
}

private struct VenueResult { let name: String; let latitude: Double; let longitude: Double }
private final class VenueSearchModel: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published var query = ""; @Published var results: [MKLocalSearchCompletion] = []
    private let completer = MKLocalSearchCompleter()
    override init() { super.init(); completer.delegate = self; completer.resultTypes = [.address, .pointOfInterest] }
    func update() { completer.queryFragment = query }
    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) { results = completer.results }
    func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) { results = [] }
    func resolve(_ completion: MKLocalSearchCompletion) async -> VenueResult? {
        let request = MKLocalSearch.Request(completion: completion)
        guard let item = try? await MKLocalSearch(request: request).start().mapItems.first, let coordinate = item.placemark.location?.coordinate else { return nil }
        return VenueResult(name: item.name ?? completion.title, latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}
private struct VenueSearchView: View {
    let select: (VenueResult) -> Void
    @StateObject private var model = VenueSearchModel()
    @StateObject private var location = VenueLocationModel()
    var body: some View {
        NavigationStack { List {
            Section { Button("Use My Current Location", systemImage: "location.fill") { Task { if let venue = await location.currentVenue() { select(venue) } } }.disabled(location.loading) }
            Section { ForEach(model.results, id: \.self) { result in Button { Task { if let venue = await model.resolve(result) { select(venue) } } } label: { VStack(alignment: .leading) { Text(result.title); if !result.subtitle.isEmpty { Text(result.subtitle).font(.footnote).foregroundStyle(.secondary) } } } } }
        } .searchable(text: $model.query, prompt: "Search Apple Maps") .onChange(of: model.query) { _, _ in model.update() }.navigationTitle("Choose Venue") }
    }
}

@MainActor
private final class VenueLocationModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var loading = false
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyHundredMeters }
    func currentVenue() async -> VenueResult? {
        loading = true
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else { loading = false; return nil }
        manager.startUpdatingLocation()
        let coordinate = await withCheckedContinuation { (continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>) in
            if let coordinate = manager.location?.coordinate { continuation.resume(returning: coordinate) }
            else { self.continuation = continuation }
        }
        manager.stopUpdatingLocation(); loading = false
        guard let coordinate else { return nil }
        let placemark = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)).first
        let name = placemark?.name ?? placemark?.locality ?? "Current location"
        let address = [placemark?.thoroughfare, placemark?.locality].compactMap { $0 }.joined(separator: ", ")
        _ = address
        return VenueResult(name: name, latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate, let continuation else { return }
        self.continuation = nil; continuation.resume(returning: coordinate)
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { if manager.authorizationStatus == .denied { continuation?.resume(returning: nil); continuation = nil } }
}
