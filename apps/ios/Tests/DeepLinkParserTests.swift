import OpenClawKit
import Foundation
import Testing

@Suite struct DeepLinkParserTests {
    @Test func parseRejectsUnknownHost() {
        let url = URL(string: "openclaw://nope?message=hi")!
        #expect(DeepLinkParser.parse(url) == nil)
    }

    @Test func parseHostIsCaseInsensitive() {
        let url = URL(string: "openclaw://AGENT?message=Hello")!
        #expect(DeepLinkParser.parse(url) == .agent(.init(
            message: "Hello",
            sessionKey: nil,
            thinking: nil,
            deliver: false,
            to: nil,
            channel: nil,
            timeoutSeconds: nil,
            key: nil)))
    }

    @Test func parseRejectsNonOpenClawScheme() {
        let url = URL(string: "https://example.com/agent?message=hi")!
        #expect(DeepLinkParser.parse(url) == nil)
    }

    @Test func parseRejectsEmptyMessage() {
        let url = URL(string: "openclaw://agent?message=%20%20%0A")!
        #expect(DeepLinkParser.parse(url) == nil)
    }

    @Test func parseAgentLinkParsesCommonFields() {
        let url =
            URL(string: "openclaw://agent?message=Hello&deliver=1&sessionKey=node-test&thinking=low&timeoutSeconds=30")!
        #expect(
            DeepLinkParser.parse(url) == .agent(
                .init(
                    message: "Hello",
                    sessionKey: "node-test",
                    thinking: "low",
                    deliver: true,
                    to: nil,
                    channel: nil,
                    timeoutSeconds: 30,
                    key: nil)))
    }

    @Test func parseAgentLinkParsesTargetRoutingFields() {
        let url =
            URL(
                string: "openclaw://agent?message=Hello%20World&deliver=1&to=%2B15551234567&channel=whatsapp&key=secret")!
        #expect(
            DeepLinkParser.parse(url) == .agent(
                .init(
                    message: "Hello World",
                    sessionKey: nil,
                    thinking: nil,
                    deliver: true,
                    to: "+15551234567",
                    channel: "whatsapp",
                    timeoutSeconds: nil,
                    key: "secret")))
    }

    @Test func parseRejectsNegativeTimeoutSeconds() {
        let url = URL(string: "openclaw://agent?message=Hello&timeoutSeconds=-1")!
        #expect(DeepLinkParser.parse(url) == .agent(.init(
            message: "Hello",
            sessionKey: nil,
            thinking: nil,
            deliver: false,
            to: nil,
            channel: nil,
            timeoutSeconds: nil,
            key: nil)))
    }

    @Test func parseRejectsASCIIControlCharacters() {
        let url = URL(string: "openclaw://agent?message=Hello%07World")!
        #expect(DeepLinkParser.parse(url) == nil)
    }

    @Test func parseSanitizesInvisibleUnicode() {
        let url = URL(string: "openclaw://agent?message=He%E2%80%8Bllo%E2%80%AE")!
        #expect(DeepLinkParser.parse(url) == .agent(.init(
            message: "Hello",
            sessionKey: nil,
            thinking: nil,
            deliver: false,
            to: nil,
            channel: nil,
            timeoutSeconds: nil,
            key: nil)))
    }

    @Test func parsePreservesNormalUnicodeText() {
        let url = URL(string: "openclaw://agent?message=%F0%9F%8C%8D%20%E4%BD%A0%E5%A5%BD")!
        #expect(DeepLinkParser.parse(url) == .agent(.init(
            message: "🌍 你好",
            sessionKey: nil,
            thinking: nil,
            deliver: false,
            to: nil,
            channel: nil,
            timeoutSeconds: nil,
            key: nil)))
    }

    @Test func parseRejectsOversizedMessage() {
        let huge = String(repeating: "a", count: 20001)
        let encoded = huge.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!
        let url = URL(string: "openclaw://agent?message=\(encoded)")!
        #expect(DeepLinkParser.parse(url) == nil)
    }

    @Test func buildRoundTripsAgentLink() {
        let original = AgentDeepLink(
            message: "Hello world",
            sessionKey: "main",
            thinking: "low",
            deliver: true,
            to: "+15551234567",
            channel: "whatsapp",
            timeoutSeconds: 30,
            key: "secret")
        let url = DeepLinkParser.build(.agent(original))
        #expect(url != nil)
        #expect(DeepLinkParser.parse(#require(url)) == .agent(original))
    }
}
