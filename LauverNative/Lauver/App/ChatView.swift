import SwiftUI
import StreamChat
import StreamChatSwiftUI

@MainActor
final class ChatConnection: ObservableObject {
    @Published private(set) var client: ChatClient?
    private var context: StreamChatSwiftUI.StreamChat?
    private var connecting: Task<ChatClient, Error>?
    private var generation = UUID()

    func connect(service: any ChatServicing) async throws -> ChatClient {
        if let client { return client }
        if let connecting { return try await connecting.value }
        let generation = self.generation
        let task = Task { @MainActor in
            let identity = try await service.chatToken()
            try Task.checkCancellation()
            let client = ChatClient(config: ChatClientConfig(apiKey: .init(identity.apiKey)))
            do {
                try await client.connectUser(userInfo: .init(id: identity.userId), tokenProvider: { completion in
                    Task { @MainActor in
                        do {
                            let refreshed = try await service.chatToken()
                            guard refreshed.userId == identity.userId, refreshed.apiKey == identity.apiKey else { throw APIError.unauthorized(code: "chat_session_changed", message: nil, requestID: nil) }
                            completion(.success(try Token(rawValue: refreshed.token)))
                        } catch { completion(.failure(error)) }
                    }
                })
                try Task.checkCancellation()
                guard generation == self.generation else { throw CancellationError() }
                self.context = StreamChatSwiftUI.StreamChat(chatClient: client, utils: Utils(composerConfig: ComposerConfig(isVoiceRecordingEnabled: false)))
                self.client = client
                return client
            } catch {
                await client.logout()
                throw error
            }
        }
        connecting = task
        defer { if generation == self.generation { connecting = nil } }
        return try await task.value
    }

    func stop() {
        generation = UUID()
        connecting?.cancel()
        connecting = nil
        let previous = client
        client = nil
        context = nil
        Task { await previous?.logout() }
    }
}

@MainActor
final class LauverChatFactory: ViewFactory {
    let chatClient: ChatClient
    var styles = RegularStyles()
    let service: any ChatServicing
    init(client: ChatClient, service: any ChatServicing) { chatClient = client; self.service = service }
    func makeMessageComposerViewType(options: MessageComposerViewTypeOptions) -> some View {
        LauverTextComposer(service: service, channelID: options.channelController.cid?.id)
    }
    func makeLeadingComposerView(options: LeadingComposerViewOptions) -> some View { EmptyView() }
}

struct MessagesView: View {
    @EnvironmentObject private var chat: ChatConnection
    let service: any ChatServicing
    @State private var errorMessage: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let client = chat.client {
                ChatChannelListView(viewFactory: LauverChatFactory(client: client, service: service), title: "Messages", embedInNavigationView: false)
            } else if let errorMessage {
                VStack { ErrorStateView(message: errorMessage, requestID: nil); RetryButton { attempt += 1 } }.padding()
            } else { ProgressView("Connecting to messages") }
        }
        .accessibilityIdentifier("screen-messages")
        .task(id: attempt) {
            errorMessage = nil
            do { _ = try await chat.connect(service: service) }
            catch { if !Task.isCancelled { errorMessage = (error as? APIError)?.userMessage ?? "Messages could not connect. Please try again." } }
        }
    }
}

struct DirectConversationView: View {
    @EnvironmentObject private var chat: ChatConnection
    let service: any ChatServicing
    let targetUserID: String
    @State private var controller: ChatChannelController?
    @State private var errorMessage: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let controller, let client = chat.client {
                ChatChannelView(viewFactory: LauverChatFactory(client: client, service: service), channelController: controller)
            } else if let errorMessage {
                VStack { ErrorStateView(message: errorMessage, requestID: nil); RetryButton { attempt += 1 } }.padding()
            } else { ProgressView("Opening conversation") }
        }
        .task(id: attempt) {
            errorMessage = nil
            do {
                let client = try await chat.connect(service: service)
                let channel = try await service.directChat(targetUserID: targetUserID)
                try Task.checkCancellation()
                controller = client.channelController(for: try ChannelId(cid: channel.id))
            } catch { if !Task.isCancelled { errorMessage = (error as? APIError)?.userMessage ?? "This conversation could not be opened." } }
        }
    }
}

struct LauverTextComposer: View {
    let service: any ChatServicing
    let channelID: String?
    @State private var text = ""
    @State private var pending: (id: UUID, text: String)?
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
                Button("Retry send") { Task { await send() } }.disabled(sending)
            }
            HStack {
                TextField("Message", text: $text, axis: .vertical).lineLimit(1...5)
                    .disabled(pending != nil || sending).accessibilityIdentifier("chat-message-input")
                Button(sending ? "Sending…" : "Send") { Task { await send() } }
                    .disabled(sending || pending != nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 2000)
                    .accessibilityIdentifier("chat-message-send")
            }
        }.padding().background(LauverDesign.ColorToken.surface)
    }

    @MainActor private func send() async {
        guard !sending, let channelID else { return }
        let message = pending ?? (id: UUID(), text: text.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !message.text.isEmpty, message.text.count <= 2000 else { return }
        pending = message; sending = true; errorMessage = nil
        defer { sending = false }
        do {
            try await service.sendChatMessage(channelID: channelID, id: message.id, text: message.text)
            text = ""; pending = nil
        } catch { errorMessage = (error as? APIError)?.userMessage ?? "Message could not be sent. Please retry." }
    }
}
