import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text(AppMetadata.displayName)
                .font(.largeTitle.bold())
                .accessibilityIdentifier("lauver-title")

            Text("Native iOS MVP")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("lauver-subtitle")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
