import Foundation
import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct AppStateGatewayConfigTests {
    @Test
    func remoteIdentityChangeSyncsGatewayConfig() async {
        let configPath = TestIsolation.tempConfigPath()

        await TestIsolation.withIsolatedState(
            env: ["OPENCLAW_CONFIG_PATH": configPath],
            defaults: [
                connectionModeKey: "remote",
                remoteTargetKey: "alice@gateway.test",
                remoteIdentityKey: nil,
            ])
        {
            OpenClawConfigFile.saveDict([
                "gateway": [
                    "mode": "remote",
                    "remote": [
                        "url": "ws://gateway.test:18789",
                        "sshTarget": "alice@gateway.test",
                    ],
                ],
            ])

            let state = AppState(preview: false, enableSideEffects: true, watchConfigChanges: false)
            state.remoteIdentity = "/tmp/id_ed25519"

            await self.waitForGatewayConfigValue("/tmp/id_ed25519", at: configPath, key: "sshIdentity")

            let root = OpenClawConfigFile.loadDict()
            let remote = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any]) ?? [:]
            #expect(remote["sshIdentity"] as? String == "/tmp/id_ed25519")
        }
    }

    @Test
    func applyExternalGatewayConfigUpdatesStateWithoutWritingBack() async {
        let configPath = TestIsolation.tempConfigPath()

        await TestIsolation.withIsolatedState(
            env: ["OPENCLAW_CONFIG_PATH": configPath],
            defaults: [
                connectionModeKey: "remote",
                remoteTargetKey: "alice@old-host:2222",
            ])
        {
            OpenClawConfigFile.saveDict([
                "gateway": [
                    "mode": "remote",
                    "remote": [
                        "url": "ws://old-host:18789",
                    ],
                ],
            ])

            let state = AppState(preview: false, enableSideEffects: true, watchConfigChanges: false)
            state.applyExternalGatewayConfig([
                "gateway": [
                    "mode": "remote",
                    "remote": [
                        "url": "wss://new-host:443",
                    ],
                ],
            ])

            #expect(state.connectionMode == .remote)
            #expect(state.remoteTransport == .ssh)
            #expect(state.remoteUrl == "wss://new-host:443")
            #expect(state.remoteTarget == "alice@new-host:2222")

            let preservedRoot = OpenClawConfigFile.loadDict()
            let preservedUrl = ((preservedRoot["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(preservedUrl == "ws://old-host:18789")
        }
    }

    private func waitForGatewayConfigValue(_ expected: String, at configPath: String, key: String) async {
        let deadline = Date().addingTimeInterval(1.5)
        let url = URL(fileURLWithPath: configPath)

        while Date() < deadline {
            if let data = try? Data(contentsOf: url),
               let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let remote = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any]),
               remote[key] as? String == expected
            {
                return
            }
            try? await Task.sleep(nanoseconds: 25_000_000)
        }
    }
}
