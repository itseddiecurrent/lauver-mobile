import SwiftUI

struct DiscoverFilters: Equatable {
    var sport: WorkoutSport?
    var radius: Int? = 25

    var radiusTitle: String { radius.map { "Within \($0) km" } ?? "Unlimited distance" }
    var paceMin: Double?
    var paceMax: Double?

    var paceTitle: String? {
        guard let sport, paceMin != nil || paceMax != nil else { return nil }
        if let paceMin, let paceMax {
            return "\(sport.formattedPace(paceMin))–\(sport.formattedPace(paceMax)) \(sport.paceUnit)"
        }
        if let paceMin { return "From \(sport.formattedPace(paceMin)) \(sport.paceUnit)" }
        return paceMax.map { "Up to \(sport.formattedPace($0)) \(sport.paceUnit)" }
    }

    func path(cursor: String? = nil) -> String {
        var components = URLComponents()
        components.path = "/v1/discover"
        components.queryItems = [URLQueryItem(name: "radius", value: radius.map(String.init) ?? "unlimited")]
        if let sport { components.queryItems?.append(URLQueryItem(name: "sport", value: sport.rawValue)) }
        if sport != nil {
            if let paceMin { components.queryItems?.append(URLQueryItem(name: "paceMin", value: String(paceMin))) }
            if let paceMax { components.queryItems?.append(URLQueryItem(name: "paceMax", value: String(paceMax))) }
        }
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

    func hideBlockedUser(_ userID: String) {
        generation += 1
        isLoading = false
        users.removeAll { $0.id == userID }
        nextCursor = nil
    }

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
    let safetyService: any SafetyServicing

    init(service: any DiscoverServicing, profileService: any ProfileServicing, safetyService: any SafetyServicing) {
        _viewModel = StateObject(wrappedValue: DiscoverViewModel(service: service))
        self.profileService = profileService
        self.safetyService = safetyService
    }

    var body: some View {
        List {
            Section {
                Text("Distances are approximate, based on city centres.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("\(viewModel.filters.sport?.title ?? "All sports") · \(viewModel.filters.radiusTitle)\(viewModel.filters.paceTitle.map { " · \($0)" } ?? "")")
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
                    OtherProfileScreen(userID: user.id, service: profileService, safetyService: safetyService)
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
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
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
        .onReceive(NotificationCenter.default.publisher(for: .safetyPolicyChanged)) { notification in
            if let userID = notification.userInfo?["blockedUserID"] as? String { viewModel.hideBlockedUser(userID) }
            Task { await viewModel.load() }
        }
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
    @State private var paceFrom: String
    @State private var paceTo: String
    let apply: (DiscoverFilters) -> Void

    init(filters: DiscoverFilters, apply: @escaping (DiscoverFilters) -> Void) {
        _filters = State(initialValue: filters)
        _paceFrom = State(initialValue: filters.paceMin.flatMap { filters.sport?.formattedPace($0) } ?? "")
        _paceTo = State(initialValue: filters.paceMax.flatMap { filters.sport?.formattedPace($0) } ?? "")
        self.apply = apply
    }

    private var paceError: String? {
        guard let sport = filters.sport else { return nil }
        let from = paceFrom.trimmingCharacters(in: .whitespacesAndNewlines)
        let to = paceTo.trimmingCharacters(in: .whitespacesAndNewlines)
        for text in [from, to] where !text.isEmpty {
            guard let value = sport.parsedPace(text) else {
                return "Enter \(sport.usesDurationPace ? "mm:ss" : "a number") in \(sport.paceInputUnit)."
            }
            guard sport.allowedPaceRange.contains(value) else {
                return "Use values between \(sport.formattedPace(sport.allowedPaceRange.lowerBound)) and \(sport.formattedPace(sport.allowedPaceRange.upperBound)) \(sport.paceUnit)."
            }
        }
        if let low = sport.parsedPace(from), let high = sport.parsedPace(to), low > high {
            return "From must be less than or equal to To."
        }
        return nil
    }

    private func clearPace() {
        filters.paceMin = nil
        filters.paceMax = nil
        paceFrom = ""
        paceTo = ""
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Sport", selection: $filters.sport) {
                    Text("All sports").tag(nil as WorkoutSport?)
                    ForEach(WorkoutSport.allCases) { Text($0.title).tag(Optional($0)) }
                }
                .accessibilityIdentifier("discover-sport")
                .onChange(of: filters.sport) { _, _ in clearPace() }
                Picker("Radius", selection: $filters.radius) {
                    ForEach([5, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100], id: \.self) {
                        Text("\($0) km").tag(Optional($0))
                    }
                    Text("Unlimited").tag(nil as Int?)
                }
                .accessibilityIdentifier("discover-radius")
                if let sport = filters.sport {
                    Section("Self-reported \(sport.usesDurationPace ? "pace" : "speed") (\(sport.paceInputUnit))") {
                        TextField("From", text: $paceFrom)
                            .keyboardType(sport.usesDurationPace ? .numbersAndPunctuation : .decimalPad)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("discover-pace-min")
                        TextField("To", text: $paceTo)
                            .keyboardType(sport.usesDurationPace ? .numbersAndPunctuation : .decimalPad)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("discover-pace-max")
                        Text("Leave either end blank for no limit. Both ends are included; profiles without a self-reported value are excluded when a range is set.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if let error = paceError {
                            Text(error).foregroundStyle(.red).accessibilityIdentifier("discover-pace-error")
                        }
                    }
                } else {
                    Text("Choose a sport to set a pace or speed range.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button("Reset filters") { filters = DiscoverFilters(); clearPace() }
            }
            .navigationTitle("Filters")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        filters.paceMin = filters.sport?.parsedPace(paceFrom)
                        filters.paceMax = filters.sport?.parsedPace(paceTo)
                        apply(filters)
                        dismiss()
                    }
                    .disabled(paceError != nil)
                    .accessibilityIdentifier("discover-apply-filters")
                }
            }
        }
    }
}
