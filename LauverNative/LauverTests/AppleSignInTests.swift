import XCTest
@testable import Lauver

final class AppleSignInTests: XCTestCase {
    func testNonceIsRandomURLSafeAndLongEnough() throws {
        let first = try AppleSignInNonce.generate()
        let second = try AppleSignInNonce.generate()

        XCTAssertNotEqual(first, second)
        XCTAssertGreaterThanOrEqual(first.count, 32)
        XCTAssertNil(first.range(of: "[^A-Za-z0-9_-]", options: .regularExpression))
    }

    func testNonceHashUsesSHA256Hex() {
        XCTAssertEqual(
            AppleSignInNonce.hash("test-nonce"),
            "ed04c4e9ea6c49cf9ceb39098787c5b9842524f96b07ef45305476a11caec9b4"
        )
    }
}
