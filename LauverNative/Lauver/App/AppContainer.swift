import Foundation

struct AppContainer {
    let configuration: AppConfiguration
    let healthService: any HealthServicing
    let authService: any AuthServicing
    let discoverService: any DiscoverServicing
    let profileService: any ProfileServicing
    let safetyService: any SafetyServicing
    let authSessionStore: any AuthSessionStoring
    let appleUserIdentifierStore: any AppleUserIdentifierStoring
    let appleCredentialStateChecker: any AppleCredentialStateChecking
    let tokenStore: any SecureTokenStoring
    let uiStateStore: any UIStateStoring

    static func live(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) throws -> AppContainer {
        var configuration = try AppConfiguration.from(bundle: bundle)
        let arguments = processInfo.arguments
        let uiStateStore = UIStateStore()
        let tokenStore = KeychainStore()
        let authSessionStore = KeychainAuthSessionStore(tokenStore: tokenStore)
        let appleUserIdentifierStore = KeychainAppleUserIdentifierStore(tokenStore: tokenStore)

        if arguments.contains("-ui-testing-reset-state") {
            uiStateStore.reset()
        }
        if arguments.contains("-ui-testing-reset-auth") {
            try? authSessionStore.clear()
            try? appleUserIdentifierStore.clear()
        }

        let sessionConfiguration = URLSessionConfiguration.ephemeral
        if arguments.contains("-ui-testing-offline") {
            configuration = configuration.overridingAPIBaseURL(URL(string: "https://127.0.0.1:1")!)
            sessionConfiguration.timeoutIntervalForRequest = 1
            sessionConfiguration.timeoutIntervalForResource = 1
        }

        let client = APIClient(
            baseURL: configuration.apiBaseURL,
            session: URLSession(configuration: sessionConfiguration),
            retryPolicy: arguments.contains("-ui-testing-offline")
                ? RetryPolicy(maxAttempts: 1)
                : .standard
        )

        #if DEBUG
        if arguments.contains("-diagnose-network") {
            Task {
                for method in [HTTPMethod.get, .patch, .post] {
                    let endpoint = method == .get ? "/readyz"
                        : method == .patch ? "/v1/me" : "/v1/me/photo/upload-url"
                    do {
                        let _: EmptyResponse = try await client.send(APIRequest(
                            method: method,
                            path: endpoint,
                            body: method == .get ? nil : Data("{}".utf8),
                            headers: ["Content-Type": "application/json"]
                        ))
                    } catch let error as APIError {
                        if case .unauthorized = error {
                            print("LauverTransport probe method=\(method.rawValue) authenticated-route=401")
                        }
                    } catch {}
                }
            }
        }
        #endif

        let healthService: any HealthServicing = arguments.contains("-ui-testing-health-success")
            ? UITestHealthService()
            : HealthService(client: client)
        let authService: any AuthServicing = arguments.contains("-ui-testing-auth-flow")
            ? UITestAuthService()
            : AuthService(client: client)
        let profileService: any ProfileServicing = arguments.contains("-ui-testing-authenticated") || arguments.contains("-ui-testing-auth-flow")
            ? UITestProfileService()
            : ProfileService(client: client, authService: authService, sessionStore: authSessionStore)
        let testSafetyService = UITestSafetyService()

        return AppContainer(
            configuration: configuration,
            healthService: healthService,
            authService: authService,
            discoverService: arguments.contains("-ui-testing-authenticated") || arguments.contains("-ui-testing-auth-flow")
                ? UITestDiscoverService(safetyService: testSafetyService)
                : ProfileService(client: client, authService: authService, sessionStore: authSessionStore),
            profileService: profileService,
            safetyService: arguments.contains("-ui-testing-authenticated") || arguments.contains("-ui-testing-auth-flow")
                ? testSafetyService
                : ProfileService(client: client, authService: authService, sessionStore: authSessionStore),
            authSessionStore: authSessionStore,
            appleUserIdentifierStore: appleUserIdentifierStore,
            appleCredentialStateChecker: AppleCredentialStateChecker(),
            tokenStore: tokenStore,
            uiStateStore: uiStateStore
        )
    }
}

private final class UITestSafetyService: SafetyServicing {
    private var blocked: [BlockedUser] = []
    func block(userID: String) async throws { blocked = [BlockedUser(id: userID, displayName: "UI Test Runner", cityName: "Shanghai")] }
    func isBlocked(userID: String) -> Bool { blocked.contains { $0.id == userID } }
    func unblock(userID: String) async throws { blocked.removeAll { $0.id == userID } }
    func blockedUsers(cursor: String?) async throws -> BlockedUsersPage { BlockedUsersPage(users: blocked, nextCursor: nil) }
    func report(userID: String, reason: ReportReason, details: String, blockUser: Bool) async throws -> ReportReceipt {
        if blockUser { try await block(userID: userID) }
        return ReportReceipt(referenceId: "ui-test-report-reference", blockedUser: blockUser)
    }
}

private final class UITestProfileService: ProfileServicing {
    private var profile = WorkoutProfile(
        id: "ui-test-user",
        displayName: "UI Test Runner",
        bio: "Morning miles before coffee.",
        photoURL: nil,
        city: ProfileCity(
            name: "Shanghai",
            regionCode: "SH",
            countryCode: "CN",
            latitude: 31.2304,
            longitude: 121.4737
        ),
        sports: [ProfileSport(
            sport: .running,
            paceValue: 5.5,
            paceUnit: "min/km"
        )],
        trainingTimes: [TrainingTime(weekday: 1, timeBucket: .morning)],
        isComplete: true
    )

    func getOwnProfile() async throws -> WorkoutProfile { profile }
    func getProfile(userID: String) async throws -> WorkoutProfile {
        _ = userID
        return profile
    }
    func updateProfile(_ draft: ProfileDraft) async throws -> WorkoutProfile {
        profile = WorkoutProfile(
            id: profile.id,
            displayName: draft.displayName,
            bio: draft.bio,
            photoURL: profile.photoURL,
            city: draft.city,
            sports: draft.selectedSports.sorted { $0.rawValue < $1.rawValue }.map {
                ProfileSport(
                    sport: $0,
                    paceValue: $0.parsedPace(draft.paceValues[$0] ?? ""),
                    paceUnit: $0.paceUnit
                )
            },
            trainingTimes: Array(draft.trainingTimes),
            isComplete: !draft.displayName.isEmpty && draft.city != nil && !draft.selectedSports.isEmpty && !draft.trainingTimes.isEmpty
        )
        return profile
    }
    func uploadPhoto(_ photo: ProfilePhoto) async throws -> WorkoutProfile {
        _ = photo
        return profile
    }
    func deletePhoto() async throws {}
}

private struct UITestAuthService: AuthServicing {
    func register(email: String, password: String) async throws -> AuthSession {
        session(email: email)
    }

    func login(email: String, password: String) async throws -> AuthSession {
        session(email: email)
    }

    func signInWithApple(credential: AppleSignInCredential) async throws -> AuthSession {
        session(email: credential.email ?? "runner@privaterelay.appleid.com")
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        session(email: "runner@example.com")
    }

    func logout(refreshToken: String) async throws {}

    func forgotPassword(email: String) async throws {}

    func resetPassword(token: String, password: String) async throws {}

    func restore(accessToken: String) async throws -> AuthUser {
        AuthUser(id: "ui-test-user", email: "runner@example.com")
    }

    private func session(email: String) -> AuthSession {
        AuthSession(
            user: AuthUser(id: "ui-test-user", email: email.lowercased()),
            accessToken: "ui-test-access-token",
            refreshToken: "ui-test-refresh-token",
            expiresIn: 900
        )
    }
}

private struct UITestHealthService: HealthServicing {
    func fetchHealth() async throws -> HealthResponse {
        HealthResponse(status: "ok", service: "lauver-api")
    }
}

private struct UITestDiscoverService: DiscoverServicing {
    let safetyService: UITestSafetyService
    func discover(filters: DiscoverFilters, cursor: String?) async throws -> DiscoverPage {
        if safetyService.isBlocked(userID: "ui-test-partner") { return DiscoverPage(users: [], nextCursor: nil) }
        if filters.sport != nil && filters.sport != .running { return DiscoverPage(users: [], nextCursor: nil) }
        if filters.paceMin.map({ 5.5 < $0 }) == true || filters.paceMax.map({ 5.5 > $0 }) == true {
            return DiscoverPage(users: [], nextCursor: nil)
        }
        return DiscoverPage(users: [DiscoverUser(
            id: "ui-test-partner", displayName: "Nearby Runner", photoURL: nil,
            city: ProfileCity(name: "Shanghai", regionCode: "SH", countryCode: "CN", latitude: nil, longitude: nil),
            approximateDistanceKm: 0,
            sports: [ProfileSport(sport: .running, paceValue: 5.5, paceUnit: "min/km")],
            commonSports: [.running]
        )], nextCursor: nil)
    }
}
