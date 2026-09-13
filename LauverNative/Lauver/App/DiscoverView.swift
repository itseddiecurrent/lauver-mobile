import SwiftUI

struct DiscoverFilters: Equatable {
    var sport: WorkoutSport?
    var radius = 25
    var paceBracket: String?

    func path(cursor: String? = nil) -> String {
        var components = URLComponents()
        components.path = "/v1/discover"
        components.queryItems = [URLQueryItem(name: "radius", value: String(radius))]
        if let sport { components.queryItems?.append(URLQueryItem(name: "sport", value: sport.rawValue)) }
        if let paceBracket, sport != nil { components.queryItems?.append(URLQueryItem(name: "paceBracket", value: paceBracket)) }
        if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        return components.string!
    }
}

struct DiscoverUser: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let photoURL: URL?
    let city: ProfileCity
    let approximateDistanceKm: Int
    let sports: [ProfileSport]
    let commonSports: [WorkoutSport]
}

struct DiscoverPage: Decodable {
    let users: [DiscoverUser]
    let nextCursor: String?
}

protocol DiscoverServicing {
    func discover(filters: DiscoverFilters, cursor: String?) async throws -> DiscoverPage
}

@MainActor
final class DiscoverViewModel: ObservableObject {
    @Published private(set) var users: [DiscoverUser] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var requestID: String?
    @Published private(set) var nextCursor: String?
    @Published private(set) var filters = DiscoverFilters()
    private let service: any DiscoverServicing
    private var generation = 0

    init(service: any DiscoverServicing) { self.service = service }

    func apply(_ filters: DiscoverFilters) async {
        self.filters = filters
        users = []
        hasLoaded = false
        await load(refresh: true)
    }

    func load(refresh: Bool = true) async {
        if !refresh, isLoading || nextCursor == nil { return }
        // A refresh supersedes an in-flight page; its result must never append stale rows.
        generation += 1
        let requestGeneration = generation
        let cursor = refresh ? nil : nextCursor
        let requestedFilters = filters
        isLoading = true
        errorMessage = nil
        requestID = nil
        if refresh { nextCursor = nil }
        defer { if requestGeneration == generation { isLoading = false } }
        do {
            let page = try await service.discover(filters: requestedFilters, cursor: cursor)
            try Task.checkCancellation()
            guard requestGeneration == generation else { return }
            if refresh { users = page.users }
            else {
                let existing = Set(users.map(\.id))
                users.append(contentsOf: page.users.filter { !existing.contains($0.id) })
            }
            nextCursor = page.nextCursor
            hasLoaded = true
        } catch {
            guard requestGeneration == generation, !Task.isCancelled, !(error is CancellationError) else { return }
            if let apiError = error as? APIError {
                guard apiError != .transport(.cancelled) else { return }
                if case .validation(let code, _, _) = apiError, code == "invalid_discover_cursor" { nextCursor = nil }
                errorMessage = apiError.userMessage
                requestID = apiError.requestID
            } else { errorMessage = "Workout partners could not be loaded." }
        }
    }
}

struct DiscoverView: View {
    @StateObject private var viewModel: DiscoverViewModel
    @State private var showingFilters = false
    let profileService: any ProfileServicing

    init(service: any DiscoverServicing, profileService: any ProfileServicing) {
        _viewModel = StateObject(wrappedValue: DiscoverViewModel(service: service))
        self.profileService = profileService
    }

    var body: some View {
        List {
            Section {
                Text("Distances are approximate, based on city centres.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("\(viewModel.filters.sport?.title ?? "All sports") · Within \(viewModel.filters.radius) km\(viewModel.filters.paceBracket.map { " · \($0.capitalized) pace" } ?? "")")
                    .font(.subheadline)
                    .accessibilityIdentifier("discover-filter-summary")
            }
            if viewModel.isLoading && !viewModel.hasLoaded {
                LoadingStateView(title: "Finding workout partners")
            }
            if let error = viewModel.errorMessage {
                ErrorStateView(message: error, requestID: viewModel.requestID)
                RetryButton { Task { await viewModel.load(refresh: viewModel.nextCursor == nil) } }
            }
            if viewModel.hasLoaded && viewModel.users.isEmpty && !viewModel.isLoading && viewModel.errorMessage == nil {
                EmptyStateView(systemImage: "person.2", title: "No workout partners found", message: "Try a wider radius or adjust your sport and pace filters.")
            }
            ForEach(viewModel.users) { user in
                NavigationLink {
                    OtherProfileScreen(userID: user.id, service: profileService)
                } label: {
                    HStack(alignment: .top, spacing: LauverDesign.Spacing.medium) {
                        ProfileAvatar(photoURL: user.photoURL, size: 48)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(user.displayName).font(.headline)
                            Text("\(user.city.name) · About \(user.approximateDistanceKm) km")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Text(user.commonSports.isEmpty ? "No shared sports" : "Shared: \(user.commonSports.map(\.title).joined(separator: ", "))")
                                .font(.footnote)
                            ForEach(user.sports) { item in
                                if viewModel.filters.sport == nil || item.sport == viewModel.filters.sport {
                                    Text("\(item.sport.title)\(item.paceValue.map { " · \(item.sport.formattedPace($0)) \(item.sport.paceUnit) (self-reported)" } ?? " · Pace not provided")")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                .accessibilityIdentifier("discover-user-\(user.id)")
            }
            if viewModel.nextCursor != nil {
                Button(viewModel.isLoading ? "Loading…" : "Load more") {
                    Task { await viewModel.load(refresh: false) }
                }
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("discover-load-more")
            }
        }
        .navigationTitle("Discover")
        .accessibilityIdentifier("screen-discover")
        .toolbar {
            Button { showingFilters = true } label: { Label("Filters", systemImage: "line.3.horizontal.decrease") }
                .accessibilityIdentifier("discover-filters")
        }
        .task { if !viewModel.hasLoaded { await viewModel.load() } }
        .refreshable { await viewModel.load() }
        .sheet(isPresented: $showingFilters) {
            DiscoverFilterSheet(filters: viewModel.filters) { filters in
                Task { await viewModel.apply(filters) }
            }
        }
    }
}

private struct DiscoverFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var filters: DiscoverFilters
    let apply: (DiscoverFilters) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Picker("Sport", selection: $filters.sport) {
                    Text("All sports").tag(nil as WorkoutSport?)
                    ForEach(WorkoutSport.allCases) { Text($0.title).tag(Optional($0)) }
                }
                .accessibilityIdentifier("discover-sport")
                .onChange(of: filters.sport) { _, _ in filters.paceBracket = nil }
                Picker("Radius", selection: $filters.radius) {
                    ForEach([5, 10, 25, 50], id: \.self) { Text("\($0) km").tag($0) }
                }
                .accessibilityIdentifier("discover-radius")
                Picker("Self-reported pace", selection: $filters.paceBracket) {
                    Text("Any pace").tag(nil as String?)
                    ForEach(["easy", "moderate", "fast"], id: \.self) { Text($0.capitalized).tag(Optional($0)) }
                }
                .disabled(filters.sport == nil)
                .accessibilityIdentifier("discover-pace")
                Text("Select a sport to filter pace. Groups use fixed thresholds for that sport; profiles without a pace are excluded when a group is selected.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Reset filters") { filters = DiscoverFilters() }
            }
            .navigationTitle("Filters")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { apply(filters); dismiss() }.accessibilityIdentifier("discover-apply-filters")
                }
            }
        }
    }
}
