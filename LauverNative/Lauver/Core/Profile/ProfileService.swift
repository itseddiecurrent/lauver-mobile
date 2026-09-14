import Foundation
@preconcurrency import MapKit
import UIKit

enum WorkoutSport: String, Codable, CaseIterable, Identifiable {
    case running
    case trailRunning = "trail_running"
    case cycling
    case swimming
    case walking
    case hiking
    case rowing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .running: "Running"
        case .trailRunning: "Trail Running"
        case .cycling: "Cycling"
        case .swimming: "Swimming"
        case .walking: "Walking"
        case .hiking: "Hiking"
        case .rowing: "Rowing"
        }
    }

    var paceUnit: String {
        switch self {
        case .cycling: "km/h"
        case .swimming: "min/100m"
        case .rowing: "min/500m"
        case .running, .trailRunning, .walking, .hiking: "min/km"
        }
    }

    var usesDurationPace: Bool { self != .cycling }

    var paceInputUnit: String {
        usesDurationPace ? paceUnit.replacingOccurrences(of: "min/", with: "mm:ss/") : paceUnit
    }

    var allowedPaceRange: ClosedRange<Double> {
        switch self {
        case .running: 2...15
        case .trailRunning: 3...30
        case .cycling: 5...80
        case .swimming: 0.5...10
        case .walking: 5...30
        case .hiking: 5...60
        case .rowing: 0.8...10
        }
    }

    func formattedPace(_ value: Double) -> String {
        guard usesDurationPace else {
            return String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), value)
                .replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression)
        }
        let seconds = Int((value * 60).rounded())
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    func parsedPace(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !usesDurationPace {
            guard let value = Double(trimmed), value.isFinite, value > 0 else { return nil }
            return value
        }
        let parts = trimmed.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...3).contains(parts[0].count), parts[1].count == 2,
              parts.allSatisfy({ $0.allSatisfy { ("0"..."9").contains(String($0)) } }),
              let minutes = Int(parts[0]), let seconds = Int(parts[1]), seconds < 60,
              minutes > 0 || seconds > 0 else { return nil }
        return Double(minutes) + Double(seconds) / 60
    }
}

enum TrainingTimeBucket: String, Codable, CaseIterable, Identifiable {
    case morning
    case midday
    case evening

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

struct ProfileCity: Codable, Equatable {
    let name: String
    let regionCode: String?
    let countryCode: String
    let latitude: Double?
    let longitude: Double?

    var subtitle: String {
        [regionCode, countryCode].compactMap { $0 }.joined(separator: ", ")
    }
}

struct ProfileSport: Codable, Equatable, Identifiable {
    let sport: WorkoutSport
    let paceValue: Double?
    let paceUnit: String?

    var id: String { sport.rawValue }
}

struct TrainingTime: Codable, Equatable, Hashable, Identifiable {
    let weekday: Int
    let timeBucket: TrainingTimeBucket

    var id: String { "\(weekday)-\(timeBucket.rawValue)" }
}

struct WorkoutProfile: Codable, Equatable, Identifiable {
    let id: String
    let displayName: String?
    let bio: String?
    let photoURL: URL?
    let city: ProfileCity?
    let sports: [ProfileSport]
    let trainingTimes: [TrainingTime]
    let isComplete: Bool
}

struct ProfileDraft: Equatable {
    var displayName: String
    var bio: String
    var city: ProfileCity?
    var selectedSports: Set<WorkoutSport>
    var paceValues: [WorkoutSport: String]
    var trainingTimes: Set<TrainingTime>

    init(profile: WorkoutProfile) {
        displayName = profile.displayName ?? ""
        bio = profile.bio ?? ""
        city = profile.city
        selectedSports = Set(profile.sports.map(\.sport))
        paceValues = Dictionary(uniqueKeysWithValues: profile.sports.compactMap { item in
            guard let value = item.paceValue else { return nil }
            return (item.sport, item.sport.formattedPace(value))
        })
        trainingTimes = Set(profile.trainingTimes)
    }
}

struct ProfilePhoto: Equatable {
    let data: Data
    let fileName: String
    let contentType: String

    static func processedJPEG(from data: Data) throws -> ProfilePhoto {
        guard let source = UIImage(data: data), source.size.width > 0, source.size.height > 0 else {
            throw ProfilePhotoError.invalidImage
        }
        let side = min(source.size.width, source.size.height)
        let cropRect = CGRect(
            x: (source.size.width - side) / 2,
            y: (source.size.height - side) / 2,
            width: side,
            height: side
        )
        guard let imageReference = source.cgImage,
              let croppedReference = imageReference.cropping(to: cropRect.applying(
                CGAffineTransform(
                    scaleX: imageReference.width.cgFloat / source.size.width,
                    y: imageReference.height.cgFloat / source.size.height
                )
              )) else {
            throw ProfilePhotoError.invalidImage
        }
        let maximumSide: CGFloat = 1_600
        let outputSide = min(side, maximumSide)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: outputSide, height: outputSide), format: format)
        let normalized = renderer.image { _ in
            UIImage(cgImage: croppedReference, scale: 1, orientation: source.imageOrientation)
                .draw(in: CGRect(x: 0, y: 0, width: outputSide, height: outputSide))
        }
        for quality in stride(from: 0.86, through: 0.45, by: -0.1) {
            if let output = normalized.jpegData(compressionQuality: quality), output.count <= 5 * 1_024 * 1_024 {
                return ProfilePhoto(data: output, fileName: "profile.jpg", contentType: "image/jpeg")
            }
        }
        throw ProfilePhotoError.tooLarge
    }
}

private extension Int {
    var cgFloat: CGFloat { CGFloat(self) }
}

enum ProfilePhotoError: LocalizedError {
    case invalidImage
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .invalidImage: "The selected file is not a valid image."
        case .tooLarge: "The selected photo is too large."
        }
    }
}

private struct ProfileEnvelope: Decodable { let profile: WorkoutProfile }
private struct ProfileUpdatePayload: Encodable {
    let displayName: String?
    let bio: String?
    let city: CityPayload?
    let sports: [SportPayload]
    let trainingTimes: [TrainingTime]

    struct CityPayload: Encodable {
        let name: String
        let regionCode: String?
        let countryCode: String
        let latitude: Double
        let longitude: Double

        enum CodingKeys: String, CodingKey { case name, regionCode, countryCode, latitude, longitude }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(name, forKey: .name)
            if let regionCode { try container.encode(regionCode, forKey: .regionCode) }
            else { try container.encodeNil(forKey: .regionCode) }
            try container.encode(countryCode, forKey: .countryCode)
            try container.encode(latitude, forKey: .latitude)
            try container.encode(longitude, forKey: .longitude)
        }
    }

    struct SportPayload: Encodable {
        let sport: WorkoutSport
        let paceValue: Double?

        enum CodingKeys: String, CodingKey { case sport, paceValue }
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(sport, forKey: .sport)
            if let paceValue { try container.encode(paceValue, forKey: .paceValue) }
            else { try container.encodeNil(forKey: .paceValue) }
        }
    }

    enum CodingKeys: String, CodingKey { case displayName, bio, city, sports, trainingTimes }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let displayName { try container.encode(displayName, forKey: .displayName) }
        else { try container.encodeNil(forKey: .displayName) }
        if let bio { try container.encode(bio, forKey: .bio) }
        else { try container.encodeNil(forKey: .bio) }
        if let city { try container.encode(city, forKey: .city) }
        else { try container.encodeNil(forKey: .city) }
        try container.encode(sports, forKey: .sports)
        try container.encode(trainingTimes, forKey: .trainingTimes)
    }
}
private struct PhotoUploadPayload: Encodable {
    let fileName: String
    let contentType: String
    let byteSize: Int
}
private struct PhotoCompletePayload: Encodable { let objectKey: String }
private struct PhotoUploadResponse: Decodable {
    let objectKey: String
    let uploadURL: URL
    let expiresIn: Int
    let requiredHeaders: [String: String]
}

protocol ProfileServicing {
    func getOwnProfile() async throws -> WorkoutProfile
    func getProfile(userID: String) async throws -> WorkoutProfile
    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile
    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile
    func deletePhoto() async throws
}

protocol HealthWorkoutUploading {
    func uploadHealthWorkouts(_ workouts: [HealthWorkoutSummary]) async throws
    func healthWorkouts() async throws -> [HealthWorkoutSummary]
    func deleteHealthWorkouts() async throws
}

struct ChatToken: Decodable, Equatable {
    let apiKey: String
    let userId: String
    let token: String
    let expiresAt: String
}

struct DirectChatChannel: Decodable, Equatable, Identifiable {
    let channelType: String
    let channelId: String
    let members: [String]
    var id: String { "\(channelType):\(channelId)" }
}

protocol ChatServicing {
    func chatToken() async throws -> ChatToken
    func sendChatMessage(channelID: String, id: UUID, text: String) async throws
    func directChat(targetUserID: String) async throws -> DirectChatChannel
}

final class ProfileService: ProfileServicing, DiscoverServicing, SafetyServicing, StravaServicing, HealthWorkoutUploading, ChatServicing {
    private let client: APIClient
    private let authService: any AuthServicing
    private let sessionStore: any AuthSessionStoring
    private let encoder = JSONEncoder()
    @MainActor private var refreshTask: (id: UUID, tokens: SessionTokens, task: Task<String, Error>)?
    @MainActor private var completedRefresh: (previous: SessionTokens, current: SessionTokens)?

    init(client: APIClient, authService: any AuthServicing, sessionStore: any AuthSessionStoring) {
        self.client = client
        self.authService = authService
        self.sessionStore = sessionStore
    }

    func discover(filters: DiscoverFilters, cursor: String?) async throws -> DiscoverPage {
        try await authenticatedRequest { token in
            APIRequest(path: filters.path(cursor: cursor), headers: Self.authorization(token))
        }
    }

    func getOwnProfile() async throws -> WorkoutProfile {
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/me", headers: Self.authorization(token))
        }
        return envelope.profile
    }

    func getProfile(userID: String) async throws -> WorkoutProfile {
        let encodedID = userID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/users/\(encodedID)", headers: Self.authorization(token))
        }
        return envelope.profile
    }

    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile {
        let payload = try makeUpdatePayload(draft)
        let body = try encoder.encode(payload)
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(
                method: .patch,
                path: "/v1/me",
                body: body,
                headers: Self.jsonAuthorization(token),
                allowsConnectionRetry: true
            )
        }
        return envelope.profile
    }

    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile {
        let body = try encoder.encode(PhotoUploadPayload(
            fileName: photo.fileName,
            contentType: photo.contentType,
            byteSize: photo.data.count
        ))
        let upload: PhotoUploadResponse = try await authenticatedRequest { token in
            APIRequest(
                method: .post,
                path: "/v1/me/photo/upload-url",
                body: body,
                headers: Self.jsonAuthorization(token),
                // A lost response only leaves an unused pending upload that expires.
                allowsConnectionRetry: true
            )
        }
        try await client.upload(
            data: photo.data, to: upload.uploadURL, contentType: photo.contentType,
            requiredHeaders: upload.requiredHeaders
        )
        let completeBody = try encoder.encode(PhotoCompletePayload(objectKey: upload.objectKey))
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(
                method: .post,
                path: "/v1/me/photo/complete",
                body: completeBody,
                headers: Self.jsonAuthorization(token),
                // The backend recognizes an already committed upload by its object key.
                allowsConnectionRetry: true
            )
        }
        return envelope.profile
    }

    func deletePhoto() async throws {
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/me/photo", headers: Self.authorization(token))
        }
    }

    func block(userID: String) async throws {
        guard UUID(uuidString: userID) != nil else { throw APIError.invalidRequest }
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/blocks/\(userID)", headers: Self.authorization(token), allowsConnectionRetry: true)
        }
    }

    func unblock(userID: String) async throws {
        guard UUID(uuidString: userID) != nil else { throw APIError.invalidRequest }
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/blocks/\(userID)", headers: Self.authorization(token))
        }
    }

    func blockedUsers(cursor: String?) async throws -> BlockedUsersPage {
        var components = URLComponents()
        components.path = "/v1/blocks"
        if let cursor { components.queryItems = [URLQueryItem(name: "cursor", value: cursor)] }
        let path = components.string!
        return try await authenticatedRequest { token in APIRequest(path: path, headers: Self.authorization(token)) }
    }

    func report(userID: String, reason: ReportReason, details: String, blockUser: Bool) async throws -> ReportReceipt {
        guard UUID(uuidString: userID) != nil else { throw APIError.invalidRequest }
        struct Payload: Encodable {
            let targetType = "user"
            let targetId: String
            let reason: ReportReason
            let details: String
            let blockUser: Bool
        }
        let body = try encoder.encode(Payload(targetId: userID, reason: reason, details: details, blockUser: blockUser))
        return try await authenticatedRequest { token in
            // Repeated evidence is intentionally a new report; do not automatically retry.
            APIRequest(method: .post, path: "/v1/reports", body: body, headers: Self.jsonAuthorization(token))
        }
    }

    func stravaStatus() async throws -> StravaStatus {
        try await authenticatedRequest { token in APIRequest(path: "/v1/integrations/strava/status", headers: Self.authorization(token)) }
    }

    func startStrava() async throws -> StravaStart {
        try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/integrations/strava/start", headers: Self.authorization(token)) }
    }

    func syncStrava() async throws -> StravaStatus {
        try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/integrations/strava/sync", headers: Self.authorization(token)) }
    }

    func disconnectStrava() async throws -> StravaStatus {
        try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/integrations/strava/disconnect", headers: Self.authorization(token)) }
    }

    func uploadHealthWorkouts(_ workouts: [HealthWorkoutSummary]) async throws {
        struct Payload: Encodable { let workouts: [HealthWorkoutSummary] }
        let body = try encoder.encode(Payload(workouts: workouts))
        let _: HealthImportResponse = try await authenticatedRequest { token in
            // The server upserts by (user, workout UUID), so retrying after a
            // lost connection is safe and prevents transient -1005 failures.
            APIRequest(method: .post, path: "/v1/integrations/healthkit/workouts", body: body, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
    }

    func healthWorkouts() async throws -> [HealthWorkoutSummary] {
        let response: HealthWorkoutsResponse = try await authenticatedRequest { token in
            APIRequest(path: "/v1/integrations/healthkit/workouts", headers: Self.authorization(token))
        }
        return response.workouts
    }

    func deleteHealthWorkouts() async throws {
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/integrations/healthkit/workouts", headers: Self.authorization(token))
        }
    }

    func chatToken() async throws -> ChatToken {
        try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/chat/token", headers: Self.authorization(token))
        }
    }

    func sendChatMessage(channelID: String, id: UUID, text: String) async throws {
        guard channelID.hasPrefix("dm-"), channelID.count == 43,
              channelID.dropFirst(3).allSatisfy({ $0.isHexDigit }) else { throw APIError.invalidRequest }
        struct Payload: Encodable { let id: UUID; let text: String }
        let body = try encoder.encode(Payload(id: id, text: text))
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/chat/channels/\(channelID)/messages", body: body, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
    }

    func directChat(targetUserID: String) async throws -> DirectChatChannel {
        guard UUID(uuidString: targetUserID) != nil else { throw APIError.invalidRequest }
        struct Payload: Encodable { let targetUserId: String }
        let body = try encoder.encode(Payload(targetUserId: targetUserID))
        return try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/chat/direct", body: body, headers: Self.jsonAuthorization(token))
        }
    }

    @MainActor
    private func authenticatedRequest<Response: Decodable>(
        _ request: (String) -> APIRequest<Response>
    ) async throws -> Response {
        guard let tokens = try sessionStore.read() else {
            throw APIError.unauthorized(code: "invalid_session", message: nil, requestID: nil)
        }
        do {
            return try await client.send(request(tokens.accessToken))
        } catch APIError.unauthorized {
            let accessToken = try await refreshedAccessToken(for: tokens)
            do {
                return try await client.send(request(accessToken))
            } catch let error as APIError {
                if case .unauthorized = error {
                    invalidateSession(accessToken: accessToken)
                }
                throw error
            }
        }
    }

    @MainActor
    private func refreshedAccessToken(for tokens: SessionTokens) async throws -> String {
        guard let current = try sessionStore.read() else { throw Self.invalidSession }
        if current != tokens {
            // A late 401 can arrive after another request already rotated this session.
            // Never retry an old user's request with a newly signed-in user's token.
            guard completedRefresh?.previous == tokens, completedRefresh?.current == current else {
                throw Self.invalidSession
            }
            return current.accessToken
        }
        if let refreshTask, refreshTask.tokens == tokens {
            return try await refreshTask.task.value
        }
        let id = UUID()
        let task = Task { @MainActor in
            do {
                let session = try await self.authService.refresh(refreshToken: tokens.refreshToken)
                guard try self.sessionStore.read() == tokens else { throw Self.invalidSession }
                try self.sessionStore.save(session)
                self.completedRefresh = (tokens, SessionTokens(accessToken: session.accessToken, refreshToken: session.refreshToken))
                return session.accessToken
            } catch let error as APIError {
                if case .unauthorized = error {
                    self.invalidateSession(accessToken: tokens.accessToken)
                }
                throw error
            }
        }
        refreshTask = (id, tokens, task)
        defer { if refreshTask?.id == id { refreshTask = nil } }
        return try await task.value
    }

    @MainActor
    private func invalidateSession(accessToken: String) {
        guard let current = try? sessionStore.read(), current.accessToken == accessToken else { return }
        try? sessionStore.clear()
        completedRefresh = nil
        NotificationCenter.default.post(name: .authenticationSessionExpired, object: nil)
    }

    private static var invalidSession: APIError {
        .unauthorized(code: "invalid_session", message: "Please sign in again.", requestID: nil)
    }

    private func makeUpdatePayload(_ draft: ProfileDraft) throws -> ProfileUpdatePayload {
        let sports = try draft.selectedSports.sorted { $0.rawValue < $1.rawValue }.map { sport in
            let text = draft.paceValues[sport]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let value: Double?
            if text.isEmpty {
                value = nil
            } else if let parsed = sport.parsedPace(text) {
                value = parsed
            } else {
                throw APIError.validation(
                    code: "invalid_pace",
                    message: sport.usesDurationPace
                        ? "Enter \(sport.title) pace as mm:ss, with seconds from 00 to 59 (for example, 5:12)."
                        : "Enter a valid positive speed in km/h for \(sport.title).",
                    requestID: nil
                )
            }
            return ProfileUpdatePayload.SportPayload(sport: sport, paceValue: value)
        }
        let city = draft.city.flatMap { selected -> ProfileUpdatePayload.CityPayload? in
            guard let latitude = selected.latitude, let longitude = selected.longitude else { return nil }
            return .init(
                name: selected.name,
                regionCode: selected.regionCode,
                countryCode: selected.countryCode,
                latitude: latitude,
                longitude: longitude
            )
        }
        return ProfileUpdatePayload(
            displayName: nilIfBlank(draft.displayName),
            bio: nilIfBlank(draft.bio),
            city: city,
            sports: sports,
            trainingTimes: draft.trainingTimes.sorted {
                $0.weekday == $1.weekday
                    ? $0.timeBucket.rawValue < $1.timeBucket.rawValue
                    : $0.weekday < $1.weekday
            }
        )
    }

    private static func authorization(_ token: String) -> [String: String] {
        ["Authorization": "Bearer \(token)"]
    }

    private static func jsonAuthorization(_ token: String) -> [String: String] {
        ["Authorization": "Bearer \(token)", "Content-Type": "application/json"]
    }
}

private func nilIfBlank(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

@MainActor
final class CitySearchModel: NSObject, ObservableObject, @preconcurrency MKLocalSearchCompleterDelegate {
    @Published var query = "" {
        didSet { completer.queryFragment = query }
    }
    @Published private(set) var results: [MKLocalSearchCompletion] = []
    @Published private(set) var errorMessage: String?

    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = .address
    }

    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        results = Array(completer.results.prefix(12))
        errorMessage = nil
    }

    func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        errorMessage = "City search is temporarily unavailable."
    }

    func resolve(_ completion: MKLocalSearchCompletion) async throws -> ProfileCity {
        let request = MKLocalSearch.Request(completion: completion)
        let response = try await MKLocalSearch(request: request).start()
        guard let item = response.mapItems.first else { throw CitySearchError.noResult }
        let placemark = item.placemark
        let cityName = placemark.locality ?? placemark.subAdministrativeArea ?? completion.title
        guard let countryCode = placemark.isoCountryCode, !cityName.isEmpty else {
            throw CitySearchError.noResult
        }
        // Resolve the locality a second time as a city-only query. This avoids
        // persisting a street/POI coordinate when a detailed completion is tapped.
        let cityRequest = MKLocalSearch.Request()
        cityRequest.naturalLanguageQuery = [cityName, placemark.administrativeArea, countryCode]
            .compactMap { $0 }
            .joined(separator: ", ")
        cityRequest.resultTypes = .address
        let cityResponse = try await MKLocalSearch(request: cityRequest).start()
        guard let cityItem = cityResponse.mapItems.first(where: {
            let localityMatches = $0.placemark.locality?.localizedCaseInsensitiveCompare(cityName) == .orderedSame
            let nameMatches = $0.name?.localizedCaseInsensitiveCompare(cityName) == .orderedSame
            return (localityMatches || nameMatches) &&
                $0.placemark.thoroughfare == nil && $0.placemark.subThoroughfare == nil
        }) else {
            throw CitySearchError.noResult
        }
        return ProfileCity(
            name: cityName,
            regionCode: placemark.administrativeArea,
            countryCode: countryCode,
            latitude: cityItem.placemark.coordinate.latitude,
            longitude: cityItem.placemark.coordinate.longitude
        )
    }
}

enum CitySearchError: LocalizedError {
    case noResult
    var errorDescription: String? { "Select a city-level search result." }
}
