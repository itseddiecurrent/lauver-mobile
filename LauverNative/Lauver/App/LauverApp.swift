import SwiftUI

@main
struct LauverApp: App {
    private let bootstrap: AppBootstrap

    init() {
        do {
            bootstrap = .ready(try AppContainer.live())
        } catch {
            bootstrap = .failed
        }
    }

    var body: some Scene {
        WindowGroup {
            switch bootstrap {
            case let .ready(container):
                ContentView(container: container)
            case .failed:
                ErrorStateView(
                    message: "The app configuration is unavailable.",
                    requestID: nil
                )
                .padding()
            }
        }
    }
}

private enum AppBootstrap {
    case ready(AppContainer)
    case failed
}
