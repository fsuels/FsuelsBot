import OpenClawKit
import Dispatch
import Foundation
import Testing
@testable import OpenClawChatUI

private struct TimeoutError: Error, CustomStringConvertible {
    let label: String
    var description: String { "Timeout waiting for: \(self.label)" }
}

private func waitUntil(
    _ label: String,
    timeoutSeconds: Double = 2.0,
    pollMs: UInt64 = 10,
    _ condition: @escaping @Sendable () async -> Bool) async throws
{
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
        if await condition() {
            return
        }
        try await Task.sleep(nanoseconds: pollMs * 1_000_000)
    }
    throw TimeoutError(label: label)
}

private actor TestChatTransportState {
    var historyCallCount: Int = 0
    var sessionsCallCount: Int = 0
    var healthCallCount: Int = 0
    var sentRunIds: [String] = []
    var abortedRunIds: [String] = []
}

private final class TestChatTransport: @unchecked Sendable, OpenClawChatTransport {
    private let state = TestChatTransportState()
    private let historyResponses: [OpenClawChatHistoryPayload]
    private let sessionsResponses: [OpenClawChatSessionsListResponse]
    private let historyDelayMs: [UInt64]
    private let historyDelayIgnoresCancellation: Bool
    private let sessionsDelayMs: [UInt64]
    private let healthResponses: [Bool]
    private let healthDelayMs: [UInt64]

    private let stream: AsyncStream<OpenClawChatTransportEvent>
    private let continuation: AsyncStream<OpenClawChatTransportEvent>.Continuation

    init(
        historyResponses: [OpenClawChatHistoryPayload],
        sessionsResponses: [OpenClawChatSessionsListResponse] = [],
        historyDelayMs: [UInt64] = [],
        historyDelayIgnoresCancellation: Bool = false,
        sessionsDelayMs: [UInt64] = [],
        healthResponses: [Bool] = [true],
        healthDelayMs: [UInt64] = [])
    {
        self.historyResponses = historyResponses
        self.sessionsResponses = sessionsResponses
        self.historyDelayMs = historyDelayMs
        self.historyDelayIgnoresCancellation = historyDelayIgnoresCancellation
        self.sessionsDelayMs = sessionsDelayMs
        self.healthResponses = healthResponses
        self.healthDelayMs = healthDelayMs
        var cont: AsyncStream<OpenClawChatTransportEvent>.Continuation!
        self.stream = AsyncStream { c in
            cont = c
        }
        self.continuation = cont
    }

    func events() -> AsyncStream<OpenClawChatTransportEvent> {
        self.stream
    }

    func setActiveSessionKey(_: String) async throws {}

    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        let idx = await self.state.historyCallCount
        await self.state.setHistoryCallCount(idx + 1)
        try await Self.pause(
            milliseconds: self.historyDelayMs[safe: idx] ?? 0,
            ignoreCancellation: self.historyDelayIgnoresCancellation)
        if idx < self.historyResponses.count {
            return self.historyResponses[idx]
        }
        return self.historyResponses.last ?? OpenClawChatHistoryPayload(
            sessionKey: sessionKey,
            sessionId: nil,
            messages: [],
            thinkingLevel: "off")
    }

    func sendMessage(
        sessionKey _: String,
        message _: String,
        thinking _: String,
        idempotencyKey: String,
        attachments _: [OpenClawChatAttachmentPayload]) async throws -> OpenClawChatSendResponse
    {
        await self.state.sentRunIdsAppend(idempotencyKey)
        return OpenClawChatSendResponse(runId: idempotencyKey, status: "ok")
    }

    func abortRun(sessionKey _: String, runId: String) async throws {
        await self.state.abortedRunIdsAppend(runId)
    }

    func listSessions(limit _: Int?) async throws -> OpenClawChatSessionsListResponse {
        let idx = await self.state.sessionsCallCount
        await self.state.setSessionsCallCount(idx + 1)
        try await Self.pause(milliseconds: self.sessionsDelayMs[safe: idx] ?? 0, ignoreCancellation: false)
        if idx < self.sessionsResponses.count {
            return self.sessionsResponses[idx]
        }
        return self.sessionsResponses.last ?? OpenClawChatSessionsListResponse(
            ts: nil,
            path: nil,
            count: 0,
            defaults: nil,
            sessions: [])
    }

    func requestHealth(timeoutMs _: Int) async throws -> Bool {
        let idx = await self.state.healthCallCount
        await self.state.setHealthCallCount(idx + 1)
        try await Self.pause(milliseconds: self.healthDelayMs[safe: idx] ?? 0, ignoreCancellation: false)
        if idx < self.healthResponses.count {
            return self.healthResponses[idx]
        }
        return self.healthResponses.last ?? true
    }

    func emit(_ evt: OpenClawChatTransportEvent) {
        self.continuation.yield(evt)
    }

    func lastSentRunId() async -> String? {
        let ids = await self.state.sentRunIds
        return ids.last
    }

    func abortedRunIds() async -> [String] {
        await self.state.abortedRunIds
    }

    private static func pause(milliseconds: UInt64, ignoreCancellation: Bool) async throws {
        guard milliseconds > 0 else { return }
        let nanos = milliseconds * 1_000_000
        if ignoreCancellation {
            await withCheckedContinuation { continuation in
                DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(Int(milliseconds))) {
                    continuation.resume()
                }
            }
            return
        }
        try await Task.sleep(nanoseconds: nanos)
    }
}

extension TestChatTransportState {
    fileprivate func setHistoryCallCount(_ v: Int) {
        self.historyCallCount = v
    }

    fileprivate func setSessionsCallCount(_ v: Int) {
        self.sessionsCallCount = v
    }

    fileprivate func setHealthCallCount(_ v: Int) {
        self.healthCallCount = v
    }

    fileprivate func sentRunIdsAppend(_ v: String) {
        self.sentRunIds.append(v)
    }

    fileprivate func abortedRunIdsAppend(_ v: String) {
        self.abortedRunIds.append(v)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard self.indices.contains(index) else { return nil }
        return self[index]
    }
}

@Suite struct ChatViewModelTests {
    @Test func firstSendWaitsForBootstrapReadiness() async throws {
        let history = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [],
            thinkingLevel: "off")

        let transport = TestChatTransport(
            historyResponses: [history],
            historyDelayMs: [150],
            healthDelayMs: [150])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run {
            vm.load()
            vm.input = "hi"
            vm.send()
        }

        try await waitUntil("first send succeeds after bootstrap") {
            await transport.lastSentRunId() != nil
        }
        #expect(await MainActor.run { vm.errorText } == nil)
        #expect(await MainActor.run { vm.pendingRunCount } == 1)
    }

    @Test func staleBootstrapDoesNotOverwriteSwitchedSession() async throws {
        let mainHistory = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [
                AnyCodable([
                    "role": "assistant",
                    "content": [["type": "text", "text": "main history"]],
                    "timestamp": Date().timeIntervalSince1970 * 1000,
                ]),
            ],
            thinkingLevel: "off")
        let otherHistory = OpenClawChatHistoryPayload(
            sessionKey: "other",
            sessionId: "sess-other",
            messages: [
                AnyCodable([
                    "role": "assistant",
                    "content": [["type": "text", "text": "other history"]],
                    "timestamp": Date().timeIntervalSince1970 * 1000,
                ]),
            ],
            thinkingLevel: "off")

        let transport = TestChatTransport(
            historyResponses: [mainHistory, otherHistory],
            historyDelayMs: [200, 0],
            historyDelayIgnoresCancellation: true)
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run {
            vm.load()
            vm.switchSession(to: "other")
        }

        try await waitUntil("other session loads") {
            await MainActor.run {
                vm.sessionKey == "other" &&
                    vm.sessionId == "sess-other" &&
                    vm.messages.first?.content.first?.text == "other history"
            }
        }

        try await Task.sleep(nanoseconds: 350_000_000)

        #expect(await MainActor.run { vm.sessionKey } == "other")
        #expect(await MainActor.run { vm.sessionId } == "sess-other")
        #expect(await MainActor.run { vm.messages.first?.content.first?.text } == "other history")
    }

    @Test func streamsAssistantAndClearsOnFinal() async throws {
        let sessionId = "sess-main"
        let history1 = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: sessionId,
            messages: [],
            thinkingLevel: "off")
        let history2 = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: sessionId,
            messages: [
                AnyCodable([
                    "role": "assistant",
                    "content": [["type": "text", "text": "final answer"]],
                    "timestamp": Date().timeIntervalSince1970 * 1000,
                ]),
            ],
            thinkingLevel: "off")

        let transport = TestChatTransport(historyResponses: [history1, history2])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap") { await MainActor.run { vm.healthOK && vm.sessionId == sessionId } }

        await MainActor.run {
            vm.input = "hi"
            vm.send()
        }
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        transport.emit(
            .agent(
                OpenClawAgentEventPayload(
                    runId: sessionId,
                    seq: 1,
                    stream: "assistant",
                    ts: Int(Date().timeIntervalSince1970 * 1000),
                    data: ["text": AnyCodable("streaming…")])))

        try await waitUntil("assistant stream visible") {
            await MainActor.run { vm.streamingAssistantText == "streaming…" }
        }

        transport.emit(
            .agent(
                OpenClawAgentEventPayload(
                    runId: sessionId,
                    seq: 2,
                    stream: "tool",
                    ts: Int(Date().timeIntervalSince1970 * 1000),
                    data: [
                        "phase": AnyCodable("start"),
                        "name": AnyCodable("demo"),
                        "toolCallId": AnyCodable("t1"),
                        "args": AnyCodable(["x": 1]),
                    ])))

        try await waitUntil("tool call pending") { await MainActor.run { vm.pendingToolCalls.count == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        transport.emit(
            .chat(
                OpenClawChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("pending run clears") { await MainActor.run { vm.pendingRunCount == 0 } }
        try await waitUntil("history refresh") {
            await MainActor.run { vm.messages.contains(where: { $0.role == "assistant" }) }
        }
        #expect(await MainActor.run { vm.streamingAssistantText } == nil)
        #expect(await MainActor.run { vm.pendingToolCalls.isEmpty })
    }

    @Test func clearsStreamingOnExternalFinalEvent() async throws {
        let sessionId = "sess-main"
        let history = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: sessionId,
            messages: [],
            thinkingLevel: "off")
        let transport = TestChatTransport(historyResponses: [history, history])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap") { await MainActor.run { vm.healthOK && vm.sessionId == sessionId } }

        transport.emit(
            .agent(
                OpenClawAgentEventPayload(
                    runId: sessionId,
                    seq: 1,
                    stream: "assistant",
                    ts: Int(Date().timeIntervalSince1970 * 1000),
                    data: ["text": AnyCodable("external stream")])))

        transport.emit(
            .agent(
                OpenClawAgentEventPayload(
                    runId: sessionId,
                    seq: 2,
                    stream: "tool",
                    ts: Int(Date().timeIntervalSince1970 * 1000),
                    data: [
                        "phase": AnyCodable("start"),
                        "name": AnyCodable("demo"),
                        "toolCallId": AnyCodable("t1"),
                        "args": AnyCodable(["x": 1]),
                    ])))

        try await waitUntil("streaming active") {
            await MainActor.run { vm.streamingAssistantText == "external stream" }
        }
        try await waitUntil("tool call pending") { await MainActor.run { vm.pendingToolCalls.count == 1 } }

        transport.emit(
            .chat(
                OpenClawChatEventPayload(
                    runId: "other-run",
                    sessionKey: "main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("streaming cleared") { await MainActor.run { vm.streamingAssistantText == nil } }
        #expect(await MainActor.run { vm.pendingToolCalls.isEmpty })
    }

    @Test func sessionChoicesPreferMainAndRecent() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (2 * 60 * 60 * 1000)
        let recentOlder = now - (5 * 60 * 60 * 1000)
        let stale = now - (26 * 60 * 60 * 1000)
        let history = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [],
            thinkingLevel: "off")
        let sessions = OpenClawChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 4,
            defaults: nil,
            sessions: [
                OpenClawChatSessionEntry(
                    key: "recent-1",
                    kind: nil,
                    displayName: nil,
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recent,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    model: nil,
                    contextTokens: nil),
                OpenClawChatSessionEntry(
                    key: "main",
                    kind: nil,
                    displayName: nil,
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: stale,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    model: nil,
                    contextTokens: nil),
                OpenClawChatSessionEntry(
                    key: "recent-2",
                    kind: nil,
                    displayName: nil,
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recentOlder,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    model: nil,
                    contextTokens: nil),
                OpenClawChatSessionEntry(
                    key: "old-1",
                    kind: nil,
                    displayName: nil,
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: stale,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    model: nil,
                    contextTokens: nil),
            ])

        let transport = TestChatTransport(
            historyResponses: [history],
            sessionsResponses: [sessions])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["main", "recent-1", "recent-2"])
    }

    @Test func sessionChoicesIncludeCurrentWhenMissing() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (30 * 60 * 1000)
        let history = OpenClawChatHistoryPayload(
            sessionKey: "custom",
            sessionId: "sess-custom",
            messages: [],
            thinkingLevel: "off")
        let sessions = OpenClawChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                OpenClawChatSessionEntry(
                    key: "main",
                    kind: nil,
                    displayName: nil,
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recent,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    model: nil,
                    contextTokens: nil),
            ])

        let transport = TestChatTransport(
            historyResponses: [history],
            sessionsResponses: [sessions])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "custom", transport: transport) }
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["main", "custom"])
    }

    @Test func clearsStreamingOnExternalErrorEvent() async throws {
        let sessionId = "sess-main"
        let history = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: sessionId,
            messages: [],
            thinkingLevel: "off")
        let transport = TestChatTransport(historyResponses: [history, history])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap") { await MainActor.run { vm.healthOK && vm.sessionId == sessionId } }

        transport.emit(
            .agent(
                OpenClawAgentEventPayload(
                    runId: sessionId,
                    seq: 1,
                    stream: "assistant",
                    ts: Int(Date().timeIntervalSince1970 * 1000),
                    data: ["text": AnyCodable("external stream")])))

        try await waitUntil("streaming active") {
            await MainActor.run { vm.streamingAssistantText == "external stream" }
        }

        transport.emit(
            .chat(
                OpenClawChatEventPayload(
                    runId: "other-run",
                    sessionKey: "main",
                    state: "error",
                    message: nil,
                    errorMessage: "boom")))

        try await waitUntil("streaming cleared") { await MainActor.run { vm.streamingAssistantText == nil } }
    }

    @Test func abortRequestsDoNotClearPendingUntilAbortedEvent() async throws {
        let sessionId = "sess-main"
        let history = OpenClawChatHistoryPayload(
            sessionKey: "main",
            sessionId: sessionId,
            messages: [],
            thinkingLevel: "off")
        let transport = TestChatTransport(historyResponses: [history, history])
        let vm = await MainActor.run { OpenClawChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap") { await MainActor.run { vm.healthOK && vm.sessionId == sessionId } }

        await MainActor.run {
            vm.input = "hi"
            vm.send()
        }
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        await MainActor.run { vm.abort() }

        try await waitUntil("abortRun called") {
            let ids = await transport.abortedRunIds()
            return ids == [runId]
        }

        // Pending remains until the gateway broadcasts an aborted/final chat event.
        #expect(await MainActor.run { vm.pendingRunCount } == 1)

        transport.emit(
            .chat(
                OpenClawChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "aborted",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("pending run clears") { await MainActor.run { vm.pendingRunCount == 0 } }
    }
}
