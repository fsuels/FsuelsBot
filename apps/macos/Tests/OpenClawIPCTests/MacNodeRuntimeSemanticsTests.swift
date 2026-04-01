import OpenClawKit
import Testing

@testable import OpenClaw

struct MacNodeRuntimeSemanticsTests {
    @Test func commandsAndCapsMatchEnabledSurfaces() {
        let semantics = MacNodeRuntimeSemantics(
            canvasEnabled: false,
            cameraEnabled: false,
            locationMode: .off,
            locationPreciseEnabled: false)

        #expect(semantics.caps == [OpenClawCapability.screen.rawValue])
        #expect(!semantics.commands.contains(OpenClawCanvasCommand.present.rawValue))
        #expect(!semantics.commands.contains(OpenClawCameraCommand.list.rawValue))
        #expect(!semantics.commands.contains(OpenClawLocationCommand.get.rawValue))
        #expect(semantics.commands.contains(MacNodeScreenCommand.record.rawValue))
    }

    @Test func commandsAndCapsIncludeOptionalSurfacesWhenEnabled() {
        let semantics = MacNodeRuntimeSemantics(
            canvasEnabled: true,
            cameraEnabled: true,
            locationMode: .whileUsing,
            locationPreciseEnabled: true)

        #expect(semantics.caps.contains(OpenClawCapability.canvas.rawValue))
        #expect(semantics.caps.contains(OpenClawCapability.camera.rawValue))
        #expect(semantics.caps.contains(OpenClawCapability.location.rawValue))
        #expect(semantics.commands.contains(OpenClawCanvasCommand.snapshot.rawValue))
        #expect(semantics.commands.contains(OpenClawCameraCommand.snap.rawValue))
        #expect(semantics.commands.contains(OpenClawLocationCommand.get.rawValue))
    }
}
