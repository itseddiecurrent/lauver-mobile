import PhotosUI
import SwiftUI

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var profile: WorkoutProfile?
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var requestID: String?

    private let service: any ProfileServicing

    init(service: any ProfileServicing) {
        self.service = service
    }

    func load() async {
        guard !Task.isCancelled, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        requestID = nil
        defer { isLoading = false }
        do {
            let loaded = try await service.getOwnProfile()
            try Task.checkCancellation()
            profile = loaded
        } catch {
            capture(error)
        }
    }

    func save(draft: ProfileDraft, photo: ProfilePhoto?) async -> Bool {
        guard !isSaving else { return false }
        isSaving = true
        errorMessage = nil
        requestID = nil
        defer { isSaving = false }
        do {
            profile = try await service.updateProfile(draft)
            if let photo {
                profile = try await service.uploadPhoto(photo)
            }
            return true
        } catch {
            capture(error)
            return false
        }
    }

    func deletePhoto() async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        requestID = nil
        defer { isSaving = false }
        do {
            try await service.deletePhoto()
            profile = try await service.getOwnProfile()
        } catch {
            capture(error)
        }
    }

    func showLocalError(_ message: String) {
        errorMessage = message
        requestID = nil
    }

    private func capture(_ error: Error) {
        // SwiftUI cancels view tasks when their views disappear. This is not a
        // connection failure and must not replace the saved profile with an error.
        guard !Task.isCancelled, !(error is CancellationError) else { return }
        if let urlError = error as? URLError, urlError.code == .cancelled { return }
        if let apiError = error as? APIError {
            guard apiError != .transport(.cancelled) else { return }
            errorMessage = apiError.userMessage
            requestID = apiError.requestID
        } else if let localized = error as? LocalizedError {
            errorMessage = localized.errorDescription ?? "The profile request failed."
            requestID = nil
        } else {
            errorMessage = "The profile request failed."
            requestID = nil
        }
    }
}

struct OwnProfileView: View {
    @StateObject private var viewModel: ProfileViewModel
    @State private var editingProfile: WorkoutProfile?
    let signOut: () -> Void

    init(service: any ProfileServicing, signOut: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: ProfileViewModel(service: service))
        self.signOut = signOut
    }

    var body: some View {
        // Keep .task attached to a stable container while loading/content changes.
        ZStack {
            if viewModel.isLoading, viewModel.profile == nil {
                LoadingStateView(title: "Loading your profile")
            } else if let profile = viewModel.profile {
                profileContent(profile)
            } else if let error = viewModel.errorMessage {
                VStack(spacing: LauverDesign.Spacing.medium) {
                    ErrorStateView(message: error, requestID: viewModel.requestID)
                    RetryButton { Task { await viewModel.load() } }
                }
                .padding()
            } else {
                EmptyStateView(
                    systemImage: "person.crop.circle",
                    title: "Build your workout profile",
                    message: "Add a sport, city, and preferred training time."
                )
            }
        }
        .navigationTitle("Profile")
        .accessibilityIdentifier("screen-profile")
        .task { await viewModel.load() }
        .sheet(item: $editingProfile) { profile in
            EditProfileView(profile: profile, viewModel: viewModel)
        }
    }

    private func profileContent(_ profile: WorkoutProfile) -> some View {
        ScrollView {
            VStack(spacing: LauverDesign.Spacing.large) {
                ProfileAvatar(photoURL: profile.photoURL, size: 112)

                VStack(spacing: LauverDesign.Spacing.small) {
                    Text(profile.displayName ?? "Your workout profile")
                        .font(.title2.bold())
                        .accessibilityIdentifier("profile-display-name")
                    if let city = profile.city {
                        Label("\(city.name), \(city.countryCode)", systemImage: "mappin.and.ellipse")
                            .foregroundStyle(.secondary)
                    }
                    Label(
                        profile.isComplete ? "Ready for Discover" : "Profile incomplete",
                        systemImage: profile.isComplete ? "checkmark.circle.fill" : "exclamationmark.circle"
                    )
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(profile.isComplete ? LauverDesign.ColorToken.accent : .orange)
                    .accessibilityIdentifier("profile-completeness")
                }

                if let bio = profile.bio {
                    ProfileSection(title: "About") { Text(bio).frame(maxWidth: .infinity, alignment: .leading) }
                }

                ProfileSection(title: "Sports") {
                    if profile.sports.isEmpty {
                        Text("No sports selected").foregroundStyle(.secondary)
                    } else {
                        VStack(alignment: .leading, spacing: LauverDesign.Spacing.small) {
                            ForEach(profile.sports) { sport in
                                HStack {
                                    Text(sport.sport.title).fontWeight(.semibold)
                                    Spacer()
                                    if let pace = sport.paceValue, let unit = sport.paceUnit {
                                        Text("\(sport.sport.formattedPace(pace)) \(unit)").foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }

                ProfileSection(title: "Preferred training times") {
                    if profile.trainingTimes.isEmpty {
                        Text("No times selected").foregroundStyle(.secondary)
                    } else {
                        Text(trainingSummary(profile.trainingTimes))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                if let error = viewModel.errorMessage {
                    ErrorStateView(message: error, requestID: viewModel.requestID)
                }

                Button("Edit Profile") { editingProfile = profile }
                    .buttonStyle(.borderedProminent)
                    .tint(LauverDesign.ColorToken.accent)
                    .accessibilityIdentifier("profile-edit")

                Button("Sign Out", action: signOut)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("auth-sign-out")
            }
            .padding(LauverDesign.Spacing.large)
        }
        .refreshable { await viewModel.load() }
    }
}

private struct EditProfileView: View {
    let profile: WorkoutProfile
    @ObservedObject var viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProfileDraft
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var selectedPhoto: ProfilePhoto?
    @State private var selectedPhotoImage: Image?
    @State private var currentPhotoURL: URL?
    @State private var showingCitySearch = false

    init(profile: WorkoutProfile, viewModel: ProfileViewModel) {
        self.profile = profile
        self.viewModel = viewModel
        _draft = State(initialValue: ProfileDraft(profile: profile))
        _currentPhotoURL = State(initialValue: profile.photoURL)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Photo") {
                    HStack(spacing: LauverDesign.Spacing.medium) {
                        if let selectedPhotoImage {
                            selectedPhotoImage
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(Circle())
                        } else {
                            ProfileAvatar(photoURL: currentPhotoURL, size: 72)
                        }
                        PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                            Label(currentPhotoURL == nil ? "Choose photo" : "Replace photo", systemImage: "photo")
                        }
                        .accessibilityIdentifier("profile-photo-picker")
                    }
                    if currentPhotoURL != nil {
                        Button("Delete current photo", role: .destructive) {
                            Task {
                                await viewModel.deletePhoto()
                                if viewModel.profile?.photoURL == nil { currentPhotoURL = nil }
                            }
                        }
                        .disabled(viewModel.isSaving)
                        .accessibilityIdentifier("profile-photo-delete")
                    }
                }

                Section("Basics") {
                    TextField("Display name", text: $draft.displayName)
                        .textContentType(.name)
                        .accessibilityIdentifier("profile-name-field")
                    TextField("Short bio", text: $draft.bio, axis: .vertical)
                        .lineLimit(3...6)
                        .accessibilityIdentifier("profile-bio-field")
                }

                Section("City") {
                    Button {
                        showingCitySearch = true
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(draft.city?.name ?? "Choose a city")
                                if let subtitle = draft.city?.subtitle, !subtitle.isEmpty {
                                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Image(systemName: "magnifyingglass")
                        }
                    }
                    .accessibilityIdentifier("profile-city-picker")
                }

                Section("Sports and self-reported pace") {
                    ForEach(WorkoutSport.allCases) { sport in
                        VStack(alignment: .leading, spacing: LauverDesign.Spacing.small) {
                            Toggle(sport.title, isOn: binding(for: sport))
                            if draft.selectedSports.contains(sport) {
                                HStack {
                                    TextField(sport.usesDurationPace ? "mm:ss (optional)" : "km/h (optional)", text: paceBinding(for: sport))
                                        .keyboardType(sport.usesDurationPace ? .numbersAndPunctuation : .decimalPad)
                                        .autocorrectionDisabled()
                                        .accessibilityIdentifier("profile-pace-\(sport.rawValue)")
                                    Text(sport.paceUnit).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Section("Preferred training times") {
                    ForEach(1...7, id: \.self) { weekday in
                        VStack(alignment: .leading, spacing: LauverDesign.Spacing.small) {
                            Text(weekdayName(weekday)).font(.subheadline.weight(.semibold))
                            HStack {
                                ForEach(TrainingTimeBucket.allCases) { bucket in
                                    let time = TrainingTime(weekday: weekday, timeBucket: bucket)
                                    Button(bucket.title) { toggle(time) }
                                        .buttonStyle(.bordered)
                                        .tint(draft.trainingTimes.contains(time) ? LauverDesign.ColorToken.accent : .secondary)
                                }
                            }
                        }
                    }
                }

                if let error = viewModel.errorMessage {
                    Section {
                        ErrorStateView(
                            message: error,
                            requestID: viewModel.requestID,
                            title: "Couldn't save profile",
                            systemImage: "exclamationmark.circle"
                        )
                    }
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(viewModel.isSaving ? "Saving…" : "Save") {
                        Task {
                            if await viewModel.save(draft: draft, photo: selectedPhoto) { dismiss() }
                        }
                    }
                    .disabled(viewModel.isSaving)
                    .accessibilityIdentifier("profile-save")
                }
            }
            .sheet(isPresented: $showingCitySearch) {
                CitySearchView { city in
                    draft.city = city
                    showingCitySearch = false
                }
            }
            .onChange(of: selectedPhotoItem) { _, item in
                guard let item else { return }
                Task {
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self) else {
                            throw ProfilePhotoError.invalidImage
                        }
                        let photo = try ProfilePhoto.processedJPEG(from: data)
                        selectedPhoto = photo
                        if let image = UIImage(data: photo.data) { selectedPhotoImage = Image(uiImage: image) }
                    } catch {
                        viewModel.showLocalError((error as? LocalizedError)?.errorDescription ?? "Photo selection failed.")
                    }
                }
            }
        }
    }

    private func binding(for sport: WorkoutSport) -> Binding<Bool> {
        Binding(
            get: { draft.selectedSports.contains(sport) },
            set: { selected in
                if selected { draft.selectedSports.insert(sport) }
                else {
                    draft.selectedSports.remove(sport)
                    draft.paceValues[sport] = nil
                }
            }
        )
    }

    private func paceBinding(for sport: WorkoutSport) -> Binding<String> {
        Binding(
            get: { draft.paceValues[sport] ?? "" },
            set: { draft.paceValues[sport] = $0 }
        )
    }

    private func toggle(_ time: TrainingTime) {
        if draft.trainingTimes.contains(time) { draft.trainingTimes.remove(time) }
        else { draft.trainingTimes.insert(time) }
    }
}

private struct CitySearchView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var search = CitySearchModel()
    @State private var resolving = false
    @State private var errorMessage: String?
    let selection: (ProfileCity) -> Void

    var body: some View {
        NavigationStack {
            List(search.results, id: \.self) { result in
                Button {
                    resolving = true
                    Task {
                        do { selection(try await search.resolve(result)) }
                        catch {
                            errorMessage = (error as? LocalizedError)?.errorDescription ?? "City selection failed."
                            resolving = false
                        }
                    }
                } label: {
                    VStack(alignment: .leading) {
                        Text(result.title)
                        Text(result.subtitle).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .disabled(resolving)
            }
            .overlay {
                if resolving { ProgressView("Resolving city…") }
                else if search.query.isEmpty {
                    ContentUnavailableView("Search for a city", systemImage: "building.2")
                }
            }
            .searchable(text: $search.query, prompt: "City name")
            .navigationTitle("Choose City")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .alert("City Search", isPresented: Binding(
                get: { errorMessage != nil || search.errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? search.errorMessage ?? "City search failed.")
            }
        }
    }
}

struct OtherProfileView: View {
    let profile: WorkoutProfile

    var body: some View {
        ScrollView {
            VStack(spacing: LauverDesign.Spacing.large) {
                ProfileAvatar(photoURL: profile.photoURL, size: 112)
                Text(profile.displayName ?? "Workout partner").font(.title2.bold())
                if let city = profile.city {
                    Label("\(city.name), \(city.countryCode)", systemImage: "mappin.and.ellipse")
                }
                if let bio = profile.bio { Text(bio).frame(maxWidth: .infinity, alignment: .leading) }
                ProfileSection(title: "Sports") {
                    ForEach(profile.sports) { sport in
                        Text(sport.sport.title)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Profile")
    }
}

@MainActor
private final class OtherProfileViewModel: ObservableObject {
    @Published private(set) var profile: WorkoutProfile?
    @Published private(set) var isLoading = false
    @Published private(set) var error: APIError?
    private let userID: String
    private let service: any ProfileServicing

    init(userID: String, service: any ProfileServicing) {
        self.userID = userID
        self.service = service
    }

    func load() async {
        guard !Task.isCancelled, !isLoading else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let loaded = try await service.getProfile(userID: userID)
            try Task.checkCancellation()
            profile = loaded
            error = nil
        } catch let apiError as APIError {
            guard !Task.isCancelled, apiError != .transport(.cancelled) else { return }
            error = apiError
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            self.error = .transport(.unknown)
        }
    }
}

struct OtherProfileScreen: View {
    @StateObject private var viewModel: OtherProfileViewModel

    init(userID: String, service: any ProfileServicing) {
        _viewModel = StateObject(wrappedValue: OtherProfileViewModel(userID: userID, service: service))
    }

    var body: some View {
        ZStack {
            if let profile = viewModel.profile {
                OtherProfileView(profile: profile)
            } else if viewModel.isLoading {
                LoadingStateView(title: "Loading profile")
            } else if let error = viewModel.error {
                VStack(spacing: LauverDesign.Spacing.medium) {
                    ErrorStateView(message: error.userMessage, requestID: error.requestID)
                    RetryButton { Task { await viewModel.load() } }
                }
                .padding()
            } else {
                LoadingStateView(title: "Loading profile")
            }
        }
        .navigationTitle("Profile")
        .task { await viewModel.load() }
    }
}

struct ProfileAvatar: View {
    let photoURL: URL?
    let size: CGFloat

    var body: some View {
        AsyncImage(url: photoURL) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else { Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.secondary) }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityIdentifier("profile-photo")
    }
}

private struct ProfileSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: LauverDesign.Spacing.small) {
            Text(title).font(.headline)
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LauverDesign.ColorToken.surface, in: RoundedRectangle(cornerRadius: LauverDesign.Radius.card))
    }
}

private func weekdayName(_ weekday: Int) -> String {
    let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return names.indices.contains(weekday - 1) ? names[weekday - 1] : "Day \(weekday)"
}

private func trainingSummary(_ times: [TrainingTime]) -> String {
    Dictionary(grouping: times, by: \.weekday)
        .sorted { $0.key < $1.key }
        .map { weekday, values in
            "\(weekdayName(weekday)): \(values.map(\.timeBucket.title).sorted().joined(separator: ", "))"
        }
        .joined(separator: "\n")
}
