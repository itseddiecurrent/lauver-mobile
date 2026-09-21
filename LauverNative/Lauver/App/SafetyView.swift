import AuthenticationServices
import SwiftUI
import StreamChat

enum ReportReason: String, CaseIterable, Identifiable, Encodable {
    case spam, harassment, hateAbuse = "hate_abuse", unsafeEvent = "unsafe_event", impersonation, other
    var id: String { rawValue }
    var title: String {
        switch self {
        case .spam: "Spam"
        case .harassment: "Harassment"
        case .hateAbuse: "Hate or abuse"
        case .unsafeEvent: "Unsafe event"
        case .impersonation: "Impersonation"
        case .other: "Other"
        }
    }
}

struct ReportReceipt: Decodable {
    let referenceId: String
    let blockedUser: Bool
}

struct BlockedUser: Decodable, Identifiable {
    let id: String
    let displayName: String?
    let cityName: String?
}

struct BlockedUsersPage: Decodable {
    let users: [BlockedUser]
    let nextCursor: String?
}

protocol SafetyServicing {
    func block(userID: String) async throws
    func unblock(userID: String) async throws
    func blockedUsers(cursor: String?) async throws -> BlockedUsersPage
    func report(userID: String, reason: ReportReason, details: String, blockUser: Bool) async throws -> ReportReceipt
}

extension Notification.Name {
    static let safetyPolicyChanged = Notification.Name("lauver.safetyPolicyChanged")
}

@MainActor
final class ReportViewModel: ObservableObject {
    @Published private(set) var isSubmitting = false
    @Published private(set) var receipt: ReportReceipt?
    @Published private(set) var errorMessage: String?
    private let service: any SafetyServicing
    init(service: any SafetyServicing) { self.service = service }

    func submit(userID: String, reason: ReportReason, details: String, blockUser: Bool) async {
        guard !isSubmitting, receipt == nil else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            receipt = try await service.report(userID: userID, reason: reason, details: details, blockUser: blockUser)
        } catch {
            errorMessage = (error as? APIError)?.userMessage ?? "Your report could not be submitted. Please try again."
        }
    }
}

struct ReportUserView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: ReportViewModel
    @State private var reason: ReportReason = .harassment
    @State private var details = ""
    @State private var blockUser: Bool
    let userID: String
    let displayName: String
    let finished: (Bool) -> Void

    init(userID: String, displayName: String, blockUser: Bool, service: any SafetyServicing, finished: @escaping (Bool) -> Void) {
        self.userID = userID
        self.displayName = displayName
        self.finished = finished
        _blockUser = State(initialValue: blockUser)
        _viewModel = StateObject(wrappedValue: ReportViewModel(service: service))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
                    if let receipt = viewModel.receipt {
                        Image(systemName: "checkmark.shield.fill").font(.largeTitle).foregroundStyle(LauverDesign.ColorToken.accent)
                        Text("Report submitted").font(.title2.bold()).accessibilityIdentifier("report-success")
                        Text("Thank you for helping keep Lauver safe. Your report has been added to our review queue.")
                        Text("Reference: \(receipt.referenceId)").font(.footnote).textSelection(.enabled).accessibilityIdentifier("report-reference")
                        if receipt.blockedUser { Text("This user is also blocked.").font(.subheadline) }
                        Button("Done") { finished(receipt.blockedUser); dismiss() }
                            .buttonStyle(SafetyPrimaryButtonStyle()).accessibilityIdentifier("report-done")
                    } else {
                        Text("Report \(displayName)").font(.title2.bold())
                        Text("Choose a reason and share any details that will help us review this profile.")
                            .foregroundStyle(.secondary)
                        safetyCard {
                            Picker("Reason", selection: $reason) {
                                ForEach(ReportReason.allCases) { Text($0.title).tag($0) }
                            }.accessibilityIdentifier("report-reason")
                            TextField("Additional details (optional)", text: $details, axis: .vertical)
                                .lineLimit(4...8).accessibilityIdentifier("report-details")
                            Text("\(details.utf16.count)/2000").font(.caption).foregroundStyle(details.utf16.count > 2000 ? .red : .secondary)
                        }
                        safetyCard {
                            Toggle("Also block this user", isOn: $blockUser).tint(LauverDesign.ColorToken.accent)
                                .accessibilityIdentifier("report-also-block")
                            Text("Blocking hides your profiles from each other. Reporting alone does not block the user.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if let error = viewModel.errorMessage {
                            Text(error).foregroundStyle(LauverDesign.ColorToken.danger).accessibilityIdentifier("report-error")
                        }
                        Button(viewModel.isSubmitting ? "Submitting…" : blockUser ? "Report and Block" : "Submit Report") {
                            Task { await viewModel.submit(userID: userID, reason: reason, details: details, blockUser: blockUser) }
                        }
                        .buttonStyle(SafetyPrimaryButtonStyle()).disabled(viewModel.isSubmitting || details.utf16.count > 2000)
                        .accessibilityIdentifier("report-submit")
                    }
                }.padding(LauverDesign.Spacing.large)
            }
            .background(LauverDesign.ColorToken.background)
            .navigationTitle("Report User").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if viewModel.receipt == nil {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(viewModel.isSubmitting) }
                }
            }
            .interactiveDismissDisabled(viewModel.isSubmitting || viewModel.receipt != nil)
        }.tint(LauverDesign.ColorToken.accent)
    }
}

@MainActor
final class ReportMessageViewModel: ObservableObject {
    @Published private(set) var isSubmitting = false
    @Published private(set) var receipt: ReportReceipt?
    @Published private(set) var errorMessage: String?
    private let service: any ChatServicing

    init(service: any ChatServicing) { self.service = service }

    func submit(channelID: String, messageID: String, reason: ReportReason, details: String) async {
        guard !isSubmitting, receipt == nil else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            receipt = try await service.reportChatMessage(
                channelID: channelID,
                messageID: messageID,
                reason: reason,
                details: details
            )
        } catch {
            errorMessage = (error as? APIError)?.userMessage ?? "Your message report could not be submitted. Please try again."
        }
    }
}

struct ReportMessageView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: ReportMessageViewModel
    @State private var reason: ReportReason = .harassment
    @State private var details = ""
    let message: ChatMessage
    let finished: () -> Void

    init(service: any ChatServicing, message: ChatMessage, finished: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: ReportMessageViewModel(service: service))
        self.message = message
        self.finished = finished
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Message") {
                    Text(message.text.isEmpty ? "Attachment or unsupported content" : message.text)
                        .lineLimit(4)
                }
                Section("Reason") {
                    Picker("Reason", selection: $reason) {
                        ForEach(ReportReason.allCases) { Text($0.title).tag($0) }
                    }
                    .accessibilityIdentifier("message-report-reason")
                    TextField("Additional details (optional)", text: $details, axis: .vertical)
                        .lineLimit(3...6)
                        .accessibilityIdentifier("message-report-details")
                }
                if let errorMessage = viewModel.errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).accessibilityIdentifier("message-report-error") }
                }
                if let receipt = viewModel.receipt {
                    Section {
                        Label("Report submitted", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .accessibilityIdentifier("message-report-success")
                        Text("Reference: \(receipt.referenceId)")
                            .accessibilityIdentifier("message-report-reference")
                        Button("Done") { finished(); dismiss() }
                            .accessibilityIdentifier("message-report-done")
                    }
                } else {
                    Section {
                        Button(viewModel.isSubmitting ? "Submitting…" : "Submit Report") {
                            Task {
                                guard let channelID = message.cid?.id else { return }
                                await viewModel.submit(channelID: channelID, messageID: message.id, reason: reason, details: details)
                            }
                        }
                        .disabled(viewModel.isSubmitting || details.count > 2000)
                        .accessibilityIdentifier("message-report-submit")
                    }
                }
            }
            .navigationTitle("Report Message")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { finished(); dismiss() }
                }
            }
        }
    }
}

@MainActor
final class BlockedUsersViewModel: ObservableObject {
    @Published private(set) var users: [BlockedUser] = []
    @Published private(set) var nextCursor: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isChanging = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var hasLoaded = false
    private let service: any SafetyServicing
    init(service: any SafetyServicing) { self.service = service }
    func load(refresh: Bool = true) async {
        guard !isLoading, !isChanging, refresh || nextCursor != nil else { return }
        isLoading = true; errorMessage = nil
        if refresh { nextCursor = nil }
        defer { isLoading = false }
        do {
            let page = try await service.blockedUsers(cursor: refresh ? nil : nextCursor)
            try Task.checkCancellation()
            if refresh { users = page.users }
            else { let ids = Set(users.map(\.id)); users.append(contentsOf: page.users.filter { !ids.contains($0.id) }) }
            nextCursor = page.nextCursor; hasLoaded = true
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = (error as? APIError)?.userMessage ?? "Blocked users could not be loaded."
        }
    }
    func unblock(_ user: BlockedUser) async {
        guard !isChanging, !isLoading else { return }
        isChanging = true; errorMessage = nil
        defer { isChanging = false }
        do {
            try await service.unblock(userID: user.id)
            users.removeAll { $0.id == user.id }
            NotificationCenter.default.post(name: .safetyPolicyChanged, object: nil)
        } catch { errorMessage = (error as? APIError)?.userMessage ?? "This user could not be unblocked. Please try again." }
    }
}

struct BlockedUsersView: View {
    @StateObject private var viewModel: BlockedUsersViewModel
    @State private var confirmingUser: BlockedUser?
    init(service: any SafetyServicing) { _viewModel = StateObject(wrappedValue: BlockedUsersViewModel(service: service)) }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: LauverDesign.Spacing.medium) {
                Text("People you block cannot view your profile. Unblocking does not restore old conversations.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if viewModel.isLoading && !viewModel.hasLoaded { LoadingStateView(title: "Loading blocked users") }
                if let error = viewModel.errorMessage {
                    Text(error).foregroundStyle(LauverDesign.ColorToken.danger)
                    RetryButton { Task { await viewModel.load(refresh: viewModel.nextCursor == nil) } }
                }
                if viewModel.hasLoaded && viewModel.users.isEmpty && viewModel.errorMessage == nil {
                    EmptyStateView(systemImage: "person.crop.circle.badge.checkmark", title: "No blocked users", message: "People you block will appear here.")
                }
                ForEach(viewModel.users) { user in
                    safetyCard {
                        Text(user.displayName ?? "Unavailable account").font(.headline)
                        if let city = user.cityName { Text(city).font(.subheadline).foregroundStyle(.secondary) }
                        Button("Unblock") { confirmingUser = user }
                            .buttonStyle(.bordered).tint(LauverDesign.ColorToken.accent)
                            .disabled(viewModel.isChanging || viewModel.isLoading).accessibilityIdentifier("unblock-\(user.id)")
                    }
                }
                if viewModel.nextCursor != nil {
                    Button("Load more") { Task { await viewModel.load(refresh: false) } }.disabled(viewModel.isLoading || viewModel.isChanging)
                }
            }.padding(LauverDesign.Spacing.large)
        }
        .background(LauverDesign.ColorToken.background).navigationTitle("Blocked Users")
        .task { await viewModel.load() }.refreshable { await viewModel.load() }
        .alert("Unblock this user?", isPresented: Binding(get: { confirmingUser != nil }, set: { if !$0 { confirmingUser = nil } })) {
            if let user = confirmingUser { Button("Unblock") { Task { await viewModel.unblock(user) } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Your profiles may appear in each other’s Discover again, unless they have also blocked you.") }
    }
}

struct SafetySettingsView: View {
    @EnvironmentObject private var languageStore: AppLanguageStore
    let service: any SafetyServicing
    let profileService: any ProfileServicing
    let stravaService: any StravaServicing
    let healthUploader: (any HealthWorkoutUploading)?
    let signOut: () -> Void
    let accountDeletionService: any AccountDeletionServicing
    @State private var showingDeleteConfirmation = false
    @State private var showingDeleteReauthentication = false
    @State private var currentPassword = ""
    @State private var appleNonce: String?
    @State private var isDeleting = false
    @State private var errorMessage: String?
    @State private var isVisibleInMatch = false
    @State private var isLoadingMatchVisibility = true
    @State private var isSavingMatchVisibility = false
    @State private var matchVisibilityError: String?

    init(service: any SafetyServicing, profileService: any ProfileServicing, stravaService: any StravaServicing, accountDeletionService: any AccountDeletionServicing, healthUploader: (any HealthWorkoutUploading)? = nil, signOut: @escaping () -> Void) { self.service = service; self.profileService = profileService; self.stravaService = stravaService; self.accountDeletionService = accountDeletionService; self.healthUploader = healthUploader; self.signOut = signOut }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
                Text("PREFERENCES").font(.caption.weight(.bold)).foregroundStyle(LauverDesign.ColorToken.accent)
                safetyCard {
                    Picker("App Language", selection: $languageStore.selection) {
                        Text("System Default").tag(AppLanguage.system)
                        Text("English").tag(AppLanguage.english)
                        Text("简体中文").tag(AppLanguage.simplifiedChinese)
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("settings-app-language")
                }
                Text("CONNECTIONS").font(.caption.weight(.bold)).foregroundStyle(LauverDesign.ColorToken.accent)
                safetyCard {
                    NavigationLink { ConnectedAppsView(service: stravaService, healthUploader: healthUploader) } label: {
                        Label("Connected Apps", systemImage: "link").frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityIdentifier("settings-connected-apps")
                }
                Text("SAFETY").font(.caption.weight(.bold)).foregroundStyle(LauverDesign.ColorToken.accent)
                safetyCard {
                    NavigationLink { BlockedUsersView(service: service) } label: {
                        Label("Blocked Users", systemImage: "person.crop.circle.badge.xmark").frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityIdentifier("settings-blocked-users")
                }
                Text("MATCHING").font(.caption.weight(.bold)).foregroundStyle(LauverDesign.ColorToken.accent)
                safetyCard {
                    Toggle("Show my profile in matching pool", isOn: Binding(
                        get: { isVisibleInMatch },
                        set: { newValue in Task { await updateMatchVisibility(newValue) } }
                    ))
                    .tint(LauverDesign.ColorToken.accent)
                    .disabled(isLoadingMatchVisibility || isSavingMatchVisibility)
                    .accessibilityIdentifier("settings-match-visibility-toggle")
                    if isLoadingMatchVisibility { ProgressView().controlSize(.small) }
                    Text("When off, your profile stays out of the matching pool and you cannot browse or Like other profiles there.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let matchVisibilityError {
                        Text(matchVisibilityError).font(.footnote).foregroundStyle(.red)
                            .accessibilityIdentifier("settings-match-visibility-error")
                    }
                }
                Button("Sign Out", role: .destructive, action: signOut).accessibilityIdentifier("settings-sign-out")
                Text("ACCOUNT").font(.caption.weight(.bold)).foregroundStyle(LauverDesign.ColorToken.accent)
                safetyCard {
                    Button("Delete Account", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    .disabled(isDeleting)
                    .accessibilityIdentifier("settings-delete-account")
                    Text("This permanently removes your Lauver account and connected data.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("settings-delete-account-error")
                }
            }.padding(LauverDesign.Spacing.large)
        }
        .background(LauverDesign.ColorToken.background)
        .toolbarBackground(LauverDesign.ColorToken.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(LauverDesign.ColorToken.accent)
        .navigationTitle("Settings")
        .task { await loadMatchVisibility() }
            .alert("Delete your account?", isPresented: $showingDeleteConfirmation) {
                Button("Delete Account", role: .destructive) {
                    showingDeleteReauthentication = true
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action cannot be undone. You will be signed out immediately.")
            }
            .sheet(isPresented: $showingDeleteReauthentication) {
                ScrollView {
                    VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
                    Text("Re-authenticate to delete").font(.title2.weight(.bold))
                    Text("Enter your current password to permanently delete this account.")
                        .foregroundStyle(.secondary)
                    SecureField("Current password", text: $currentPassword)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("settings-delete-account-password")
                    Button("Permanently Delete Account", role: .destructive) {
                        let password = currentPassword
                        submitDeletion { try await accountDeletionService.deleteAccount(currentPassword: password) }
                    }
                    .disabled(currentPassword.isEmpty || isDeleting)
                    .accessibilityIdentifier("settings-delete-account-submit")
                    HStack {
                        Rectangle().frame(height: 1).foregroundStyle(.quaternary)
                        Text("or").font(.caption).foregroundStyle(.secondary)
                        Rectangle().frame(height: 1).foregroundStyle(.quaternary)
                    }
                    SignInWithAppleButton(.continue) { request in
                        do {
                            let nonce = try AppleSignInNonce.generate()
                            appleNonce = nonce
                            request.requestedScopes = []
                            request.nonce = AppleSignInNonce.hash(nonce)
                        } catch {
                            appleNonce = nil
                            errorMessage = "Apple re-authentication could not start."
                        }
                    } onCompletion: { result in
                        defer { appleNonce = nil }
                        do {
                            guard let nonce = appleNonce else { throw AppleSignInError.nonceGenerationFailed }
                            let credential = try AppleSignInCredential(authorization: result.get(), nonce: nonce)
                            submitDeletion { try await accountDeletionService.deleteAccount(appleCredential: credential) }
                        } catch {
                            errorMessage = (error as? APIError)?.userMessage ?? "Apple re-authentication failed."
                        }
                    }
                    .frame(height: 44)
                    .accessibilityIdentifier("settings-delete-account-apple")
                    Button("Cancel") { showingDeleteReauthentication = false }
                }
                    .padding(LauverDesign.Spacing.large)
                }
                .scrollDismissesKeyboard(.interactively)
                // Keep the destructive action above the keyboard on compact
                // physical devices; the form remains scrollable for Dynamic Type.
                .presentationDetents([.large])
            }
    }

    private func submitDeletion(_ operation: @escaping () async throws -> Void) {
        isDeleting = true
        showingDeleteReauthentication = false
        errorMessage = nil
        currentPassword = ""
        Task {
            do {
                try await operation()
                signOut()
            } catch {
                isDeleting = false
                errorMessage = (error as? APIError)?.userMessage ?? "Your account could not be deleted. Please try again."
            }
        }
    }

    private func loadMatchVisibility() async {
        guard isLoadingMatchVisibility else { return }
        do {
            isVisibleInMatch = try await profileService.getMatchPreferences().visibleInMatch
            matchVisibilityError = nil
        } catch {
            matchVisibilityError = (error as? APIError)?.userMessage ?? "Matching visibility could not be loaded."
        }
        isLoadingMatchVisibility = false
    }

    private func updateMatchVisibility(_ newValue: Bool) async {
        guard !isLoadingMatchVisibility, !isSavingMatchVisibility, newValue != isVisibleInMatch else { return }
        let previousValue = isVisibleInMatch
        isVisibleInMatch = newValue
        isSavingMatchVisibility = true
        matchVisibilityError = nil
        defer { isSavingMatchVisibility = false }
        do {
            isVisibleInMatch = try await profileService.updateMatchVisibility(newValue).visibleInMatch
        } catch {
            isVisibleInMatch = previousValue
            matchVisibilityError = (error as? APIError)?.userMessage ?? "Matching visibility could not be saved."
        }
    }
}

struct SafetyPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.headline).foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(LauverDesign.ColorToken.accent.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: LauverDesign.Radius.button))
            .opacity(isEnabled ? 1 : 0.5)
    }
}

func safetyCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: LauverDesign.Spacing.medium, content: content)
        .padding(LauverDesign.Spacing.medium).frame(maxWidth: .infinity, alignment: .leading)
        .background(LauverDesign.ColorToken.surface, in: RoundedRectangle(cornerRadius: LauverDesign.Radius.card))
}
