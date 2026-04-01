import Foundation

public struct ExternalOriginContext: Codable, Sendable, Equatable {
    public enum Source: String, Codable, Sendable, Equatable {
        case interactive
        case browserLink = "browser-link"
        case osProtocol = "os-protocol"
        case editorExtension = "editor-extension"
        case mcp
        case importedText = "imported-text"
        case other
    }

    public enum TrustLevel: String, Codable, Sendable, Equatable {
        case interactive
        case external
    }

    public let source: Source
    public let rawUri: String?
    public let receivedAt: Int
    public let payloadLength: Int?
    public let trustLevel: TrustLevel

    public init(
        source: Source,
        rawUri: String?,
        receivedAt: Int,
        payloadLength: Int?,
        trustLevel: TrustLevel)
    {
        self.source = source
        self.rawUri = rawUri
        self.receivedAt = receivedAt
        self.payloadLength = payloadLength
        self.trustLevel = trustLevel
    }
}

public enum DeepLinkRoute: Sendable, Equatable {
    case agent(AgentDeepLink)
}

public struct AgentDeepLink: Codable, Sendable, Equatable {
    public let message: String
    public let sessionKey: String?
    public let thinking: String?
    public let deliver: Bool
    public let to: String?
    public let channel: String?
    public let timeoutSeconds: Int?
    public let key: String?
    public let origin: ExternalOriginContext?

    public init(
        message: String,
        sessionKey: String?,
        thinking: String?,
        deliver: Bool,
        to: String?,
        channel: String?,
        timeoutSeconds: Int?,
        key: String?,
        origin: ExternalOriginContext? = nil)
    {
        self.message = message
        self.sessionKey = sessionKey
        self.thinking = thinking
        self.deliver = deliver
        self.to = to
        self.channel = channel
        self.timeoutSeconds = timeoutSeconds
        self.key = key
        self.origin = origin
    }

    public func withOrigin(_ origin: ExternalOriginContext?) -> AgentDeepLink {
        AgentDeepLink(
            message: self.message,
            sessionKey: self.sessionKey,
            thinking: self.thinking,
            deliver: self.deliver,
            to: self.to,
            channel: self.channel,
            timeoutSeconds: self.timeoutSeconds,
            key: self.key,
            origin: origin)
    }
}

public enum DeepLinkParser {
    private static let maxMessageLength = 20_000
    private static let maxSessionKeyLength = 256
    private static let maxThinkingLength = 32
    private static let maxTargetLength = 256
    private static let maxChannelLength = 64
    private static let maxKeyLength = 256

    private static let hiddenScalarValues: Set<UInt32> = [
        0x200B, // zero width space
        0x200C, // zero width non-joiner
        0x200D, // zero width joiner
        0x200E, // left-to-right mark
        0x200F, // right-to-left mark
        0x202A, // left-to-right embedding
        0x202B, // right-to-left embedding
        0x202C, // pop directional formatting
        0x202D, // left-to-right override
        0x202E, // right-to-left override
        0x2060, // word joiner
        0x2066, // left-to-right isolate
        0x2067, // right-to-left isolate
        0x2068, // first strong isolate
        0x2069, // pop directional isolate
        0xFEFF, // zero width no-break space / BOM
    ]

    // Trust boundary note:
    // parsing/building only validates and normalizes link fields.
    // It never reads files, launches processes, or performs shell escaping.
    public static func parse(_ url: URL) -> DeepLinkRoute? {
        guard let scheme = url.scheme?.lowercased(),
              scheme == "openclaw"
        else {
            return nil
        }
        guard let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        let query = (comps.queryItems ?? []).reduce(into: [String: String]()) { dict, item in
            guard let value = item.value else { return }
            dict[item.name] = value
        }

        switch host {
        case "agent":
            guard let message = self.normalized(query["message"], maxLength: Self.maxMessageLength),
                  !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            let deliver = (query["deliver"] as NSString?)?.boolValue ?? false
            let timeoutSeconds = query["timeoutSeconds"]
                .flatMap { self.normalized($0, maxLength: 16) }
                .flatMap { Int($0) }
                .flatMap { $0 >= 0 ? $0 : nil }
            return .agent(
                .init(
                    message: message,
                    sessionKey: self.normalized(query["sessionKey"], maxLength: Self.maxSessionKeyLength),
                    thinking: self.normalized(query["thinking"], maxLength: Self.maxThinkingLength),
                    deliver: deliver,
                    to: self.normalized(query["to"], maxLength: Self.maxTargetLength),
                    channel: self.normalized(query["channel"], maxLength: Self.maxChannelLength),
                    timeoutSeconds: timeoutSeconds,
                    key: self.normalized(query["key"], maxLength: Self.maxKeyLength)))
        default:
            return nil
        }
    }

    public static func build(_ route: DeepLinkRoute) -> URL? {
        switch route {
        case let .agent(link):
            var comps = URLComponents()
            comps.scheme = "openclaw"
            comps.host = "agent"
            var items: [URLQueryItem] = [
                URLQueryItem(name: "message", value: link.message),
            ]
            if let sessionKey = link.sessionKey, !sessionKey.isEmpty {
                items.append(URLQueryItem(name: "sessionKey", value: sessionKey))
            }
            if let thinking = link.thinking, !thinking.isEmpty {
                items.append(URLQueryItem(name: "thinking", value: thinking))
            }
            if link.deliver {
                items.append(URLQueryItem(name: "deliver", value: "1"))
            }
            if let to = link.to, !to.isEmpty {
                items.append(URLQueryItem(name: "to", value: to))
            }
            if let channel = link.channel, !channel.isEmpty {
                items.append(URLQueryItem(name: "channel", value: channel))
            }
            if let timeoutSeconds = link.timeoutSeconds {
                items.append(URLQueryItem(name: "timeoutSeconds", value: String(timeoutSeconds)))
            }
            if let key = link.key, !key.isEmpty {
                items.append(URLQueryItem(name: "key", value: key))
            }
            comps.queryItems = items
            return comps.url
        }
    }

    private static func normalized(_ value: String?, maxLength: Int) -> String? {
        guard let value else { return nil }
        guard !containsASCIIControl(value) else { return nil }
        let sanitized = sanitizeInvisibleUnicode(value)
        guard sanitized.count <= maxLength else { return nil }
        return sanitized
    }

    private static func containsASCIIControl(_ value: String) -> Bool {
        value.unicodeScalars.contains { scalar in
            scalar.value < 0x20 || scalar.value == 0x7F
        }
    }

    private static func sanitizeInvisibleUnicode(_ value: String) -> String {
        String(String.UnicodeScalarView(value.unicodeScalars.filter { scalar in
            !Self.hiddenScalarValues.contains(scalar.value)
        }))
    }
}
