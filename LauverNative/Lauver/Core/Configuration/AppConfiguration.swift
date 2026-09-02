import Foundation

enum AppEnvironment: String, CaseIterable {
    case staging
    case production
}

enum AppMetadata {
    static let displayName = "Lauver"
}

struct AppConfiguration: Equatable {
    let environment: AppEnvironment
    let apiBaseURL: URL

    func overridingAPIBaseURL(_ apiBaseURL: URL) -> AppConfiguration {
        AppConfiguration(environment: environment, apiBaseURL: apiBaseURL)
    }

    static func from(bundle: Bundle = .main) throws -> AppConfiguration {
        try from(infoDictionary: bundle.infoDictionary ?? [:])
    }

    static func from(infoDictionary: [String: Any]) throws -> AppConfiguration {
        guard
            let rawEnvironment = infoDictionary["APP_ENVIRONMENT"] as? String,
            let environment = AppEnvironment(rawValue: rawEnvironment)
        else {
            throw AppConfigurationError.missingOrInvalidEnvironment
        }

        guard
            let rawURL = infoDictionary["API_BASE_URL"] as? String,
            let apiBaseURL = URL(string: rawURL),
            apiBaseURL.scheme == "https",
            apiBaseURL.host != nil
        else {
            throw AppConfigurationError.missingOrInvalidAPIBaseURL
        }

        return AppConfiguration(environment: environment, apiBaseURL: apiBaseURL)
    }
}

enum AppConfigurationError: Error, Equatable {
    case missingOrInvalidEnvironment
    case missingOrInvalidAPIBaseURL
}
