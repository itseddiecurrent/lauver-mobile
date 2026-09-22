import Foundation
import CoreLocation
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
    let photos: [ProfilePhotoReference]
    let city: ProfileCity?
    let sports: [ProfileSport]
    let trainingTimes: [TrainingTime]
    let isComplete: Bool

    init(id: String, displayName: String?, bio: String?, photoURL: URL?, photos: [ProfilePhotoReference] = [], city: ProfileCity?, sports: [ProfileSport], trainingTimes: [TrainingTime], isComplete: Bool) {
        self.id = id
        self.displayName = displayName
        self.bio = bio
        self.photoURL = photoURL
        self.photos = photos
        self.city = city
        self.sports = sports
        self.trainingTimes = trainingTimes
        self.isComplete = isComplete
    }

    enum CodingKeys: String, CodingKey { case id, displayName, bio, photoURL, photos, city, sports, trainingTimes, isComplete }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        bio = try c.decodeIfPresent(String.self, forKey: .bio)
        photoURL = try c.decodeIfPresent(URL.self, forKey: .photoURL)
        photos = try c.decodeIfPresent([ProfilePhotoReference].self, forKey: .photos) ?? []
        city = try c.decodeIfPresent(ProfileCity.self, forKey: .city)
        sports = try c.decodeIfPresent([ProfileSport].self, forKey: .sports) ?? []
        trainingTimes = try c.decodeIfPresent([TrainingTime].self, forKey: .trainingTimes) ?? []
        isComplete = try c.decodeIfPresent(Bool.self, forKey: .isComplete) ?? false
    }
}

extension WorkoutProfile {
    /// Discover and Match need a saved city center before they can calculate
    /// approximate distances. Keep this gate shared so an incomplete profile
    /// is not reported as a network error.
    var needsLocationForDiscovery: Bool {
        guard let city else { return true }
        return city.latitude == nil || city.longitude == nil
    }
}

struct ProfilePhotoReference: Codable, Equatable, Identifiable {
    let id: String
    let url: URL
    let sortOrder: Int
    let isPrimary: Bool
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

struct PhotoUploadResult {
    let profile: WorkoutProfile
    let photoID: String?
}

struct PhotoUploadRequest {
    let clientID: String
    let photo: ProfilePhoto
}

struct PhotoUploadTicket {
    let clientID: String
    let objectKey: String
    let uploadURL: URL
    let requiredHeaders: [String: String]
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
struct MatchPreferences: Codable, Equatable {
    let visibleInMatch: Bool
    let gender: String?
    let preferredGender: String
    let maxDistanceKm: Int?
    let sports: [String]
}
private struct MatchPreferencesEnvelope: Decodable { let preferences: MatchPreferences }
private struct MatchPreferencesPayload: Encodable {
    let visibleInMatch: Bool
    let gender: String?
    let preferredGender: String
    let maxDistanceKm: Int?
    let sports: [String]
}
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
private struct PhotoUploadBatchResponse: Decodable { let uploads: [PhotoUploadResponseWithClientID] }
private struct PhotoUploadResponseWithClientID: Decodable {
    let clientID: String
    let objectKey: String
    let uploadURL: URL
    let expiresIn: Int
    let requiredHeaders: [String: String]
}

protocol ProfileServicing {
    func getOwnProfile() async throws -> WorkoutProfile
    func previewOwnProfile() async throws -> WorkoutProfile
    func getProfile(userID: String) async throws -> WorkoutProfile
    func getMatchPreferences() async throws -> MatchPreferences
    func updateMatchVisibility(_ visible: Bool) async throws -> MatchPreferences
    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile
    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile
    func deletePhoto() async throws
    func uploadPhotoWithReference(_ photo: ProfilePhoto) async throws -> PhotoUploadResult
    func createPhotoUploadTickets(_ requests: [PhotoUploadRequest]) async throws -> [PhotoUploadTicket]
    func uploadPhoto(_ photo: ProfilePhoto, using ticket: PhotoUploadTicket) async throws -> PhotoUploadResult
    func deletePhoto(photoID: String) async throws
    func reorderPhotos(_ photoIDs: [String]) async throws -> WorkoutProfile
}

extension ProfileServicing {
    func uploadPhotoWithReference(_ photo: ProfilePhoto) async throws -> PhotoUploadResult {
        PhotoUploadResult(profile: try await uploadPhoto(photo), photoID: nil)
    }

    func deletePhoto(photoID: String) async throws {
        _ = photoID
        try await deletePhoto()
    }

    func reorderPhotos(_ photoIDs: [String]) async throws -> WorkoutProfile {
        _ = photoIDs
        return try await getOwnProfile()
    }

    func createPhotoUploadTickets(_ requests: [PhotoUploadRequest]) async throws -> [PhotoUploadTicket] {
        requests.map {
            PhotoUploadTicket(clientID: $0.clientID, objectKey: "", uploadURL: URL(string: "https://invalid.example")!, requiredHeaders: [:])
        }
    }

    func uploadPhoto(_ photo: ProfilePhoto, using ticket: PhotoUploadTicket) async throws -> PhotoUploadResult {
        _ = ticket
        return try await uploadPhotoWithReference(photo)
    }
}

protocol AccountDeletionServicing {
    func deleteAccount(currentPassword: String) async throws
    func deleteAccount(appleCredential: AppleSignInCredential) async throws
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
typealias EventChatChannel = DirectChatChannel

protocol ChatServicing {
    func chatToken() async throws -> ChatToken
    func sendChatMessage(channelID: String, id: UUID, text: String) async throws
    func directChat(targetUserID: String) async throws -> DirectChatChannel
    func eventChat(eventID: String) async throws -> EventChatChannel
    func reportChatMessage(channelID: String, messageID: String, reason: ReportReason, details: String) async throws -> ReportReceipt
}

struct EventVenue: Codable, Equatable {
    let name: String
    let address: String?
    let latitude: Double
    let longitude: Double
}

struct PublicEvent: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String?
    let sport: String
    let startsAt: String
    let endsAt: String
    let capacity: Int
    let attendeeCount: Int
    let venue: EventVenue
    let status: String
    let creator: EventCreator
    let isAttendee: Bool?
    let isCreator: Bool?
}

struct EventCreator: Codable, Equatable { let id: String; let displayName: String }
struct EventPage: Codable, Equatable { let events: [PublicEvent]; let nextCursor: String? }
private struct EventEnvelope: Decodable { let event: PublicEvent }
struct EventDraft: Encodable { let title: String; let description: String?; let sport: String; let startsAt: String; let endsAt: String; let capacity: Int; let venueName: String; let venueAddress: String?; let venueLatitude: Double; let venueLongitude: Double }

protocol EventsServicing {
    func events(sport: String?, city: String?, cursor: String?) async throws -> EventPage
    func event(id: String) async throws -> PublicEvent
    func joinEvent(id: String) async throws -> PublicEvent
    func leaveEvent(id: String) async throws -> PublicEvent
    func createEvent(_ draft: EventDraft) async throws -> PublicEvent
    func updateEvent(id: String, draft: EventDraft) async throws -> PublicEvent
    func cancelEvent(id: String) async throws -> PublicEvent
    func reportEvent(id: String, reason: String, details: String?, targetType: String) async throws -> String
}

final class ProfileService: ProfileServicing, AccountDeletionServicing, DiscoverServicing, SafetyServicing, StravaServicing, HealthWorkoutUploading, ChatServicing, EventsServicing, MatchServicing {
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

    func preferences() async throws -> MatchPreferences {
        let envelope: MatchPreferencesEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/match/preferences", headers: Self.authorization(token))
        }
        return envelope.preferences
    }

    func updatePreferences(_ filters: MatchFilters, visibleInMatch: Bool) async throws -> MatchPreferences {
        let current = try await preferences()
        struct Payload: Encodable {
            let visibleInMatch: Bool
            let gender: String?
            let preferredGender: String
            let maxDistanceKm: Int?
            let sports: [String]
        }
        let body = try encoder.encode(Payload(
            visibleInMatch: visibleInMatch,
            gender: current.gender,
            preferredGender: filters.preferredGender,
            maxDistanceKm: filters.maxDistanceKm,
            sports: filters.sports.map(\.rawValue).sorted()
        ))
        let envelope: MatchPreferencesEnvelope = try await authenticatedRequest { token in
            APIRequest(method: .patch, path: "/v1/match/preferences", body: body, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
        return envelope.preferences
    }

    func candidates(filters: MatchFilters, cursor: String?) async throws -> MatchPage {
        var components = URLComponents(); components.path = "/v1/match/candidates"
        var query = [URLQueryItem(name: "limit", value: "20"), URLQueryItem(name: "gender", value: filters.preferredGender)]
        query.append(URLQueryItem(name: "maxDistanceKm", value: filters.maxDistanceKm.map(String.init) ?? "unlimited"))
        query.append(contentsOf: filters.sports.sorted { $0.rawValue < $1.rawValue }.map { URLQueryItem(name: "sport", value: $0.rawValue) })
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components.queryItems = query
        return try await authenticatedRequest { token in APIRequest(path: components.string ?? "/v1/match/candidates", headers: Self.authorization(token)) }
    }

    func swipe(targetUserID: String, direction: String) async throws -> SwipeResult {
        struct Payload: Encodable { let targetUserId: String; let direction: String }
        let body = try encoder.encode(Payload(targetUserId: targetUserID, direction: direction))
        return try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/match/swipes", body: body, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true) }
    }

    func matches() async throws -> [MatchSummary] {
        struct Envelope: Decodable { let matches: [MatchSummary] }
        return try await authenticatedRequest { token in
            APIRequest<Envelope>(path: "/v1/matches", headers: Self.authorization(token))
        }.matches
    }

    func unmatch(id: String) async throws {
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/matches/\(id)/unmatch", headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
    }

    func getOwnProfile() async throws -> WorkoutProfile {
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/me", headers: Self.authorization(token))
        }
        return envelope.profile
    }

    func previewOwnProfile() async throws -> WorkoutProfile {
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/me/preview", headers: Self.authorization(token))
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

    func getMatchPreferences() async throws -> MatchPreferences {
        let envelope: MatchPreferencesEnvelope = try await authenticatedRequest { token in
            APIRequest(path: "/v1/match/preferences", headers: Self.authorization(token))
        }
        return envelope.preferences
    }

    func updateMatchVisibility(_ visible: Bool) async throws -> MatchPreferences {
        let current = try await getMatchPreferences()
        let payload = MatchPreferencesPayload(
            visibleInMatch: visible,
            gender: current.gender,
            preferredGender: current.preferredGender,
            maxDistanceKm: current.maxDistanceKm,
            sports: current.sports
        )
        let body = try encoder.encode(payload)
        let envelope: MatchPreferencesEnvelope = try await authenticatedRequest { token in
            APIRequest(
                method: .patch,
                path: "/v1/match/preferences",
                body: body,
                headers: Self.jsonAuthorization(token),
                allowsConnectionRetry: true
            )
        }
        return envelope.preferences
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
        try await uploadPhotoWithReference(photo).profile
    }

    func uploadPhotoWithReference(_ photo: ProfilePhoto) async throws -> PhotoUploadResult {
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
        let uploadStem = URL(fileURLWithPath: upload.objectKey).deletingPathExtension().lastPathComponent
        let photoID = envelope.profile.photos.first {
            $0.url.deletingPathExtension().lastPathComponent == uploadStem
        }?.id
        return PhotoUploadResult(profile: envelope.profile, photoID: photoID)
    }

    func createPhotoUploadTickets(_ requests: [PhotoUploadRequest]) async throws -> [PhotoUploadTicket] {
        struct Payload: Encodable {
            let photos: [Item]
            struct Item: Encodable {
                let clientID: String
                let fileName: String
                let contentType: String
                let byteSize: Int
            }
        }
        let body = try encoder.encode(Payload(photos: requests.map {
            Payload.Item(clientID: $0.clientID, fileName: $0.photo.fileName, contentType: $0.photo.contentType, byteSize: $0.photo.data.count)
        }))
        let response: PhotoUploadBatchResponse = try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/me/photos/upload-urls", body: body, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
        return response.uploads.map {
            PhotoUploadTicket(clientID: $0.clientID, objectKey: $0.objectKey, uploadURL: $0.uploadURL, requiredHeaders: $0.requiredHeaders)
        }
    }

    func uploadPhoto(_ photo: ProfilePhoto, using ticket: PhotoUploadTicket) async throws -> PhotoUploadResult {
        try await client.upload(data: photo.data, to: ticket.uploadURL, contentType: photo.contentType, requiredHeaders: ticket.requiredHeaders)
        let completeBody = try encoder.encode(PhotoCompletePayload(objectKey: ticket.objectKey))
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/me/photo/complete", body: completeBody, headers: Self.jsonAuthorization(token), allowsConnectionRetry: true)
        }
        let uploadStem = URL(fileURLWithPath: ticket.objectKey).deletingPathExtension().lastPathComponent
        let photoID = envelope.profile.photos.first { $0.url.deletingPathExtension().lastPathComponent == uploadStem }?.id
        return PhotoUploadResult(profile: envelope.profile, photoID: photoID)
    }

    func deletePhoto() async throws {
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/me/photo", headers: Self.authorization(token))
        }
    }

    func deletePhoto(photoID: String) async throws {
        let _: EmptyResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/me/photos/\(photoID)", headers: Self.authorization(token))
        }
    }

    func reorderPhotos(_ photoIDs: [String]) async throws -> WorkoutProfile {
        struct Payload: Encodable { let photoIds: [String] }
        let body = try encoder.encode(Payload(photoIds: photoIDs))
        let envelope: ProfileEnvelope = try await authenticatedRequest { token in
            APIRequest(
                method: .patch,
                path: "/v1/me/photos/order",
                body: body,
                headers: Self.jsonAuthorization(token),
                allowsConnectionRetry: true
            )
        }
        return envelope.profile
    }

    func deleteAccount(currentPassword: String) async throws {
        struct DeletionResponse: Decodable { let status: String; let jobId: String }
        struct Confirmation: Encodable { let confirmation = "DELETE"; let currentPassword: String }
        let body = try encoder.encode(Confirmation(currentPassword: currentPassword))
        let _: DeletionResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/account", body: body, headers: Self.jsonAuthorization(token))
        }
    }

    func deleteAccount(appleCredential: AppleSignInCredential) async throws {
        struct AppleCredentialPayload: Encodable {
            let identityToken: String
            let authorizationCode: String
            let nonce: String
        }
        struct Confirmation: Encodable {
            let confirmation = "DELETE"
            let appleCredential: AppleCredentialPayload
        }
        struct DeletionResponse: Decodable { let status: String; let jobId: String }
        let body = try encoder.encode(Confirmation(appleCredential: AppleCredentialPayload(
            identityToken: appleCredential.identityToken,
            authorizationCode: appleCredential.authorizationCode,
            nonce: appleCredential.nonce
        )))
        let _: DeletionResponse = try await authenticatedRequest { token in
            APIRequest(method: .delete, path: "/v1/account", body: body, headers: Self.jsonAuthorization(token))
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
        // Strava is an optional integration. A stale status request must not
        // sign the user out of Lauver while the main session is recovering.
        try await authenticatedRequest(invalidateSessionOnUnauthorized: false) { token in
            APIRequest(path: "/v1/integrations/strava/status", headers: Self.authorization(token))
        }
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
        let validDirect = channelID.hasPrefix("dm-") && channelID.count == 43
        let validEvent = channelID.hasPrefix("event-") && channelID.count == 38
        guard (validDirect || validEvent), channelID.drop(while: { $0 != "-" }).dropFirst().allSatisfy({ $0.isHexDigit }) else { throw APIError.invalidRequest }
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
    func eventChat(eventID: String) async throws -> EventChatChannel {
        guard UUID(uuidString: eventID) != nil else { throw APIError.invalidRequest }
        return try await authenticatedRequest { token in
            APIRequest(path: "/v1/events/\(eventID)/chat", headers: Self.authorization(token))
        }
    }

    func reportChatMessage(channelID: String, messageID: String, reason: ReportReason, details: String) async throws -> ReportReceipt {
        guard channelID.range(of: #"^(dm-[a-f0-9]{40}|event-[a-f0-9]{32})$"#, options: .regularExpression) != nil,
              !messageID.isEmpty, messageID.count <= 128 else { throw APIError.invalidRequest }
        struct Payload: Encodable { let reason: ReportReason; let details: String }
        let body = try encoder.encode(Payload(reason: reason, details: details))
        return try await authenticatedRequest { token in
            APIRequest(method: .post, path: "/v1/chat/channels/\(channelID)/messages/\(messageID)/report", body: body, headers: Self.jsonAuthorization(token))
        }
    }

    func events(sport: String?, city: String?, cursor: String?) async throws -> EventPage {
        var components = URLComponents(); components.path = "/v1/events"
        var query: [URLQueryItem] = []
        if let sport { query.append(URLQueryItem(name: "sport", value: sport)) }
        if let city { query.append(URLQueryItem(name: "city", value: city)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components.queryItems = query.isEmpty ? nil : query
        return try await authenticatedRequest { token in APIRequest(path: components.string!, headers: Self.authorization(token)) }
    }

    func event(id: String) async throws -> PublicEvent {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(path: "/v1/events/\(id)", headers: Self.authorization(token)) }
        return envelope.event
    }

    func joinEvent(id: String) async throws -> PublicEvent {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/events/\(id)/join", headers: Self.authorization(token), allowsConnectionRetry: true) }
        return envelope.event
    }

    func leaveEvent(id: String) async throws -> PublicEvent {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(method: .delete, path: "/v1/events/\(id)/join", headers: Self.authorization(token)) }
        return envelope.event
    }

    func createEvent(_ draft: EventDraft) async throws -> PublicEvent {
        let body = try encoder.encode(draft)
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/events", body: body, headers: Self.jsonAuthorization(token)) }
        return envelope.event
    }
    func updateEvent(id: String, draft: EventDraft) async throws -> PublicEvent {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        let body = try encoder.encode(draft)
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(method: .patch, path: "/v1/events/\(id)", body: body, headers: Self.jsonAuthorization(token)) }
        return envelope.event
    }
    func cancelEvent(id: String) async throws -> PublicEvent {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        let envelope: EventEnvelope = try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/events/\(id)/cancel", headers: Self.jsonAuthorization(token)) }
        return envelope.event
    }
    func reportEvent(id: String, reason: String, details: String?, targetType: String) async throws -> String {
        guard UUID(uuidString: id) != nil else { throw APIError.invalidRequest }
        struct Payload: Encodable { let reason: String; let details: String?; let targetType: String }
        let body = try encoder.encode(Payload(reason: reason, details: details, targetType: targetType))
        struct Receipt: Decodable { let referenceId: String }
        let receipt: Receipt = try await authenticatedRequest { token in APIRequest(method: .post, path: "/v1/events/\(id)/report", body: body, headers: Self.jsonAuthorization(token)) }
        return receipt.referenceId
    }

    @MainActor
    private func authenticatedRequest<Response: Decodable>(
        invalidateSessionOnUnauthorized: Bool = true,
        _ request: (String) -> APIRequest<Response>
    ) async throws -> Response {
        guard let tokens = try sessionStore.read() else {
            throw APIError.unauthorized(code: "invalid_session", message: nil, requestID: nil)
        }
        do {
            return try await client.send(request(tokens.accessToken))
        } catch APIError.unauthorized {
            let accessToken: String
            do {
                accessToken = try await refreshedAccessToken(for: tokens)
            } catch let error as APIError {
                // A refresh task is shared by every authenticated request. The
                // request that observes its failure decides whether that
                // failure ends the Lauver session; an optional Strava status
                // probe must never weaken a concurrent primary request.
                if invalidateSessionOnUnauthorized, case .unauthorized = error {
                    invalidateSession(accessToken: tokens.accessToken)
                }
                throw error
            }
            do {
                return try await client.send(request(accessToken))
            } catch let error as APIError {
                if invalidateSessionOnUnauthorized, case .unauthorized = error {
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
            } catch { throw error }
        }
        refreshTask = (id, tokens, task)
        // Keep completedRefresh available for late requests that received a
        // 401 with the previous access token while the rotation was finishing.
        // It is replaced by the next rotation and cannot cross a sign-in,
        // because the previous token must match exactly.
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
final class CitySearchModel: NSObject, ObservableObject, @preconcurrency MKLocalSearchCompleterDelegate, CLLocationManagerDelegate {
    @Published var query = "" {
        didSet { completer.queryFragment = query }
    }
    @Published private(set) var results: [MKLocalSearchCompletion] = []
    @Published private(set) var errorMessage: String?

    private let completer = MKLocalSearchCompleter()
    private let locationManager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocation, Error>?
    private var authorizationContinuation: CheckedContinuation<Void, Error>?

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = .address
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        let candidates = Array(completer.results.prefix(12))
        // MKLocalSearchCompleter also returns streets, POIs and buildings for
        // address searches. Keep only results that resolve to one of the
        // administrative levels we can safely persist.
        Task { [weak self] in
            guard let self else { return }
            let filtered = await self.administrativeResults(from: candidates)
            guard self.query == completer.queryFragment else { return }
            self.results = filtered
        }
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
        let countryCode = placemark.isoCountryCode
        let cityName = placemark.locality
            ?? placemark.subAdministrativeArea
            ?? placemark.administrativeArea
            ?? placemark.country
        guard let countryCode, let cityName, !cityName.isEmpty else {
            throw CitySearchError.noResult
        }
        // Accept any MapKit result. MapKit may return a district, landmark,
        // station, address, or a city itself; normalize it to the best city
        // level fields available on the selected placemark. Do not perform a
        // second "city-only" search: that search rejects valid places such as
        // Shanghai when MapKit resolves the completion to a detailed result.
        return ProfileCity(
            name: cityName,
            regionCode: placemark.administrativeArea,
            countryCode: countryCode,
            latitude: placemark.coordinate.latitude,
            longitude: placemark.coordinate.longitude
        )
    }

    func currentCity() async throws -> ProfileCity {
        let location = try await currentLocation()
        let placemark = try await CLGeocoder().reverseGeocodeLocation(location).first
        guard let placemark else { throw CitySearchError.noResult }
        let cityName = placemark.locality
            ?? placemark.subAdministrativeArea
            ?? placemark.administrativeArea
            ?? placemark.country
        guard let cityName, !cityName.isEmpty, let countryCode = placemark.isoCountryCode else {
            throw CitySearchError.noResult
        }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = [cityName, placemark.administrativeArea, countryCode]
            .compactMap { $0 }
            .joined(separator: ", ")
        request.resultTypes = .address
        request.region = MKCoordinateRegion(
            center: location.coordinate,
            latitudinalMeters: 150_000,
            longitudinalMeters: 150_000
        )
        let response = try await MKLocalSearch(request: request).start()
        guard let cityItem = response.mapItems.first(where: {
            let item = $0.placemark
            let localityMatches = item.locality?.localizedCaseInsensitiveCompare(cityName) == .orderedSame
            let countyMatches = item.subAdministrativeArea?.localizedCaseInsensitiveCompare(cityName) == .orderedSame
            let nameMatches = item.name?.localizedCaseInsensitiveCompare(cityName) == .orderedSame
            return (localityMatches || countyMatches || nameMatches) &&
                item.thoroughfare == nil && item.subThoroughfare == nil
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

    private func currentLocation() async throws -> CLLocation {
        guard CLLocationManager.locationServicesEnabled() else { throw CitySearchError.locationDisabled }
        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: break
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
            try await waitForAuthorization()
        default:
            throw CitySearchError.locationDenied
        }
        return try await withCheckedThrowingContinuation { continuation in
            locationContinuation = continuation
            locationManager.requestLocation()
        }
    }

    private func administrativeResults(from completions: [MKLocalSearchCompletion]) async -> [MKLocalSearchCompletion] {
        await withTaskGroup(of: (Int, MKLocalSearchCompletion?).self, returning: [MKLocalSearchCompletion].self) { group in
            for (index, completion) in completions.enumerated() {
                group.addTask {
                    do {
                        let response = try await MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start()
                        guard let placemark = response.mapItems.first?.placemark else { return (index, nil) }
                        let administrativeNames = [
                            placemark.locality,
                            placemark.subAdministrativeArea,
                            placemark.administrativeArea,
                            placemark.country,
                        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                        let title = completion.title.trimmingCharacters(in: .whitespacesAndNewlines)
                        let subtitleParts = completion.subtitle.split(separator: ",").map {
                            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                        let matchesAdministrativeLevel = administrativeNames.contains(where: {
                            $0.localizedCaseInsensitiveCompare(title) == .orderedSame
                        }) || subtitleParts.contains(where: { part in
                            administrativeNames.contains { $0.localizedCaseInsensitiveCompare(part) == .orderedSame }
                        })
                        return (index, matchesAdministrativeLevel ? completion : nil)
                    } catch {
                        return (index, nil)
                    }
                }
            }
            var indexed: [(Int, MKLocalSearchCompletion)] = []
            for await (index, completion) in group {
                if let completion { indexed.append((index, completion)) }
            }
            return indexed.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    private func waitForAuthorization() async throws {
        if locationManager.authorizationStatus == .authorizedAlways || locationManager.authorizationStatus == .authorizedWhenInUse { return }
        try await withCheckedThrowingContinuation { continuation in
            authorizationContinuation = continuation
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            authorizationContinuation?.resume()
            authorizationContinuation = nil
        case .denied, .restricted:
            authorizationContinuation?.resume(throwing: CitySearchError.locationDenied)
            authorizationContinuation = nil
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        locationContinuation?.resume(returning: location)
        locationContinuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationContinuation?.resume(throwing: error)
        locationContinuation = nil
    }
}

enum CitySearchError: LocalizedError {
    case noResult
    case locationDisabled
    case locationDenied

    var errorDescription: String? {
        switch self {
        case .noResult: return "This place could not be normalized to a city. Try another search result."
        case .locationDisabled: return "Location Services are turned off. Enable them in Settings."
        case .locationDenied: return "Lauver needs location permission to identify your city."
        }
    }
}
