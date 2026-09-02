import SwiftUI

enum LauverDesign {
    enum Spacing {
        static let small: CGFloat = 8
        static let medium: CGFloat = 16
        static let large: CGFloat = 24
    }

    enum Radius {
        static let card: CGFloat = 16
        static let button: CGFloat = 12
    }

    enum ColorToken {
        static let accent = Color.green
        static let surface = Color(.secondarySystemBackground)
        static let danger = Color.red
    }
}

enum StateComponentIdentifiers {
    static let loading = "state-loading"
    static let empty = "state-empty"
    static let error = "state-error"
    static let retry = "state-retry"
}

struct LoadingStateView: View {
    let title: String

    var body: some View {
        VStack(spacing: LauverDesign.Spacing.small) {
            ProgressView()
            Text(title).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(StateComponentIdentifiers.loading)
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text(message))
            .accessibilityIdentifier(StateComponentIdentifiers.empty)
    }
}

struct ErrorStateView: View {
    let message: String
    let requestID: String?

    var body: some View {
        VStack(spacing: LauverDesign.Spacing.small) {
            Image(systemName: "wifi.exclamationmark")
                .font(.title)
                .foregroundStyle(LauverDesign.ColorToken.danger)
            Text("Unable to connect").font(.headline)
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let requestID {
                Text("Request ID: \(requestID)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("request-id")
            }
        }
        .accessibilityIdentifier(StateComponentIdentifiers.error)
    }
}

struct RetryButton: View {
    let action: () -> Void

    var body: some View {
        Button("Retry", action: action)
            .buttonStyle(.borderedProminent)
            .tint(LauverDesign.ColorToken.accent)
            .accessibilityIdentifier(StateComponentIdentifiers.retry)
    }
}
