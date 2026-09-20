import Foundation
import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case simplifiedChinese = "zh-Hans"

    var id: String { rawValue }

    var locale: Locale {
        switch self {
        case .system:
            let preferred = Locale.preferredLanguages.first?.lowercased() ?? "en"
            return Locale(identifier: preferred.hasPrefix("zh") ? "zh-Hans" : "en")
        case .english:
            return Locale(identifier: "en")
        case .simplifiedChinese:
            return Locale(identifier: "zh-Hans")
        }
    }
}

@MainActor
final class AppLanguageStore: ObservableObject {
    @Published var selection: AppLanguage {
        didSet { stateStore.appLanguageRawValue = selection.rawValue }
    }

    private let stateStore: UIStateStore

    init(stateStore: UIStateStore = UIStateStore()) {
        self.stateStore = stateStore
        let rawValue = stateStore.appLanguageRawValue ?? AppLanguage.system.rawValue
        selection = AppLanguage(rawValue: rawValue) ?? .system
    }

    var locale: Locale { selection.locale }
}
