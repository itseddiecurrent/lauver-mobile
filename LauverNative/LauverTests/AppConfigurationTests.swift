import Foundation
import XCTest
@testable import Lauver

final class AppConfigurationTests: XCTestCase {
    func testMetadataUsesExpectedDisplayName() {
        XCTAssertEqual(AppMetadata.displayName, "Lauver")
    }

    func testEnvironmentCasesRemainExplicit() {
        XCTAssertEqual(AppEnvironment.allCases, [.staging, .production])
    }

    func testConfigurationLoadsStagingValues() throws {
        let configuration = try AppConfiguration.from(infoDictionary: [
            "APP_ENVIRONMENT": "staging",
            "API_BASE_URL": "https://lauver-api-staging.onrender.com"
        ])

        XCTAssertEqual(configuration.environment, .staging)
        XCTAssertEqual(configuration.apiBaseURL.absoluteString, "https://lauver-api-staging.onrender.com")
    }

    func testConfigurationRejectsMissingEnvironment() {
        XCTAssertThrowsError(try AppConfiguration.from(infoDictionary: [
            "API_BASE_URL": "https://lauver-api-staging.onrender.com"
        ])) { error in
            XCTAssertEqual(error as? AppConfigurationError, .missingOrInvalidEnvironment)
        }
    }

    func testConfigurationRejectsUnknownEnvironment() {
        XCTAssertThrowsError(try AppConfiguration.from(infoDictionary: [
            "APP_ENVIRONMENT": "preview",
            "API_BASE_URL": "https://lauver-api-staging.onrender.com"
        ])) { error in
            XCTAssertEqual(error as? AppConfigurationError, .missingOrInvalidEnvironment)
        }
    }

    func testConfigurationRejectsInsecureAPIURL() {
        XCTAssertThrowsError(try AppConfiguration.from(infoDictionary: [
            "APP_ENVIRONMENT": "production",
            "API_BASE_URL": "http://api.lauver.ai"
        ])) { error in
            XCTAssertEqual(error as? AppConfigurationError, .missingOrInvalidAPIBaseURL)
        }
    }

    func testConfigurationRejectsURLWithoutHost() {
        XCTAssertThrowsError(try AppConfiguration.from(infoDictionary: [
            "APP_ENVIRONMENT": "staging",
            "API_BASE_URL": "https:api-staging"
        ])) { error in
            XCTAssertEqual(error as? AppConfigurationError, .missingOrInvalidAPIBaseURL)
        }
    }
}
