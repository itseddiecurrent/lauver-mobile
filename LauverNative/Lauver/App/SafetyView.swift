import SwiftUI

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
    let service: any SafetyServicing
    let stravaService: any StravaServicing
    let healthUploader: (any HealthWorkoutUploading)?
    let signOut: () -> Void
    init(service: any SafetyServicing, stravaService: any StravaServicing, healthUploader: (any HealthWorkoutUploading)? = nil, signOut: @escaping () -> Void) { self.service = service; self.stravaService = stravaService; self.healthUploader = healthUploader; self.signOut = signOut }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
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
                Button("Sign Out", role: .destructive, action: signOut).accessibilityIdentifier("settings-sign-out")
            }.padding(LauverDesign.Spacing.large)
        }.background(LauverDesign.ColorToken.background).navigationTitle("Settings")
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
