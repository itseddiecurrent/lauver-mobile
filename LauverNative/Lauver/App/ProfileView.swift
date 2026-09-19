import PhotosUI
import SwiftUI

struct ProfilePhotoEdit: Identifiable {
    var id: String
    var existing: ProfilePhotoReference?
    var replacementOf: String?
    var upload: ProfilePhoto?
    var uploadedPhotoID: String?
    var uploadError: String?
    var isUploading = false
}

struct ProfilePhotoSaveOutcome {
    let saved: Bool
    let edits: [ProfilePhotoEdit]
}

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

    func save(draft: ProfileDraft, photos: [ProfilePhoto]) async -> Bool {
        let edits = photos.map { photo in
            ProfilePhotoEdit(id: UUID().uuidString, existing: nil, replacementOf: nil, upload: photo)
        }
        return await save(draft: draft, photoEdits: edits)
    }

    func save(draft: ProfileDraft, photoEdits: [ProfilePhotoEdit]) async -> Bool {
        await savePhotoEdits(draft: draft, photoEdits: photoEdits).saved
    }

    func savePhotoEdits(
        draft: ProfileDraft,
        photoEdits: [ProfilePhotoEdit],
        retryOnlyID: String? = nil
    ) async -> ProfilePhotoSaveOutcome {
        guard !isSaving else { return ProfilePhotoSaveOutcome(saved: false, edits: photoEdits) }
        isSaving = true
        errorMessage = nil
        requestID = nil
        defer { isSaving = false }
        do {
            profile = try await service.updateProfile(draft)
            var edits = photoEdits
            let pending = edits.filter { edit in
                edit.upload != nil && edit.uploadedPhotoID == nil && (retryOnlyID == nil || edit.id == retryOnlyID)
            }
            let requests = pending.map { PhotoUploadRequest(clientID: $0.id, photo: $0.upload!) }
            let tickets = requests.isEmpty ? [] : try await service.createPhotoUploadTickets(requests)
            let ticketByID = Dictionary(uniqueKeysWithValues: tickets.map { ($0.clientID, $0) })
            for index in edits.indices where ticketByID[edits[index].id] != nil {
                edits[index].isUploading = true
                edits[index].uploadError = nil
            }

            var next = 0
            let concurrency = min(4, pending.count)
            await withTaskGroup(of: (String, Result<PhotoUploadResult, Error>).self) { group in
                func addNext() {
                    guard next < pending.count else { return }
                    let edit = pending[next]
                    next += 1
                    guard let ticket = ticketByID[edit.id], let photo = edit.upload else { return addNext() }
                    group.addTask {
                        do { return (edit.id, .success(try await self.service.uploadPhoto(photo, using: ticket))) }
                        catch { return (edit.id, .failure(error)) }
                    }
                }
                for _ in 0..<concurrency { addNext() }
                while let (editID, result) = await group.next() {
                    if let index = edits.firstIndex(where: { $0.id == editID }) {
                        edits[index].isUploading = false
                        switch result {
                        case let .success(upload):
                            edits[index].uploadedPhotoID = upload.photoID
                            edits[index].uploadError = upload.photoID == nil ? "Photo confirmation failed." : nil
                        case let .failure(error):
                            edits[index].uploadError = (error as? LocalizedError)?.errorDescription ?? "Photo upload failed."
                        }
                    }
                    addNext()
                }
            }

            let originalIDs = Set((profile?.photos ?? []).map(\.id))
            let retainedExistingIDs = Set(edits.compactMap { edit in
                if edit.uploadedPhotoID == nil { return edit.existing?.id ?? edit.replacementOf }
                return edit.existing?.id
            })
            let removedIDs = originalIDs.subtracting(retainedExistingIDs)
            for photoID in removedIDs {
                try await service.deletePhoto(photoID: photoID)
            }

            let orderedIDs = edits.compactMap { edit in
                edit.uploadedPhotoID ?? edit.existing?.id ?? (edit.uploadError != nil ? edit.replacementOf : nil)
            }
            if !orderedIDs.isEmpty {
                profile = try await service.reorderPhotos(orderedIDs)
            } else {
                profile = try await service.getOwnProfile()
            }

            if let freshProfile = profile {
                for index in edits.indices {
                    guard let photoID = edits[index].uploadedPhotoID,
                          let fresh = freshProfile.photos.first(where: { $0.id == photoID }) else { continue }
                    edits[index].id = fresh.id
                    edits[index].existing = fresh
                    edits[index].replacementOf = nil
                    edits[index].upload = nil
                    edits[index].uploadedPhotoID = nil
                }
            }
            let failed = edits.contains { $0.uploadError != nil }
            if failed { errorMessage = "Some photos could not be uploaded. Retry them individually." }
            return ProfilePhotoSaveOutcome(saved: !failed, edits: edits)
        } catch {
            capture(error)
            var failedEdits = photoEdits
            if error is APIError {
                for index in failedEdits.indices where failedEdits[index].upload != nil && failedEdits[index].uploadedPhotoID == nil {
                    failedEdits[index].isUploading = false
                    failedEdits[index].uploadError = (error as? APIError)?.userMessage ?? "Photo upload failed."
                }
                errorMessage = "Some photos could not be uploaded. Retry them individually."
            }
            return ProfilePhotoSaveOutcome(saved: false, edits: failedEdits)
        }
    }

    // Keep the original single-photo call shape source-compatible for callers
    // that predate the multi-photo editor.
    func save(draft: ProfileDraft, photo: ProfilePhoto) async -> Bool {
        await save(draft: draft, photos: [photo])
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
    @State private var showingPreview = false
    private let profileService: any ProfileServicing
    let signOut: () -> Void
    let accountDeletionService: any AccountDeletionServicing
    let safetyService: any SafetyServicing
    let stravaService: any StravaServicing
    let healthUploader: (any HealthWorkoutUploading)?

    init(service: any ProfileServicing, accountDeletionService: any AccountDeletionServicing, safetyService: any SafetyServicing, stravaService: any StravaServicing, healthUploader: (any HealthWorkoutUploading)? = nil, signOut: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: ProfileViewModel(service: service))
        self.profileService = service
        self.signOut = signOut
        self.accountDeletionService = accountDeletionService
        self.safetyService = safetyService
        self.stravaService = stravaService
        self.healthUploader = healthUploader
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
        .toolbarBackground(LauverDesign.ColorToken.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .accessibilityIdentifier("screen-profile")
        .toolbar {
            NavigationLink { SafetySettingsView(service: safetyService, profileService: profileService, stravaService: stravaService, accountDeletionService: accountDeletionService, healthUploader: healthUploader, signOut: signOut) } label: {
                Label("Settings", systemImage: "gearshape")
            }.accessibilityIdentifier("profile-settings")
        }
        .task { await viewModel.load() }
        .sheet(item: $editingProfile) { profile in
            EditProfileView(profile: profile, viewModel: viewModel)
        }
        .sheet(isPresented: $showingPreview) { ProfilePreviewScreen(service: profileService) }
    }

    private func profileContent(_ profile: WorkoutProfile) -> some View {
        ScrollView {
            VStack(spacing: LauverDesign.Spacing.large) {
                ProfileAvatar(photoURL: profile.photoURL, size: 112)
                if profile.photos.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: LauverDesign.Spacing.small) {
                            ForEach(profile.photos) { photo in
                                AsyncImage(url: photo.url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: { Color.secondary.opacity(0.12) }
                                .frame(width: 76, height: 76)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .accessibilityLabel(photo.isPrimary ? "Primary profile photo" : "Profile photo")
                            }
                        }
                    }
                }

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
                    .buttonStyle(LauverPrimaryButtonStyle())
                    .accessibilityIdentifier("profile-edit")

                Button("Preview My Profile") { showingPreview = true }
                    .buttonStyle(LauverSecondaryButtonStyle())
                    .accessibilityIdentifier("profile-preview")

                Button("Sign Out", action: signOut)
                    .buttonStyle(LauverSecondaryButtonStyle())
                    .accessibilityIdentifier("auth-sign-out")

                OwnStravaActivitiesView(service: stravaService)
            }
            .padding(LauverDesign.Spacing.large)
        }
        .refreshable { await viewModel.load() }
        .background(LauverDesign.ColorToken.background)
    }
}

private struct ProfilePreviewScreen: View {
    let service: any ProfileServicing
    @State private var profile: WorkoutProfile?
    @State private var error: String?

    var body: some View {
        Group {
            if let profile { OtherProfileView(profile: profile) }
            else if let error { ErrorStateView(message: error, requestID: nil) }
            else { LoadingStateView(title: "Loading preview") }
        }
        .task {
            do { profile = try await service.previewOwnProfile() }
            catch let caught { error = (caught as? LocalizedError)?.errorDescription ?? "Preview unavailable" }
        }
    }
}

private struct EditProfileView: View {
    let profile: WorkoutProfile
    @ObservedObject var viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProfileDraft
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var editorPhotos: [ProfilePhotoEdit]
    @State private var replacementTargetID: String?
    @State private var showingCitySearch = false

    init(profile: WorkoutProfile, viewModel: ProfileViewModel) {
        self.profile = profile
        self.viewModel = viewModel
        _draft = State(initialValue: ProfileDraft(profile: profile))
        _editorPhotos = State(initialValue: profile.photos.map {
            ProfilePhotoEdit(id: $0.id, existing: $0, replacementOf: nil, upload: nil)
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if editorPhotos.isEmpty {
                        Text("Add at least one photo to complete your profile.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(editorPhotos.enumerated()), id: \.element.id) { index, photo in
                            HStack(spacing: LauverDesign.Spacing.medium) {
                                photoThumbnail(photo)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(index == 0 ? "Primary photo" : "Photo \(index + 1)")
                                        .font(.subheadline.weight(.semibold))
                                    HStack(spacing: LauverDesign.Spacing.small) {
                                        Button("Replace") { replacementTargetID = photo.id }
                                            .accessibilityIdentifier("profile-photo-replace-\(photo.id)")
                                        Button("Delete", role: .destructive) { deleteEditorPhoto(photo) }
                                            .accessibilityIdentifier("profile-photo-delete-\(photo.id)")
                                    }
                                    .font(.caption)
                                    if let uploadError = photo.uploadError {
                                        Text(uploadError)
                                            .font(.caption2)
                                            .foregroundStyle(.red)
                                        Button("Retry") {
                                            Task {
                                                let outcome = await viewModel.savePhotoEdits(
                                                    draft: draft,
                                                    photoEdits: editorPhotos,
                                                    retryOnlyID: photo.id
                                                )
                                                editorPhotos = outcome.edits
                                            }
                                        }
                                        .font(.caption.weight(.semibold))
                                        .accessibilityIdentifier("profile-photo-retry-\(photo.id)")
                                    }
                                }
                                Spacer()
                            }
                        }
                        .onMove { source, destination in
                            editorPhotos.move(fromOffsets: source, toOffset: destination)
                        }
                    }

                    PhotosPicker(
                        selection: $selectedPhotoItems,
                        maxSelectionCount: replacementTargetID == nil ? max(0, 9 - editorPhotos.count) : 1,
                        matching: .images
                    ) {
                        Label(replacementTargetID == nil ? "Add photos" : "Choose replacement", systemImage: "photo.on.rectangle.angled")
                    }
                    .disabled(replacementTargetID == nil && editorPhotos.count >= 9)
                    .accessibilityIdentifier("profile-photo-picker")
                } header: {
                    HStack {
                        Text("Photos")
                        Spacer()
                        EditButton()
                    }
                } footer: {
                    Text("Up to 9 photos. Drag to reorder; the first photo is primary.")
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
                                    Text(sport.paceInputUnit).foregroundStyle(.secondary)
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
            .scrollContentBackground(.hidden)
            .background(LauverDesign.ColorToken.background)
            .tint(LauverDesign.ColorToken.accent)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(viewModel.isSaving ? "Saving…" : "Save") {
                        Task {
                            let outcome = await viewModel.savePhotoEdits(draft: draft, photoEdits: editorPhotos)
                            editorPhotos = outcome.edits
                            if outcome.saved { dismiss() }
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
            .onChange(of: selectedPhotoItems) { _, items in
                guard !items.isEmpty else { return }
                let targetID = replacementTargetID
                replacementTargetID = nil
                selectedPhotoItems = []
                Task {
                    var loadedPhotos: [ProfilePhoto] = []
                    do {
                        for item in items {
                            guard let data = try await item.loadTransferable(type: Data.self) else {
                                throw ProfilePhotoError.invalidImage
                            }
                            loadedPhotos.append(try ProfilePhoto.processedJPEG(from: data))
                        }
                        if let targetID, let replacement = loadedPhotos.first,
                           let index = editorPhotos.firstIndex(where: { $0.id == targetID }) {
                            let old = editorPhotos[index]
                            editorPhotos[index] = ProfilePhotoEdit(
                                id: UUID().uuidString,
                                existing: nil,
                                replacementOf: old.existing?.id ?? old.replacementOf,
                                upload: replacement
                            )
                        } else {
                            editorPhotos.append(contentsOf: loadedPhotos.map { photo in
                                ProfilePhotoEdit(id: UUID().uuidString, existing: nil, replacementOf: nil, upload: photo)
                            })
                        }
                    } catch {
                        viewModel.showLocalError((error as? LocalizedError)?.errorDescription ?? "Photo selection failed.")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func photoThumbnail(_ photo: ProfilePhotoEdit) -> some View {
        if let upload = photo.upload, let image = UIImage(data: upload.data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        } else if let existing = photo.existing {
            AsyncImage(url: existing.url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else if phase.error != nil {
                    Image(systemName: "photo").foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        } else {
            Image(systemName: "photo")
                .frame(width: 64, height: 64)
                .foregroundStyle(.secondary)
        }
    }

    private func deleteEditorPhoto(_ photo: ProfilePhotoEdit) {
        guard let index = editorPhotos.firstIndex(where: { $0.id == photo.id }) else { return }
        editorPhotos.remove(at: index)
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
            .safeAreaInset(edge: .top) {
                Button {
                    resolving = true
                    Task {
                        do { selection(try await search.currentCity()) }
                        catch {
                            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Could not determine your city."
                            resolving = false
                        }
                    }
                } label: {
                    Label("Use Current Location", systemImage: "location.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(LauverDesign.ColorToken.accent)
                .disabled(resolving)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(.bar)
                .accessibilityIdentifier("profile-city-use-location")
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
    @State private var selectedPhoto: ProfilePhotoReference?

    var body: some View {
        ScrollView {
            VStack(spacing: LauverDesign.Spacing.large) {
                ProfileAvatar(photoURL: profile.photoURL, size: 112)
                if profile.photos.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(profile.photos) { photo in
                                Button { selectedPhoto = photo } label: {
                                    AsyncImage(url: photo.url) { image in image.resizable().scaledToFill() }
                                    placeholder: { Color.secondary.opacity(0.12) }
                                    .frame(width: 76, height: 76)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("View profile photo \(photo.sortOrder + 1)")
                            }
                        }
                    }
                    .accessibilityIdentifier("profile-photo-gallery")
                }
                Text(profile.displayName ?? "Workout partner").font(.title2.bold())
                if let city = profile.city {
                    Label("\(city.name), \(city.countryCode)", systemImage: "mappin.and.ellipse")
                }
                if let bio = profile.bio { Text(bio).frame(maxWidth: .infinity, alignment: .leading) }
                ProfileSection(title: "Sports") {
                    ForEach(profile.sports) { sport in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sport.sport.title).fontWeight(.semibold)
                            if let pace = sport.paceValue, let unit = sport.paceUnit {
                                Text("\(sport.sport.formattedPace(pace)) \(unit) · Self-reported").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if !profile.trainingTimes.isEmpty {
                    ProfileSection(title: "Preferred training times") { Text(trainingSummary(profile.trainingTimes)) }
                }
            }
            .padding()
        }
        .navigationTitle("Profile")
        .toolbarBackground(LauverDesign.ColorToken.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .background(LauverDesign.ColorToken.background)
        .fullScreenCover(item: $selectedPhoto) { photo in
            ProfilePhotoViewer(photos: profile.photos, initialPhoto: photo)
        }
    }
}

private struct ProfilePhotoViewer: View {
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
                        if let image = phase.image {
                            image.resizable().scaledToFit()
                        } else if phase.error != nil {
                            Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                        }
                    }
                    .tag(photo.id)
                    .padding()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .background(Color.black)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .accessibilityIdentifier("profile-photo-viewer")
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
            if case .notFound = apiError { profile = nil }
            if case .unauthorized = apiError { profile = nil }
            error = apiError
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            self.error = .transport(.unknown)
        }
    }
}

struct OtherProfileScreen: View {
    @StateObject private var viewModel: OtherProfileViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmBlock = false
    @State private var isBlocking = false
    @State private var blockError: String?
    @State private var reportMode: ReportMode?
    private let userID: String
    private let safetyService: any SafetyServicing

    private enum ReportMode: String, Identifiable {
        case report, reportAndBlock
        var id: String { rawValue }
    }

    init(userID: String, service: any ProfileServicing, safetyService: any SafetyServicing) {
        _viewModel = StateObject(wrappedValue: OtherProfileViewModel(userID: userID, service: service))
        self.userID = userID
        self.safetyService = safetyService
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
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await viewModel.load() } } }
        .toolbar {
            if viewModel.profile != nil {
                Menu {
                    Button("Report User", systemImage: "flag") { reportMode = .report }.accessibilityIdentifier("profile-report")
                    Button("Report and Block", systemImage: "shield") { reportMode = .reportAndBlock }.accessibilityIdentifier("profile-report-block")
                    Button("Block User", systemImage: "person.crop.circle.badge.xmark", role: .destructive) { confirmBlock = true }
                        .accessibilityIdentifier("profile-block")
                } label: { Label(isBlocking ? "Blocking…" : "Safety", systemImage: "ellipsis.circle") }
                .disabled(isBlocking).accessibilityIdentifier("profile-safety-menu")
            }
        }
        .safeAreaInset(edge: .bottom) {
            if viewModel.profile != nil {
                Label("You can message this person after a mutual Match.", systemImage: "person.2")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
                    .accessibilityIdentifier("profile-match-required")
            }
        }
        .alert("Block this user?", isPresented: $confirmBlock) {
            Button("Block User", role: .destructive) {
                isBlocking = true
                Task {
                    defer { isBlocking = false }
                    do {
                        try await safetyService.block(userID: userID)
                        NotificationCenter.default.post(name: .safetyPolicyChanged, object: nil, userInfo: ["blockedUserID": userID])
                        dismiss()
                    } catch { blockError = (error as? APIError)?.userMessage ?? "This user could not be blocked. Please try again." }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Your profiles will be hidden from each other. You can unblock this user in Settings.") }
        .alert("Unable to block", isPresented: Binding(get: { blockError != nil }, set: { if !$0 { blockError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(blockError ?? "Please try again.") }
        .sheet(item: $reportMode) { mode in
            ReportUserView(userID: userID, displayName: viewModel.profile?.displayName ?? "user", blockUser: mode == .reportAndBlock,
                           service: safetyService) { blocked in
                if blocked {
                    // Keep the receipt visible until Done; removing the source list row
                    // earlier would pop its NavigationLink and dismiss this sheet.
                    NotificationCenter.default.post(name: .safetyPolicyChanged, object: nil, userInfo: ["blockedUserID": userID])
                    dismiss()
                }
            }
        }
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
