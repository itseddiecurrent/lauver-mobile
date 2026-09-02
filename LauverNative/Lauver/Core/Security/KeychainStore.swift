import Foundation
import Security

protocol SecureTokenStoring {
    func save(_ token: String, for account: String) throws
    func readToken(for account: String) throws -> String?
    func deleteToken(for account: String) throws
}

enum KeychainError: Error, Equatable {
    case unexpectedStatus(OSStatus)
    case invalidData
}

struct KeychainStore: SecureTokenStoring {
    let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "ai.lauver.app") {
        self.service = service
    }

    func save(_ token: String, for account: String) throws {
        guard let data = token.data(using: .utf8) else { throw KeychainError.invalidData }

        let query = baseQuery(account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if updateStatus == errSecItemNotFound {
            var addQuery = query
            attributes.forEach { addQuery[$0.key] = $0.value }
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
        } else if updateStatus != errSecSuccess {
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    func readToken(for account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return token
    }

    func deleteToken(for account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
