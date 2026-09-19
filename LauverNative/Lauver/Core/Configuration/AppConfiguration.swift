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
    let firebaseAPIKey: String?
    let googleIOSClientID: String?
    let googleReversedClientID: String?

    init(
        environment: AppEnvironment,
        apiBaseURL: URL,
        firebaseAPIKey: String? = nil,
        googleIOSClientID: String? = nil,
        googleReversedClientID: String? = nil
    ) {
        self.environment = environment
        self.apiBaseURL = apiBaseURL
        self.firebaseAPIKey = firebaseAPIKey
        self.googleIOSClientID = googleIOSClientID
        self.googleReversedClientID = googleReversedClientID
    }

    func overridingAPIBaseURL(_ apiBaseURL: URL) -> AppConfiguration {
        AppConfiguration(
            environment: environment,
            apiBaseURL: apiBaseURL,
            firebaseAPIKey: firebaseAPIKey,
            googleIOSClientID: googleIOSClientID,
            googleReversedClientID: googleReversedClientID
        )
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

        return AppConfiguration(
            environment: environment,
            apiBaseURL: apiBaseURL,
            firebaseAPIKey: configuredValue(infoDictionary["FIREBASE_API_KEY"]),
            googleIOSClientID: configuredValue(infoDictionary["GOOGLE_IOS_CLIENT_ID"]),
            googleReversedClientID: configuredValue(infoDictionary["GOOGLE_REVERSED_CLIENT_ID"])
        )
    }

    private static func configuredValue(_ value: Any?) -> String? {
        guard let value = value as? String,
              !value.isEmpty,
              !value.hasPrefix("$(") else { return nil }
        return value
    }
}

enum AppConfigurationError: Error, Equatable {
    case missingOrInvalidEnvironment
    case missingOrInvalidAPIBaseURL
}
