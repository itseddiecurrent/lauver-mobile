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
        static let accent = Color(red: 232 / 255, green: 96 / 255, blue: 44 / 255)
        static let background = adaptive(light: 0xF0EDE8, dark: 0x161412)
        static let surface = adaptive(light: 0xEAE6DF, dark: 0x201D1A)
        static let elevated = adaptive(light: 0xFFFFFF, dark: 0x2C2825)
        static let text = adaptive(light: 0x1C1A18, dark: 0xEDE9E3)
        static let textSecondary = adaptive(light: 0x555555, dark: 0xB0A498)
        static let textMuted = adaptive(light: 0x999999, dark: 0x9A8E84)
        static let divider = adaptive(light: 0xD9D0C7, dark: 0x2E2A26)
        static let danger = Color.red

        private static func adaptive(light: UInt32, dark: UInt32) -> Color {
            Color(uiColor: UIColor { traits in
                let hex = traits.userInterfaceStyle == .dark ? dark : light
                return UIColor(red: CGFloat((hex >> 16) & 255) / 255,
                               green: CGFloat((hex >> 8) & 255) / 255,
                               blue: CGFloat(hex & 255) / 255, alpha: 1)
            })
        }
    }
}

enum StateComponentIdentifiers {
    static let loading = "state-loading"
    static let empty = "state-empty"
    static let error = "state-error"
    static let retry = "state-retry"
}

struct LoadingStateView: View {
    let title: LocalizedStringKey

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
    let title: LocalizedStringKey
    let message: LocalizedStringKey

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text(message))
            .accessibilityIdentifier(StateComponentIdentifiers.empty)
    }
}

struct ProfileLocationRequiredView: View {
    var body: some View {
        VStack(spacing: LauverDesign.Spacing.small) {
            Image(systemName: "mappin.and.ellipse")
                .font(.title)
                .foregroundStyle(LauverDesign.ColorToken.accent)
            Text("Complete your profile location to start discovering/matching")
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(LauverDesign.ColorToken.text)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.horizontal, LauverDesign.Spacing.large)
        .accessibilityIdentifier("profile-location-required")
    }
}

struct ErrorStateView: View {
    let message: String
    let requestID: String?
    var title: String = "Unable to connect"
    var systemImage: String = "wifi.exclamationmark"

    var body: some View {
        VStack(spacing: LauverDesign.Spacing.small) {
            Image(systemName: systemImage)
                .font(.title)
                .foregroundStyle(LauverDesign.ColorToken.danger)
            Text(title).font(.headline)
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

struct LauverPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.bold))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                LauverDesign.ColorToken.accent.opacity(configuration.isPressed ? 0.82 : 1),
                in: RoundedRectangle(cornerRadius: 14)
            )
            .shadow(color: LauverDesign.ColorToken.accent.opacity(0.25), radius: 8, y: 4)
            .opacity(isEnabled ? 1 : 0.5)
    }
}

struct LauverSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(LauverDesign.ColorToken.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(
                LauverDesign.ColorToken.elevated.opacity(configuration.isPressed ? 0.7 : 1),
                in: RoundedRectangle(cornerRadius: LauverDesign.Radius.button)
            )
            .overlay {
                RoundedRectangle(cornerRadius: LauverDesign.Radius.button)
                    .stroke(LauverDesign.ColorToken.divider, lineWidth: 1)
            }
            .opacity(isEnabled ? 1 : 0.5)
    }
}
