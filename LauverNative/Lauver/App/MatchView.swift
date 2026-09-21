import SwiftUI
import StreamChat

struct MatchCandidate: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let photoURL: URL?
    let photos: [ProfilePhotoReference]
    let city: MatchCity?
    let approximateDistanceKm: Int?
    let sports: [ProfileSport]
    let commonSports: [WorkoutSport]

    enum CodingKeys: String, CodingKey { case id, displayName, photoURL, photos, city, approximateDistanceKm, sports, commonSports }

    init(id: String, displayName: String, photoURL: URL?, photos: [ProfilePhotoReference] = [], city: MatchCity?, approximateDistanceKm: Int?, sports: [ProfileSport], commonSports: [WorkoutSport]) {
        self.id = id
        self.displayName = displayName
        self.photoURL = photoURL
        self.photos = photos
        self.city = city
        self.approximateDistanceKm = approximateDistanceKm
        self.sports = sports
        self.commonSports = commonSports
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        displayName = try container.decode(String.self, forKey: .displayName)
        photoURL = try container.decodeIfPresent(URL.self, forKey: .photoURL)
        photos = try container.decodeIfPresent([ProfilePhotoReference].self, forKey: .photos) ?? []
        city = try container.decodeIfPresent(MatchCity.self, forKey: .city)
        approximateDistanceKm = try container.decodeIfPresent(Int.self, forKey: .approximateDistanceKm)
        sports = try container.decodeIfPresent([ProfileSport].self, forKey: .sports) ?? []
        commonSports = try container.decodeIfPresent([WorkoutSport].self, forKey: .commonSports) ?? []
    }
}

struct MatchCity: Decodable, Equatable {
    let name: String
    let regionCode: String?
    let countryCode: String
}

struct MatchPage: Decodable { let users: [MatchCandidate]; let nextCursor: String? }
struct SwipeResult: Decodable { let direction: String; let matched: Bool; let matchId: String? }
struct MatchSummary: Decodable, Identifiable, Equatable {
    let id: String
    let matchedAt: String
    let user: MatchCandidate
}

struct MatchConversationPreview: Equatable {
    let lastMessage: String?
    let unreadCount: Int
}

struct MatchFilters: Codable, Equatable {
    var preferredGender = "all"
    var maxDistanceKm: Int?
    var sports: Set<WorkoutSport> = []

    var title: String {
        let distance = maxDistanceKm.map { "Within \($0) km" } ?? "Any distance"
        let sport = sports.isEmpty ? "All sports" : sports.map(\.title).sorted().joined(separator: ", ")
        return "\(distance) · \(sport)"
    }
}

protocol MatchServicing {
    func preferences() async throws -> MatchPreferences
    func updatePreferences(_ filters: MatchFilters, visibleInMatch: Bool) async throws -> MatchPreferences
    func candidates(filters: MatchFilters, cursor: String?) async throws -> MatchPage
    func swipe(targetUserID: String, direction: String) async throws -> SwipeResult
    func matches() async throws -> [MatchSummary]
    func unmatch(id: String) async throws
}

@MainActor
final class MatchViewModel: ObservableObject {
    @Published private(set) var candidates: [MatchCandidate] = []
    @Published private(set) var matches: [MatchSummary] = []
    @Published private(set) var filters: MatchFilters
    @Published private(set) var isLoading = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var hasLoaded = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var requestID: String?
    @Published var toast: MatchSummary?
    @Published var needsOnboarding = false
    @Published private(set) var needsProfileLocation = false
    private let service: any MatchServicing
    private let profileService: (any ProfileServicing)?
    private let filterStore: any MatchFilterStoring
    private var nextCursor: String?
    private var generation = 0

    init(service: any MatchServicing, profileService: (any ProfileServicing)? = nil, filterStore: any MatchFilterStoring = UIStateStore()) {
        self.service = service
        self.profileService = profileService
        self.filterStore = filterStore
        if let data = filterStore.matchFiltersData, let saved = try? JSONDecoder().decode(MatchFilters.self, from: data) {
            filters = saved
        } else { filters = MatchFilters(maxDistanceKm: 25) }
    }

    func load() async {
        generation += 1; let request = generation
        isLoading = true; errorMessage = nil; requestID = nil
        needsProfileLocation = false
        defer { if request == generation { isLoading = false } }
        do {
            if let profileService {
                let profile = try await profileService.getOwnProfile()
                try Task.checkCancellation()
                guard request == generation else { return }
                if profile.needsLocationForDiscovery {
                    candidates = []
                    matches = []
                    nextCursor = nil
                    hasLoaded = true
                    needsOnboarding = false
                    needsProfileLocation = true
                    return
                }
            }
            let prefs = try await service.preferences()
            guard request == generation else { return }
            needsOnboarding = !prefs.visibleInMatch
            if prefs.visibleInMatch {
                let page = try await service.candidates(filters: filters, cursor: nil)
                let loadedMatches = try await service.matches()
                guard request == generation else { return }
                candidates = page.users
                nextCursor = page.nextCursor
                matches = loadedMatches.sorted { $0.matchedAt > $1.matchedAt }
            }
            hasLoaded = true
        } catch { capture(error) }
    }

    func apply(_ filters: MatchFilters) async {
        self.filters = filters
        if let data = try? JSONEncoder().encode(filters) { filterStore.matchFiltersData = data }
        candidates = []; nextCursor = nil; hasLoaded = false
        generation += 1
        await load()
    }

    func enableMatch() async {
        isSubmitting = true; errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await service.updatePreferences(filters, visibleInMatch: true)
            needsOnboarding = false; await load()
        } catch { capture(error) }
    }

    func swipe(_ candidate: MatchCandidate, direction: String) async {
        guard !isSubmitting else { return }
        isSubmitting = true; errorMessage = nil
        defer { isSubmitting = false }
        do {
            let result = try await service.swipe(targetUserID: candidate.id, direction: direction)
            candidates.removeAll { $0.id == candidate.id }
            if result.matched, let matchID = result.matchId {
                let summary = MatchSummary(id: matchID, matchedAt: ISO8601DateFormatter().string(from: Date()), user: candidate)
                matches.insert(summary, at: 0); toast = summary
            }
        } catch { capture(error) }
    }

    func unmatch(_ match: MatchSummary) async {
        do { try await service.unmatch(id: match.id); matches.removeAll { $0.id == match.id } }
        catch { capture(error) }
    }

    private func capture(_ error: Error) {
        guard !Task.isCancelled else { return }
        if let api = error as? APIError { errorMessage = api.userMessage; requestID = api.requestID }
        else { errorMessage = "Match could not be loaded. Please try again." }
    }
}

struct MatchView: View {
    @EnvironmentObject private var chat: ChatConnection
    @StateObject private var model: MatchViewModel
    let profileService: any ProfileServicing
    let matchService: any MatchServicing
    let safetyService: any SafetyServicing
    let chatService: (any ChatServicing)?
    let filterStore: any MatchFilterStoring
    @State private var showingFilters = false
    @State private var conversationPreviews: [String: MatchConversationPreview] = [:]

    init(matchService: any MatchServicing, profileService: any ProfileServicing, safetyService: any SafetyServicing, chatService: (any ChatServicing)?, filterStore: any MatchFilterStoring) {
        self.matchService = matchService; self.profileService = profileService; self.safetyService = safetyService; self.chatService = chatService
        self.filterStore = filterStore
        _model = StateObject(wrappedValue: MatchViewModel(service: matchService, profileService: profileService, filterStore: filterStore))
    }

    var body: some View {
        Group {
            if model.needsProfileLocation { ProfileLocationRequiredView() }
            else if model.needsOnboarding { onboarding }
            else { matchContent }
        }
        .navigationTitle("Match")
        .toolbar { Button("Filters", systemImage: "line.3.horizontal.decrease") { showingFilters = true }.accessibilityIdentifier("match-filters") }
        .sheet(isPresented: $showingFilters) { MatchFilterSheet(filters: model.filters) { value in Task { await model.apply(value) } } }
        .sheet(item: $model.toast) { summary in MatchToast(summary: summary, chatService: chatService, safetyService: safetyService) }
        .task { await model.load() }
        .task(id: model.matches) { await refreshConversationPreviews() }
        .onAppear { Task { await refreshConversationPreviews() } }
        .onAppear {
            if model.needsProfileLocation { Task { await model.load() } }
        }
        .onChange(of: chat.locallyReadTargetUserIDs) { _, readTargets in
            for match in model.matches where readTargets.contains(match.user.id) {
                guard let preview = conversationPreviews[match.id], preview.unreadCount > 0 else { continue }
                conversationPreviews[match.id] = MatchConversationPreview(lastMessage: preview.lastMessage, unreadCount: 0)
            }
        }
        .refreshable { await model.load() }
        .accessibilityIdentifier("screen-match")
    }

    private var onboarding: some View {
        VStack(spacing: 20) {
            Image(systemName: "heart.circle.fill").font(.system(size: 56)).foregroundStyle(LauverDesign.ColorToken.accent)
            Text("Find your workout people").font(.title2.bold())
            Text("Match is opt-in. Choose who you want to meet, then browse compatible athletes.").multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button(model.isSubmitting ? "Joining…" : "Start matching") { Task { await model.enableMatch() } }.buttonStyle(LauverPrimaryButtonStyle()).disabled(model.isSubmitting).accessibilityIdentifier("match-start")
            if let error = model.errorMessage { ErrorStateView(message: error, requestID: model.requestID) }
        }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(LauverDesign.ColorToken.background).accessibilityIdentifier("screen-match")
    }

    private var matchContent: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text(model.filters.title).font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("match-filter-summary")
                if let error = model.errorMessage { ErrorStateView(message: error, requestID: model.requestID); RetryButton { Task { await model.load() } } }
                if model.isLoading && !model.hasLoaded { LoadingStateView(title: "Finding compatible athletes") }
                if let candidate = model.candidates.first {
                    MatchCandidateCard(candidate: candidate, isSubmitting: model.isSubmitting, onPass: { Task { await model.swipe(candidate, direction: "pass") } }, onLike: { Task { await model.swipe(candidate, direction: "like") } }, profile: { OtherProfileScreen(userID: candidate.id, service: profileService, safetyService: safetyService) })
                } else if model.hasLoaded && !model.isLoading && model.errorMessage == nil {
                    EmptyStateView(systemImage: "heart", title: "No more candidates", message: "Try changing your filters or check back later.")
                }
                if !model.matches.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Your Matches").font(.headline)
                        ForEach(model.matches) { match in
                            MatchRow(match: match, preview: conversationPreviews[match.id], chatService: chatService, safetyService: safetyService, onUnmatch: { Task { await model.unmatch(match) } })
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(18)
        }.background(LauverDesign.ColorToken.background).accessibilityIdentifier("screen-match")
    }

    @MainActor
    private func refreshConversationPreviews() async {
        guard !ProcessInfo.processInfo.arguments.contains("-ui-testing-authenticated"),
              !ProcessInfo.processInfo.arguments.contains("-ui-testing-auth-flow") else { return }
        guard let chatService, !model.matches.isEmpty else {
            conversationPreviews = [:]
            return
        }

        do {
            let client = try await chat.connect(service: chatService)
            var refreshed: [String: MatchConversationPreview] = [:]
            for match in model.matches {
                let channel = try await chatService.directChat(targetUserID: match.user.id)
                let controller = client.channelController(for: try ChannelId(cid: "\(channel.channelType):\(channel.channelId)"))
                try await synchronize(controller)
                guard let state = controller.channel else { continue }
                refreshed[match.id] = MatchConversationPreview(
                    lastMessage: state.latestMessages.first?.text,
                    unreadCount: chat.locallyReadChannelIDs.contains(channel.id) ? 0 : state.unreadCount.messages
                )
            }
            conversationPreviews = refreshed
        } catch {
            // Match rows remain usable when Stream is temporarily unavailable.
            conversationPreviews = [:]
        }
    }

    private func synchronize(_ controller: ChatChannelController) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.synchronize { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
    }
}

private struct MatchCandidateCard<Profile: View>: View {
    let candidate: MatchCandidate; let isSubmitting: Bool; let onPass: () -> Void; let onLike: () -> Void; let profile: () -> Profile
    @State private var dragOffset: CGFloat = 0
    @State private var selectedPhoto: ProfilePhotoReference?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                selectedPhoto = candidate.photos.first
            } label: {
                ProfileAvatar(photoURL: candidate.photos.first?.url ?? candidate.photoURL, size: 180)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("View \(candidate.displayName)'s profile photos")
            if candidate.photos.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(candidate.photos) { photo in
                            Button { selectedPhoto = photo } label: {
                                AsyncImage(url: photo.url) { image in image.resizable().scaledToFill() }
                                    placeholder: { Color.secondary.opacity(0.12) }
                                    .frame(width: 56, height: 56)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("View profile photo (photo.sortOrder + 1)")
                        }
                    }
                }
                .accessibilityIdentifier("match-photo-gallery")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(candidate.displayName).font(.title2.bold())
                if let city = candidate.city { Text("\(city.name) · \(candidate.approximateDistanceKm.map { "about \($0) km" } ?? "distance unavailable")").foregroundStyle(.secondary) }
                Text(candidate.sports.map(\.sport.title).joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button("Pass", systemImage: "xmark") { onPass() }.buttonStyle(LauverSecondaryButtonStyle()).disabled(isSubmitting).accessibilityIdentifier("match-pass")
                Button("Like", systemImage: "heart.fill") { onLike() }.buttonStyle(LauverPrimaryButtonStyle()).disabled(isSubmitting).accessibilityIdentifier("match-like")
            }
            NavigationLink("View Profile", destination: profile()).frame(maxWidth: .infinity).accessibilityIdentifier("match-view-profile")
        }
        .offset(x: dragOffset)
        .rotationEffect(.degrees(Double(dragOffset / 28)))
        .gesture(DragGesture(minimumDistance: 24).onChanged { value in
            guard !isSubmitting else { return }
            dragOffset = value.translation.width
        }.onEnded { value in
            guard !isSubmitting else { dragOffset = 0; return }
            if value.translation.width > 120 { onLike() }
            else if value.translation.width < -120 { onPass() }
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { dragOffset = 0 }
        })
        .padding(16).background(LauverDesign.ColorToken.surface, in: RoundedRectangle(cornerRadius: 20))
        .accessibilityHint("Swipe right to Like or swipe left to Pass. Buttons below provide the same actions.")
        .fullScreenCover(item: $selectedPhoto) { photo in
            MatchPhotoViewer(photos: candidate.photos, initialPhoto: photo)
        }
    }
}

private struct MatchPhotoViewer: View {
    @Environment(\.dismiss) private var dismiss
    let photos: [ProfilePhotoReference]
    let initialPhoto: ProfilePhotoReference
    @State private var selectedID: String

    init(photos: [ProfilePhotoReference], initialPhoto: ProfilePhotoReference) {
        self.photos = photos
        self.initialPhoto = initialPhoto
        _selectedID = State(initialValue: initialPhoto.id)
    }

    var body: some View {
        NavigationStack {
            TabView(selection: $selectedID) {
                ForEach(photos) { photo in
                    AsyncImage(url: photo.url) { phase in
                        if let image = phase.image { image.resizable().scaledToFit() }
                        else if phase.error != nil { Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary) }
                        else { ProgressView() }
                    }
                    .tag(photo.id)
                    .padding()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .background(Color.black)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .accessibilityIdentifier("match-photo-viewer")
    }
}

private struct MatchRow: View {
    let match: MatchSummary; let preview: MatchConversationPreview?; let chatService: (any ChatServicing)?; let safetyService: any SafetyServicing; let onUnmatch: () -> Void
    @State private var confirming = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ProfileAvatar(photoURL: match.user.photoURL, size: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text(match.user.displayName).font(.headline)
                    if let lastMessage = preview?.lastMessage, !lastMessage.isEmpty {
                        Text(lastMessage).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            .accessibilityIdentifier("match-last-message-\(match.id)")
                    } else {
                        Text("No messages yet").font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("match-last-message-\(match.id)")
                    }
                }
                Spacer()
                if let unreadCount = preview?.unreadCount, unreadCount > 0 {
                    Text(unreadCount > 99 ? "99+" : "\(unreadCount)")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(LauverDesign.ColorToken.accent, in: Capsule())
                        .accessibilityLabel("\(unreadCount) unread messages")
                        .accessibilityIdentifier("match-unread-\(match.id)")
                }
                if let chatService { NavigationLink { DirectConversationView(service: chatService, safetyService: safetyService, targetUserID: match.user.id) } label: { Image(systemName: "message.fill") }.accessibilityLabel("Message \(match.user.displayName)") }
                Button { confirming = true } label: { Image(systemName: "ellipsis") }.accessibilityLabel("More options").accessibilityIdentifier("match-more-\(match.id)")
            }
            if confirming {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Unmatch \(match.user.displayName)?").font(.subheadline.bold())
                    Text("You will no longer be able to message each other.").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Unmatch", role: .destructive, action: onUnmatch)
                        Button("Cancel") { confirming = false }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LauverDesign.ColorToken.surface, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityIdentifier("match-unmatch-confirmation")
            }
        }
        .padding(.vertical, 6)
    }
}

private struct MatchToast: View {
    let summary: MatchSummary; let chatService: (any ChatServicing)?; let safetyService: any SafetyServicing
    @Environment(\.dismiss) private var dismiss
    var body: some View { VStack(spacing: 18) { Image(systemName: "heart.fill").font(.largeTitle).foregroundStyle(LauverDesign.ColorToken.accent); Text("It’s a Match!").font(.title.bold()); Text("You and \(summary.user.displayName) both liked each other.").multilineTextAlignment(.center); if let chatService { NavigationLink("Say Hi", destination: DirectConversationView(service: chatService, safetyService: safetyService, targetUserID: summary.user.id)).buttonStyle(LauverPrimaryButtonStyle()) }; Button("Keep browsing") { dismiss() }.buttonStyle(LauverSecondaryButtonStyle()) }.padding(28).presentationDetents([.medium]) }
}

private struct MatchFilterSheet: View {
    @Environment(\.dismiss) private var dismiss; @State var filters: MatchFilters; let apply: (MatchFilters) -> Void
    var body: some View { NavigationStack { Form { Picker("Interested in", selection: $filters.preferredGender) { Text("Everyone").tag("all"); Text("Men").tag("male"); Text("Women").tag("female"); Text("Other").tag("other") }.accessibilityIdentifier("match-gender"); Picker("Maximum distance", selection: $filters.maxDistanceKm) { Text("Any distance").tag(nil as Int?); ForEach([5,10,20,25,30,40,50,60,70,80,90,100], id: \.self) { Text("\($0) km").tag(Optional($0)) } }.accessibilityIdentifier("match-distance"); Section("Sports") { ForEach(WorkoutSport.allCases) { sport in Toggle(sport.title, isOn: Binding(get: { filters.sports.contains(sport) }, set: { if $0 { filters.sports.insert(sport) } else { filters.sports.remove(sport) } })) } } }.navigationTitle("Match filters").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Apply") { apply(filters); dismiss() }.accessibilityIdentifier("match-apply-filters") } } } }
}
