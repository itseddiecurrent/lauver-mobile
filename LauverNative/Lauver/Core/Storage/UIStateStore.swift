import Foundation

enum AppTab: String, CaseIterable, Identifiable {
    case discover
    case events
    case messages
    case profile

    var id: String { rawValue }

    var title: String {
        rawValue.capitalized
    }

    var systemImage: String {
        switch self {
        case .discover: "safari"
        case .events: "calendar"
        case .messages: "message"
        case .profile: "person"
        }
    }
}

protocol UIStateStoring: AnyObject {
    var selectedTab: AppTab { get set }
    func reset()
}

final class UIStateStore: UIStateStoring {
    private enum Keys {
        static let selectedTab = "ui.selectedTab"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var selectedTab: AppTab {
        get {
            guard let rawValue = defaults.string(forKey: Keys.selectedTab) else { return .discover }
            return AppTab(rawValue: rawValue) ?? .discover
        }
        set {
            defaults.set(newValue.rawValue, forKey: Keys.selectedTab)
        }
    }

    func reset() {
        defaults.removeObject(forKey: Keys.selectedTab)
    }
}
