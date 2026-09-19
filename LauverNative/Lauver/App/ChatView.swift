import SwiftUI
import StreamChat
import StreamChatSwiftUI

@MainActor
final class ChatConnection: ObservableObject {
    @Published private(set) var client: ChatClient?
    @Published private(set) var unreadMessages = 0
    @Published var reportMessage: ChatMessage?
    private var context: StreamChatSwiftUI.StreamChat?
    private var connecting: Task<ChatClient, Error>?
    private var generation = UUID()
    private var currentUserController: CurrentChatUserController?

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
                let messageListConfig = MessageListConfig(supportedMessageActions: { [weak self] options in
                    var actions = MessageAction.defaultActions(for: options)
                    guard let self, options.message.author.id != identity.userId else { return actions }

                    actions.append(MessageAction(
                        id: "lauver-report-message",
                        title: "Report Message",
                        iconName: "flag",
                        action: { self.reportMessage = options.message },
                        confirmationPopup: nil,
                        isDestructive: false
                    ))
                    return actions
                })
                let utils = Utils(
                    messageListConfig: messageListConfig,
                    composerConfig: ComposerConfig(isVoiceRecordingEnabled: false)
                )
                self.context = StreamChatSwiftUI.StreamChat(chatClient: client, utils: utils)
                let userController = client.currentUserController()
                userController.delegate = self
                self.currentUserController = userController
                self.unreadMessages = userController.unreadCount.messages
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
        currentUserController?.delegate = nil
        currentUserController = nil
        unreadMessages = 0
        Task { await previous?.logout() }
    }
}

extension ChatConnection: CurrentChatUserControllerDelegate {
    func currentUserController(
        _ controller: CurrentChatUserController,
        didChangeCurrentUserUnreadCount unreadCount: UnreadCount
    ) {
        unreadMessages = unreadCount.messages
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
        .background(LauverDesign.ColorToken.background)
        .toolbarBackground(LauverDesign.ColorToken.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(LauverDesign.ColorToken.accent)
        .accessibilityIdentifier("screen-messages")
        .task(id: attempt) {
            errorMessage = nil
            do { _ = try await chat.connect(service: service) }
            catch { if !Task.isCancelled { errorMessage = (error as? APIError)?.userMessage ?? "Messages could not connect. Please try again." } }
        }
        .sheet(isPresented: Binding(get: { chat.reportMessage != nil }, set: { if !$0 { chat.reportMessage = nil } })) {
            if let message = chat.reportMessage {
                ReportMessageView(service: service, message: message) { chat.reportMessage = nil }
            }
        }
    }
}

struct NewMessageView: View {
    let chatService: any ChatServicing
    let discoverService: any DiscoverServicing
    let safetyService: any SafetyServicing
    @State private var users: [DiscoverUser] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading { ProgressView("Finding workout partners") }
            else if let errorMessage { VStack { ErrorStateView(message: errorMessage, requestID: nil); RetryButton { Task { await load() } } }.padding() }
            else if users.isEmpty { EmptyStateView(systemImage: "person.2", title: "No contacts available", message: "Complete a profile to appear here.") }
            else {
                List(users) { user in
                    NavigationLink {
                        DirectConversationView(service: chatService, safetyService: safetyService, targetUserID: user.id)
                    } label: {
                        HStack(spacing: LauverDesign.Spacing.medium) {
                            ProfileAvatar(photoURL: user.photoURL, size: 48)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(user.displayName ?? "Lauver member").font(.headline)
                                Text("\(user.city.name) · \(user.commonSports.map(\.title).joined(separator: ", "))")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityIdentifier("new-message-user-\(user.id)")
                }
            }
        }
        .navigationTitle("New message")
        .task { await load() }
    }

    @MainActor private func load() async {
        isLoading = true; errorMessage = nil
        do { users = try await discoverService.discover(filters: DiscoverFilters(sport: nil, radius: nil), cursor: nil).users }
        catch { errorMessage = (error as? APIError)?.userMessage ?? "Contacts could not be loaded." }
        isLoading = false
    }
}

struct DirectConversationView: View {
    @EnvironmentObject private var chat: ChatConnection
    let service: any ChatServicing
    let safetyService: (any SafetyServicing)?
    let targetUserID: String
    @State private var controller: ChatChannelController?
    @State private var errorMessage: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let controller, let client = chat.client {
                VStack(spacing: 0) {
                    ChatSafetyBar(service: safetyService, targetUserID: targetUserID)
                    ChatChannelView(viewFactory: LauverChatFactory(client: client, service: service), channelController: controller)
                }
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
        .toolbar(.hidden, for: .tabBar)
        .sheet(isPresented: Binding(get: { chat.reportMessage != nil }, set: { if !$0 { chat.reportMessage = nil } })) {
            if let message = chat.reportMessage {
                ReportMessageView(service: service, message: message) { chat.reportMessage = nil }
            }
        }
    }
}

struct EventGroupConversationView: View {
    @EnvironmentObject private var chat: ChatConnection
    let service: any ChatServicing
    let safetyService: (any SafetyServicing)?
    let eventID: String
    @State private var controller: ChatChannelController?
    @State private var errorMessage: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let controller, let client = chat.client {
                ChatChannelView(viewFactory: LauverChatFactory(client: client, service: service), channelController: controller)
            } else if let errorMessage {
                VStack { ErrorStateView(message: errorMessage, requestID: nil); RetryButton { attempt += 1 } }.padding()
            } else { ProgressView("Opening event group chat") }
        }
        .navigationTitle("Event Group Chat")
        .task(id: attempt) {
            errorMessage = nil
            do {
                let client = try await chat.connect(service: service)
                let channel = try await service.eventChat(eventID: eventID)
                try Task.checkCancellation()
                controller = client.channelController(for: try ChannelId(cid: channel.id))
            } catch { if !Task.isCancelled { errorMessage = (error as? APIError)?.userMessage ?? "This event chat could not be opened." } }
        }
        .toolbar(.hidden, for: .tabBar)
        .sheet(isPresented: Binding(get: { chat.reportMessage != nil }, set: { if !$0 { chat.reportMessage = nil } })) {
            if let message = chat.reportMessage {
                ReportMessageView(service: service, message: message) { chat.reportMessage = nil }
            }
        }
    }
}

struct ChatSafetyBar: View {
    let service: (any SafetyServicing)?
    let targetUserID: String
    @State private var confirmBlock = false
    @State private var reportPresented = false
    @State private var errorMessage: String?

    var body: some View {
        if let service {
            HStack {
                Spacer()
                Menu {
                    Button("Report User", systemImage: "flag") { reportPresented = true }
                        .accessibilityIdentifier("chat-report-user")
                    Button("Block User", systemImage: "person.crop.circle.badge.xmark", role: .destructive) { confirmBlock = true }
                        .accessibilityIdentifier("chat-block-user")
                } label: { Label("Safety", systemImage: "ellipsis.circle") }
                    .accessibilityIdentifier("chat-safety-menu")
            }
            .padding(.horizontal).padding(.vertical, 6)
            .background(LauverDesign.ColorToken.surface)
            .alert("Block this user?", isPresented: $confirmBlock) {
                Button("Block User", role: .destructive) {
                    Task {
                        do {
                            try await service.block(userID: targetUserID)
                            NotificationCenter.default.post(name: .safetyPolicyChanged, object: nil, userInfo: ["blockedUserID": targetUserID])
                        } catch { errorMessage = (error as? APIError)?.userMessage ?? "This user could not be blocked. Please try again." }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Your profiles and conversation will be hidden from each other.") }
            .alert("Unable to block", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(errorMessage ?? "Please try again.") }
            .sheet(isPresented: $reportPresented) {
                ReportUserView(userID: targetUserID, displayName: "this user", blockUser: false, service: service) { _ in }
            }
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
        }
        .padding()
        .background(LauverDesign.ColorToken.surface)
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
