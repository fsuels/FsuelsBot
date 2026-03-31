import Testing
@testable import OpenClaw

@Suite
@MainActor
struct ExecApprovalsGatewayPrompterTests {
    @Test func deduperRejectsDuplicateInFlightAndHandledRequests() {
        var deduper = ExecApprovalRequestDeduper()

        #expect(deduper.begin(id: "req-1", expiresAtMs: 500, nowMs: 100))
        #expect(!deduper.begin(id: "req-1", expiresAtMs: 500, nowMs: 100))

        deduper.finish(id: "req-1", expiresAtMs: 500, markHandled: true)

        #expect(!deduper.begin(id: "req-1", expiresAtMs: 500, nowMs: 200))
        #expect(deduper.begin(id: "req-1", expiresAtMs: 900, nowMs: 600))
    }

    @Test func deduperDropsExpiredRequests() {
        var deduper = ExecApprovalRequestDeduper()
        #expect(!deduper.begin(id: "expired", expiresAtMs: 100, nowMs: 100))
        #expect(!deduper.begin(id: "expired", expiresAtMs: 90, nowMs: 100))
    }

    @Test func sessionMatchPrefersActiveSession() {
        let matches = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .remote,
            activeSession: " main ",
            requestSession: "main",
            lastInputSeconds: nil)
        #expect(matches)

        let mismatched = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .remote,
            activeSession: "other",
            requestSession: "main",
            lastInputSeconds: 0)
        #expect(!mismatched)
    }

    @Test func sessionFallbackUsesRecentActivity() {
        let recent = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .remote,
            activeSession: nil,
            requestSession: "main",
            lastInputSeconds: 10,
            thresholdSeconds: 120)
        #expect(recent)

        let stale = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .remote,
            activeSession: nil,
            requestSession: "main",
            lastInputSeconds: 200,
            thresholdSeconds: 120)
        #expect(!stale)
    }

    @Test func defaultBehaviorMatchesMode() {
        let local = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .local,
            activeSession: nil,
            requestSession: nil,
            lastInputSeconds: 400)
        #expect(local)

        let remote = ExecApprovalsGatewayPrompter._testShouldPresent(
            mode: .remote,
            activeSession: nil,
            requestSession: nil,
            lastInputSeconds: 400)
        #expect(!remote)
    }
}
