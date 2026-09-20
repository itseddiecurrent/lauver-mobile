import SwiftUI

@main
struct LauverApp: App {
    private let bootstrap: AppBootstrap
    @StateObject private var languageStore: AppLanguageStore

    init() {
        do {
            let container = try AppContainer.live()
            bootstrap = .ready(container)
            _languageStore = StateObject(wrappedValue: AppLanguageStore(stateStore: container.uiStateStore))
        } catch {
            bootstrap = .failed
            _languageStore = StateObject(wrappedValue: AppLanguageStore())
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch bootstrap {
                case let .ready(container):
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-ui-testing-public-profile") {
                        NavigationStack { OtherProfileView(profile: Self.publicProfileFixture) }
                    } else {
                        ContentView(container: container)
                    }
                    #else
                    ContentView(container: container)
                    #endif
                case .failed:
                    ErrorStateView(
                        message: "The app configuration is unavailable.",
                        requestID: nil
                    )
                    .padding()
                }
            }
            .environmentObject(languageStore)
            .environment(\.locale, languageStore.locale)
        }
    }

    #if DEBUG
    // Keep the public view's privacy regression independent of session/network state.
    // Include coordinates in the input to verify that the view never renders them.
    private static let publicProfileFixture = WorkoutProfile(
        id: "public-profile-fixture", displayName: "Public Runner", bio: "Morning workouts",
        photoURL: nil,
        city: ProfileCity(name: "Shanghai", regionCode: "SH", countryCode: "CN",
                          latitude: 31.2304, longitude: 121.4737),
        sports: [ProfileSport(sport: .running, paceValue: 5.2,
                              paceUnit: "min/km")],
        trainingTimes: [], isComplete: true
    )
    #endif
}

private enum AppBootstrap {
    case ready(AppContainer)
    case failed
}
