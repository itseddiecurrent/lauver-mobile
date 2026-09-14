import AuthenticationServices
import SwiftUI

struct StravaActivity: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let sport: String
    let startedAt: String
    let durationSeconds: Int
    let distanceMeters: Double
    var startDate: Date? { StravaDate.parse(startedAt) }
}

enum StravaDate {
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct StravaStatus: Decodable, Equatable {
    enum State: String, Decodable { case disabled, disconnected, connected, revocationPending = "revocation_pending", reconnectRequired = "reconnect_required" }
    let status: State
    let athleteName: String?
    let lastSyncedAt: String?
    let scopes: [String]
    let activities: [StravaActivity]
    static let disconnected = StravaStatus(status: .disconnected, athleteName: nil, lastSyncedAt: nil, scopes: [], activities: [])
}

struct StravaStart: Decodable {
    let authorizationURL: URL
    let state: String
    let expiresIn: Int

    func validate() throws {
        let url = authorizationURL
        guard url.scheme == "https", url.host == "www.strava.com", url.path == "/oauth/mobile/authorize",
              url.user == nil, url.password == nil, url.fragment == nil,
              state.count == 43, state.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.filter({ $0.name == "state" }).map(\.value) == [state],
              components.queryItems?.filter({ $0.name == "scope" }).map(\.value) == ["read,activity:read"] else {
            throw StravaConnectionError.invalidCallback
        }
    }

    func callbackResult(_ url: URL) throws -> String {
        guard url.scheme == "lauver", url.host == "oauth", url.path == "/strava", url.user == nil, url.password == nil,
              url.fragment == nil, let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              query.count == 2, query.filter({ $0.name == "state" }).map(\.value) == [state],
              let result = query.first(where: { $0.name == "result" })?.value,
              ["connected", "connected_sync_failed", "cancelled", "scope_missing", "authorization_failed"].contains(result) else {
            throw StravaConnectionError.invalidCallback
        }
        return result
    }
}

protocol StravaServicing {
    func stravaStatus() async throws -> StravaStatus
    func startStrava() async throws -> StravaStart
    func syncStrava() async throws -> StravaStatus
    func disconnectStrava() async throws -> StravaStatus
}

enum StravaConnectionError: LocalizedError {
    case cancelled, invalidCallback, noWindow, scopeMissing, authorizationFailed
    var errorDescription: String? {
        switch self {
        case .cancelled: "Strava connection was cancelled."
        case .invalidCallback: "This Strava connection response could not be verified. Start again."
        case .noWindow: "Strava authorization could not open. Please try again."
        case .scopeMissing: "Strava needs read access to your activities. Connect again and allow activity access."
        case .authorizationFailed: "Strava authorization failed or expired. Please connect again."
        }
    }
}

@MainActor
protocol StravaAuthorizing {
    func authorize(_ flow: StravaStart) async throws -> URL
}

@MainActor
final class StravaWebAuthorization: NSObject, StravaAuthorizing, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var anchor: ASPresentationAnchor?
    func authorize(_ flow: StravaStart) async throws -> URL {
        try flow.validate()
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow) else {
            throw StravaConnectionError.noWindow
        }
        guard session == nil else { throw StravaConnectionError.noWindow }
        anchor = window
        return try await withCheckedThrowingContinuation { continuation in
            let webSession = ASWebAuthenticationSession(url: flow.authorizationURL, callbackURLScheme: "lauver") { [weak self] url, error in
                Task { @MainActor in
                    self?.session = nil
                    self?.anchor = nil
                    if let url { continuation.resume(returning: url) }
                    else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                        continuation.resume(throwing: StravaConnectionError.cancelled)
                    } else { continuation.resume(throwing: StravaConnectionError.authorizationFailed) }
                }
            }
            webSession.presentationContextProvider = self
            webSession.prefersEphemeralWebBrowserSession = true
            session = webSession
            if !webSession.start() {
                session = nil; anchor = nil
                continuation.resume(throwing: StravaConnectionError.noWindow)
            }
        }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor ?? ASPresentationAnchor()
    }
}

extension Notification.Name {
    static let stravaConnectionChanged = Notification.Name("lauver.stravaConnectionChanged")
}

@MainActor
final class StravaViewModel: ObservableObject {
    @Published private(set) var connection: StravaStatus?
    @Published private(set) var isWorking = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var notice: String?
    private let service: any StravaServicing
    private let authorizer: any StravaAuthorizing
    init(service: any StravaServicing, authorizer: (any StravaAuthorizing)? = nil) {
        self.service = service; self.authorizer = authorizer ?? StravaWebAuthorization()
    }
    func load() async {
        await perform { self.connection = try await self.service.stravaStatus() }
    }
    func refresh() async {
        await perform {
            do { self.connection = try await self.service.syncStrava() }
            catch {
                // Fetch the authoritative status after invalid authorization or a lost response.
                if let status = try? await self.service.stravaStatus() {
                    self.connection = status
                    NotificationCenter.default.post(name: .stravaConnectionChanged, object: nil)
                }
                throw error
            }
            NotificationCenter.default.post(name: .stravaConnectionChanged, object: nil)
        }
    }
    func connect() async {
        await perform {
            let flow = try await self.service.startStrava()
            try flow.validate()
            let url = try await self.authorizer.authorize(flow)
            let result = try flow.callbackResult(url)
            self.connection = try await self.service.stravaStatus()
            NotificationCenter.default.post(name: .stravaConnectionChanged, object: nil)
            switch result {
            case "scope_missing": throw StravaConnectionError.scopeMissing
            case "authorization_failed": throw StravaConnectionError.authorizationFailed
            case "cancelled": self.notice = StravaConnectionError.cancelled.errorDescription
            case "connected_sync_failed": self.notice = "Strava responded. Check the connection status and refresh to load activities."
            default: break
            }
        }
    }
    func disconnect() async {
        await perform {
            do { self.connection = try await self.service.disconnectStrava() }
            catch {
                if let status = try? await self.service.stravaStatus() {
                    self.connection = status
                    NotificationCenter.default.post(name: .stravaConnectionChanged, object: nil)
                }
                throw error
            }
            NotificationCenter.default.post(name: .stravaConnectionChanged, object: nil)
        }
    }
    private func perform(_ operation: () async throws -> Void) async {
        guard !isWorking, !Task.isCancelled else { return }
        isWorking = true; errorMessage = nil; notice = nil
        defer { isWorking = false }
        do { try await operation() }
        catch StravaConnectionError.cancelled { notice = StravaConnectionError.cancelled.errorDescription }
        catch {
            guard !Task.isCancelled, !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return }
            errorMessage = (error as? APIError)?.userMessage ?? (error as? LocalizedError)?.errorDescription ?? "Strava could not complete this request. Please try again."
        }
    }
}

struct ConnectedAppsView: View {
    let service: any StravaServicing
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
                Text("Connect an app to see your recent workout summaries. Connecting is optional.").foregroundStyle(.secondary)
                safetyCard {
                    NavigationLink { StravaConnectionView(service: service) } label: {
                        Label("Strava", systemImage: "figure.run").frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityIdentifier("connected-apps-strava")
                }
            }.padding(LauverDesign.Spacing.large)
        }.background(LauverDesign.ColorToken.background).navigationTitle("Connected Apps")
    }
}

struct StravaConnectionView: View {
    @StateObject private var model: StravaViewModel
    @State private var confirmingDisconnect = false
    @Environment(\.scenePhase) private var scenePhase
    init(service: any StravaServicing) { _model = StateObject(wrappedValue: StravaViewModel(service: service)) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LauverDesign.Spacing.large) {
                Text("Read-only workout summaries").font(.title2.bold())
                Text("Allow Lauver to read your recent activities. We display titles, sports, dates, duration and distance. Routes and precise locations are not stored. Activities are visible only to you.")
                    .foregroundStyle(.secondary)
                if model.isWorking { ProgressView("Updating Strava") }
                if let connection = model.connection {
                    safetyCard {
                        switch connection.status {
                        case .disabled: Text("Strava connection is unavailable. Please try again later.")
                        case .disconnected:
                            Text("Not connected").accessibilityIdentifier("strava-disconnected")
                            Button("Connect Strava") { Task { await model.connect() } }.buttonStyle(SafetyPrimaryButtonStyle()).accessibilityIdentifier("strava-connect")
                        case .connected:
                            Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(LauverDesign.ColorToken.accent).accessibilityIdentifier("strava-connected")
                            if let name = connection.athleteName { Text(name).font(.headline) }
                            if let value = connection.lastSyncedAt, let date = StravaDate.parse(value) { Text("Last synced: \(date.formatted(date: .abbreviated, time: .shortened))").font(.footnote) }
                            Button("Refresh Activities") { Task { await model.refresh() } }.buttonStyle(SafetyPrimaryButtonStyle()).accessibilityIdentifier("strava-refresh")
                            disconnectButton
                        case .revocationPending:
                            Text("Disconnect pending").font(.headline).accessibilityIdentifier("strava-revocation-pending")
                            Text("Activity summaries have been removed. We will retry revoking Strava access automatically. You can also retry now.")
                            Button("Retry Disconnect") { Task { await model.disconnect() } }.buttonStyle(.bordered).accessibilityIdentifier("strava-retry-disconnect")
                            Button("Check Status") { Task { await model.load() } }.buttonStyle(.bordered)
                        case .reconnectRequired:
                            Text("Strava authorization expired or was revoked. Disconnect, then connect again.")
                            disconnectButton
                        }
                    }.disabled(model.isWorking)
                    if connection.status == .connected { StravaActivityList(activities: connection.activities) }
                }
                if let notice = model.notice { Text(notice).foregroundStyle(.secondary) }
                if let error = model.errorMessage {
                    Text(error).foregroundStyle(LauverDesign.ColorToken.danger).accessibilityIdentifier("strava-error")
                    Button("Check Connection") { Task { await model.load() } }.disabled(model.isWorking)
                }
            }.padding(LauverDesign.Spacing.large)
        }.background(LauverDesign.ColorToken.background).navigationTitle("Strava")
        .task { await model.load() }
        .refreshable { if model.connection?.status == .connected { await model.refresh() } else { await model.load() } }
        .onChange(of: scenePhase) { phase in if phase == .active { Task { await model.load() } } }
        .alert("Disconnect Strava?", isPresented: $confirmingDisconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This revokes Lauver’s Strava access and removes your cached activity summaries.") }
    }
    private var disconnectButton: some View {
        Button("Disconnect Strava", role: .destructive) { confirmingDisconnect = true }.accessibilityIdentifier("strava-disconnect")
    }
}

struct StravaActivityList: View {
    let activities: [StravaActivity]
    var body: some View {
        safetyCard {
            Text("Recent Strava activities").font(.headline)
            if activities.isEmpty { Text("No recent activities available with the granted read access.").foregroundStyle(.secondary) }
            ForEach(activities) { activity in
                VStack(alignment: .leading, spacing: LauverDesign.Spacing.small) {
                    Text(activity.title).font(.subheadline.bold())
                    Text(activity.sport).font(.caption).foregroundStyle(.secondary)
                    if let date = activity.startDate { Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption) }
                    Text("\(Double(activity.distanceMeters / 1000), specifier: "%.1f") km · \(activity.durationSeconds / 60) min").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.accessibilityIdentifier("strava-activities")
    }
}

struct OwnStravaActivitiesView: View {
    @StateObject private var model: StravaViewModel
    init(service: any StravaServicing) { _model = StateObject(wrappedValue: StravaViewModel(service: service)) }
    var body: some View {
        VStack(alignment: .leading, spacing: LauverDesign.Spacing.medium) {
            if let connection = model.connection, connection.status == .connected {
                StravaActivityList(activities: connection.activities)
                Button("Refresh Strava") { Task { await model.refresh() } }.disabled(model.isWorking)
            }
            if let error = model.errorMessage {
                Text(error).font(.footnote).foregroundStyle(LauverDesign.ColorToken.danger)
                Button("Retry Strava") { Task { await model.load() } }.disabled(model.isWorking)
            }
        }.task { await model.load() }
        .onReceive(NotificationCenter.default.publisher(for: .stravaConnectionChanged)) { _ in Task { await model.load() } }
    }
}
