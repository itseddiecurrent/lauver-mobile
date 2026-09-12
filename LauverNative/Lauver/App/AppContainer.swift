import Foundation

struct AppContainer {
    let configuration: AppConfiguration
    let healthService: any HealthServicing
    let authService: any AuthServicing
    let profileService: any ProfileServicing
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

        let healthService: any HealthServicing = arguments.contains("-ui-testing-health-success")
            ? UITestHealthService()
            : HealthService(client: client)
        let authService: any AuthServicing = arguments.contains("-ui-testing-auth-flow")
            ? UITestAuthService()
            : AuthService(client: client)
        let profileService: any ProfileServicing = arguments.contains("-ui-testing-authenticated") || arguments.contains("-ui-testing-auth-flow")
            ? UITestProfileService()
            : ProfileService(client: client, authService: authService, sessionStore: authSessionStore)

        return AppContainer(
            configuration: configuration,
            healthService: healthService,
            authService: authService,
            profileService: profileService,
            authSessionStore: authSessionStore,
            appleUserIdentifierStore: appleUserIdentifierStore,
            appleCredentialStateChecker: AppleCredentialStateChecker(),
            tokenStore: tokenStore,
            uiStateStore: uiStateStore
        )
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
            paceUnit: "min/km",
            paceBracket: "moderate"
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
                    paceUnit: $0.paceUnit,
                    paceBracket: nil
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
