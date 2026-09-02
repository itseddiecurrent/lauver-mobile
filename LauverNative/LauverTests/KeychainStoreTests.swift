import Foundation
import XCTest
@testable import Lauver

final class KeychainStoreTests: XCTestCase {
    private let account = "step-02-test-token"
    private let service = "ai.lauver.tests.step-02"

    override func setUpWithError() throws {
        try KeychainStore(service: service).deleteToken(for: account)
    }

    override func tearDownWithError() throws {
        try KeychainStore(service: service).deleteToken(for: account)
    }

    func testTokenSurvivesAdapterRecreationAndCanBeDeleted() throws {
        let initialStore = KeychainStore(service: service)
        try initialStore.save("test-refresh-token", for: account)

        let recreatedStore = KeychainStore(service: service)
        XCTAssertEqual(try recreatedStore.readToken(for: account), "test-refresh-token")

        try recreatedStore.deleteToken(for: account)
        XCTAssertNil(try KeychainStore(service: service).readToken(for: account))
    }

    func testUpdatingTokenReplacesExistingValue() throws {
        let store = KeychainStore(service: service)
        try store.save("first", for: account)
        try store.save("second", for: account)

        XCTAssertEqual(try store.readToken(for: account), "second")
    }
}
