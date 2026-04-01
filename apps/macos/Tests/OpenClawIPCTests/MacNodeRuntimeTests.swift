import OpenClawKit
import CoreLocation
import Foundation
import Testing
@testable import OpenClaw

struct MacNodeRuntimeTests {
    @Test func handleInvokeRejectsUnknownCommand() async {
        let runtime = MacNodeRuntime()
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-1", command: "unknown.command"))
        #expect(response.ok == false)
    }

    @Test func handleInvokeRejectsEmptySystemRun() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenClawSystemRunParams(command: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2", command: OpenClawSystemCommand.run.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func handleInvokeRejectsEmptySystemWhich() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenClawSystemWhichParams(bins: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2b", command: OpenClawSystemCommand.which.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func handleInvokeRejectsEmptyNotification() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenClawSystemNotifyParams(title: "", body: "")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-3", command: OpenClawSystemCommand.notify.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func handleInvokeCameraListRequiresEnabledCamera() async {
        await TestIsolation.withUserDefaultsValues([cameraEnabledKey: false]) {
            let runtime = MacNodeRuntime()
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(id: "req-4", command: OpenClawCameraCommand.list.rawValue))
            #expect(response.ok == false)
            #expect(response.error?.message.contains("CAMERA_DISABLED") == true)
        }
    }

    @Test func handleInvokeScreenRecordUsesInjectedServices() async throws {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            func recordScreen(
                screenIndex: Int?,
                durationMs: Int?,
                fps: Double?,
                includeAudio: Bool?,
                outPath: String?) async throws -> (path: String, hasAudio: Bool)
            {
                let url = FileManager().temporaryDirectory
                    .appendingPathComponent("openclaw-test-screen-record-\(UUID().uuidString).mp4")
                try Data("ok".utf8).write(to: url)
                return (path: url.path, hasAudio: false)
            }

            func locationAuthorizationStatus() -> CLAuthorizationStatus { .authorizedAlways }
            func locationAccuracyAuthorization() -> CLAccuracyAuthorization { .fullAccuracy }
            func currentLocation(
                desiredAccuracy: OpenClawLocationAccuracy,
                maxAgeMs: Int?,
                timeoutMs: Int?) async throws -> CLLocation
            {
                CLLocation(latitude: 0, longitude: 0)
            }
        }

        let services = await MainActor.run { FakeMainActorServices() }
        let runtime = MacNodeRuntime(makeMainActorServices: { services })

        let params = MacNodeScreenRecordParams(durationMs: 250)
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-5", command: MacNodeScreenCommand.record.rawValue, paramsJSON: json))
        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)

        struct Payload: Decodable {
            var format: String
            var base64: String
        }
        let payload = try JSONDecoder().decode(Payload.self, from: Data(payloadJSON.utf8))
        #expect(payload.format == "mp4")
        #expect(!payload.base64.isEmpty)
    }

    @Test func handleInvokeScreenRecordFailsFastWithoutPermission() async throws {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            var recordCalls = 0

            func recordScreen(
                screenIndex: Int?,
                durationMs: Int?,
                fps: Double?,
                includeAudio: Bool?,
                outPath: String?) async throws -> (path: String, hasAudio: Bool)
            {
                self.recordCalls += 1
                let url = FileManager().temporaryDirectory
                    .appendingPathComponent("openclaw-test-screen-record-\(UUID().uuidString).mp4")
                try Data("ok".utf8).write(to: url)
                return (path: url.path, hasAudio: false)
            }

            func locationAuthorizationStatus() -> CLAuthorizationStatus { .authorizedAlways }
            func locationAccuracyAuthorization() -> CLAccuracyAuthorization { .fullAccuracy }
            func currentLocation(
                desiredAccuracy: OpenClawLocationAccuracy,
                maxAgeMs: Int?,
                timeoutMs: Int?) async throws -> CLLocation
            {
                CLLocation(latitude: 0, longitude: 0)
            }
        }

        let services = await MainActor.run { FakeMainActorServices() }
        let runtime = MacNodeRuntime(
            makeMainActorServices: { services },
            permissionStatusProvider: { _ in [.screenRecording: false] })

        let params = MacNodeScreenRecordParams(durationMs: 250)
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-6", command: MacNodeScreenCommand.record.rawValue, paramsJSON: json))
        #expect(response.ok == false)
        #expect(response.error?.message == "PERMISSION_MISSING: screenRecording")

        let calls = await MainActor.run { services.recordCalls }
        #expect(calls == 0)
    }

    @Test func handleInvokeLocationAllowsWhenInUseModeWithWhenInUsePermission() async throws {
        await TestIsolation.withUserDefaultsValues([
            locationModeKey: OpenClawLocationMode.whileUsing.rawValue,
            locationPreciseKey: true,
        ]) {
            @MainActor
            final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
                func recordScreen(
                    screenIndex: Int?,
                    durationMs: Int?,
                    fps: Double?,
                    includeAudio: Bool?,
                    outPath: String?) async throws -> (path: String, hasAudio: Bool)
                {
                    fatalError("unused")
                }

                func locationAuthorizationStatus() -> CLAuthorizationStatus { .authorizedWhenInUse }
                func locationAccuracyAuthorization() -> CLAccuracyAuthorization { .fullAccuracy }
                func currentLocation(
                    desiredAccuracy: OpenClawLocationAccuracy,
                    maxAgeMs: Int?,
                    timeoutMs: Int?) async throws -> CLLocation
                {
                    CLLocation(latitude: 12.3, longitude: 45.6)
                }
            }

            let services = await MainActor.run { FakeMainActorServices() }
            let runtime = MacNodeRuntime(makeMainActorServices: { services })
            let params = OpenClawLocationGetParams()
            let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(
                    id: "req-7",
                    command: OpenClawLocationCommand.get.rawValue,
                    paramsJSON: json))
            #expect(response.ok == true)
        }
    }

    @Test func handleInvokeLocationUsesFrozenSessionSemantics() async throws {
        await TestIsolation.withUserDefaultsValues([
            locationModeKey: OpenClawLocationMode.whileUsing.rawValue,
            locationPreciseKey: false,
        ]) {
            @MainActor
            final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
                var requestedAccuracies: [OpenClawLocationAccuracy] = []

                func recordScreen(
                    screenIndex: Int?,
                    durationMs: Int?,
                    fps: Double?,
                    includeAudio: Bool?,
                    outPath: String?) async throws -> (path: String, hasAudio: Bool)
                {
                    fatalError("unused")
                }

                func locationAuthorizationStatus() -> CLAuthorizationStatus { .authorizedWhenInUse }
                func locationAccuracyAuthorization() -> CLAccuracyAuthorization { .fullAccuracy }
                func currentLocation(
                    desiredAccuracy: OpenClawLocationAccuracy,
                    maxAgeMs: Int?,
                    timeoutMs: Int?) async throws -> CLLocation
                {
                    self.requestedAccuracies.append(desiredAccuracy)
                    return CLLocation(latitude: 1, longitude: 2)
                }
            }

            let services = await MainActor.run { FakeMainActorServices() }
            let runtime = MacNodeRuntime(makeMainActorServices: { services })
            UserDefaults.standard.set(true, forKey: locationPreciseKey)

            let params = OpenClawLocationGetParams()
            let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(
                    id: "req-8",
                    command: OpenClawLocationCommand.get.rawValue,
                    paramsJSON: json))
            #expect(response.ok == true)

            let accuracies = await MainActor.run { services.requestedAccuracies }
            #expect(accuracies == [.balanced])
        }
    }
}
