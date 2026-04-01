import AppKit
import OpenClawKit
import Foundation
import OSLog
import Security

private let deepLinkLogger = Logger(subsystem: "ai.openclaw", category: "DeepLink")

@MainActor
final class DeepLinkHandler {
    static let shared = DeepLinkHandler()
    private static let previewLimit = 240
    private static let longPromptThreshold = 700

    private var lastPromptAt: Date = .distantPast

    // Ephemeral, in-memory key used for unattended deep links originating from the in-app Canvas.
    // This avoids blocking Canvas init on UserDefaults and doesn't weaken the external deep-link prompt:
    // outside callers can't know this randomly generated key.
    private nonisolated static let canvasUnattendedKey: String = DeepLinkHandler.generateRandomKey()

    func handle(url: URL, source: ExternalOriginContext.Source = .osProtocol) async {
        guard let route = DeepLinkParser.parse(url) else {
            deepLinkLogger.debug("ignored url \(url.absoluteString, privacy: .public)")
            return
        }
        guard !AppStateStore.shared.isPaused else {
            self.presentAlert(title: "OpenClaw is paused", message: "Unpause OpenClaw to run agent actions.")
            return
        }

        switch route {
        case let .agent(link):
            await self.handleAgent(link: link, originalURL: url, source: source)
        }
    }

    private func handleAgent(
        link: AgentDeepLink,
        originalURL: URL,
        source: ExternalOriginContext.Source) async
    {
        let messagePreview = link.message.trimmingCharacters(in: .whitespacesAndNewlines)
        if messagePreview.count > 20000 {
            self.presentAlert(title: "Deep link too large", message: "Message exceeds 20,000 characters.")
            return
        }

        let origin = ExternalOriginContext(
            source: source,
            rawUri: originalURL.absoluteString,
            receivedAt: Int(Date().timeIntervalSince1970 * 1000),
            payloadLength: messagePreview.count,
            trustLevel: .external)

        let allowUnattended = link.key == Self.canvasUnattendedKey || link.key == Self.expectedKey()
        if !allowUnattended {
            if Date().timeIntervalSince(self.lastPromptAt) < 1.0 {
                deepLinkLogger.debug("throttling deep link prompt")
                return
            }
            self.lastPromptAt = Date()

            let trimmed =
                messagePreview.count > Self.previewLimit
                ? "\(messagePreview.prefix(Self.previewLimit))…"
                : messagePreview
            let sessionLine = link.sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                .map { "Session: \($0)\n" } ?? ""
            let channelLine = link.channel?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                .map { "Channel: \($0)\n" } ?? ""
            let targetLine = link.to?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                .map { "Target: \($0)\n" } ?? ""
            let lengthLine = "Payload: \(messagePreview.count) characters\n"
            let sourceLine = "Source: \(Self.sourceLabel(source))\n"
            let reviewNote =
                messagePreview.count > Self.longPromptThreshold
                ? "\nThis prompt is longer than the preview. Review the full deep link carefully before continuing.\n"
                : "\nReview the prompt before continuing.\n"
            let body = """
            Run the agent with this external prompt?

            \(sourceLine)\(sessionLine)\(channelLine)\(targetLine)\(lengthLine)\(reviewNote)
            Preview:
            \(trimmed)

            URL:
            \(originalURL.absoluteString)
            """
            guard self.confirm(title: "Run OpenClaw agent?", message: body) else { return }
        }

        if AppStateStore.shared.connectionMode == .local {
            GatewayProcessManager.shared.setActive(true)
        }

        do {
            let channel = GatewayAgentChannel(raw: link.channel)
            let explicitSessionKey = link.sessionKey?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
            let resolvedSessionKey: String = if let explicitSessionKey {
                explicitSessionKey
            } else {
                await GatewayConnection.shared.mainSessionKey()
            }
            let invocation = GatewayAgentInvocation(
                message: messagePreview,
                sessionKey: resolvedSessionKey,
                thinking: link.thinking?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
                deliver: channel.shouldDeliver(link.deliver),
                to: link.to?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
                channel: channel,
                timeoutSeconds: link.timeoutSeconds,
                idempotencyKey: UUID().uuidString,
                origin: origin)

            let res = await GatewayConnection.shared.sendAgent(invocation)
            if !res.ok {
                throw NSError(
                    domain: "DeepLink",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: res.error ?? "agent request failed"])
            }
        } catch {
            self.presentAlert(title: "Agent request failed", message: error.localizedDescription)
        }
    }

    // MARK: - Auth

    static func currentKey() -> String {
        self.expectedKey()
    }

    static func currentCanvasKey() -> String {
        self.canvasUnattendedKey
    }

    private static func expectedKey() -> String {
        let defaults = UserDefaults.standard
        if let key = defaults.string(forKey: deepLinkKeyKey), !key.isEmpty {
            return key
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let data = Data(bytes)
        let key = data
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        defaults.set(key, forKey: deepLinkKeyKey)
        return key
    }

    private nonisolated static func generateRandomKey() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let data = Data(bytes)
        return data
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - UI

    private static func sourceLabel(_ source: ExternalOriginContext.Source) -> String {
        switch source {
        case .interactive:
            "Interactive"
        case .browserLink:
            "Browser link"
        case .osProtocol:
            "OS protocol"
        case .editorExtension:
            "Editor extension"
        case .mcp:
            "MCP"
        case .importedText:
            "Imported text"
        case .other:
            "Other"
        }
    }

    private func confirm(title: String, message: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Run")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .warning
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func presentAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .informational
        alert.runModal()
    }
}
