import Foundation

enum AppTab: String, CaseIterable, Identifiable {
    case discover
    case match
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
        case .match: "person.2"
        case .events: "calendar"
        case .messages: "message"
        case .profile: "person"
        }
    }
}

protocol MatchFilterStoring: AnyObject {
    var matchFiltersData: Data? { get set }
}

protocol UIStateStoring: AnyObject {
    var selectedTab: AppTab { get set }
    func reset()
}

final class UIStateStore: UIStateStoring, MatchFilterStoring {
    private enum Keys {
        static let selectedTab = "ui.selectedTab"
        static let matchFilters = "ui.match.filters"
        static let appLanguage = "lauver.app-language"
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

    var matchFiltersData: Data? {
        get { defaults.data(forKey: Keys.matchFilters) }
        set { defaults.set(newValue, forKey: Keys.matchFilters) }
    }

    var appLanguageRawValue: String? {
        get { defaults.string(forKey: Keys.appLanguage) }
        set { defaults.set(newValue, forKey: Keys.appLanguage) }
    }

    func reset() {
        defaults.removeObject(forKey: Keys.selectedTab)
        defaults.removeObject(forKey: Keys.matchFilters)
        defaults.removeObject(forKey: Keys.appLanguage)
    }
}
