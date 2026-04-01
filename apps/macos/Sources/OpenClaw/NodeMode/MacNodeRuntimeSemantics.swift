import OpenClawKit
import Foundation

struct MacNodeRuntimeSemantics: Equatable, Sendable {
    var canvasEnabled: Bool
    var cameraEnabled: Bool
    var locationMode: OpenClawLocationMode
    var locationPreciseEnabled: Bool

    init(
        canvasEnabled: Bool,
        cameraEnabled: Bool,
        locationMode: OpenClawLocationMode,
        locationPreciseEnabled: Bool)
    {
        self.canvasEnabled = canvasEnabled
        self.cameraEnabled = cameraEnabled
        self.locationMode = locationMode
        self.locationPreciseEnabled = locationPreciseEnabled
    }

    static func load(defaults: UserDefaults = .standard) -> Self {
        let canvasEnabled = defaults.object(forKey: canvasEnabledKey) as? Bool ?? true
        let cameraEnabled = defaults.object(forKey: cameraEnabledKey) as? Bool ?? false
        let rawLocationMode = defaults.string(forKey: locationModeKey) ?? OpenClawLocationMode.off.rawValue
        let locationMode = OpenClawLocationMode(rawValue: rawLocationMode) ?? .off
        let locationPreciseEnabled = defaults.object(forKey: locationPreciseKey) as? Bool ?? true
        return Self(
            canvasEnabled: canvasEnabled,
            cameraEnabled: cameraEnabled,
            locationMode: locationMode,
            locationPreciseEnabled: locationPreciseEnabled)
    }

    var caps: [String] {
        var caps: [String] = [OpenClawCapability.screen.rawValue]
        if self.canvasEnabled {
            caps.append(OpenClawCapability.canvas.rawValue)
        }
        if self.cameraEnabled {
            caps.append(OpenClawCapability.camera.rawValue)
        }
        if self.locationMode != .off {
            caps.append(OpenClawCapability.location.rawValue)
        }
        return caps
    }

    var commands: [String] {
        var commands: [String] = [
            MacNodeScreenCommand.record.rawValue,
            OpenClawSystemCommand.notify.rawValue,
            OpenClawSystemCommand.which.rawValue,
            OpenClawSystemCommand.run.rawValue,
            OpenClawSystemCommand.execApprovalsGet.rawValue,
            OpenClawSystemCommand.execApprovalsSet.rawValue,
        ]

        if self.canvasEnabled {
            commands.append(contentsOf: [
                OpenClawCanvasCommand.present.rawValue,
                OpenClawCanvasCommand.hide.rawValue,
                OpenClawCanvasCommand.navigate.rawValue,
                OpenClawCanvasCommand.evalJS.rawValue,
                OpenClawCanvasCommand.snapshot.rawValue,
                OpenClawCanvasA2UICommand.push.rawValue,
                OpenClawCanvasA2UICommand.pushJSONL.rawValue,
                OpenClawCanvasA2UICommand.reset.rawValue,
            ])
        }

        if self.cameraEnabled {
            commands.append(contentsOf: [
                OpenClawCameraCommand.list.rawValue,
                OpenClawCameraCommand.snap.rawValue,
                OpenClawCameraCommand.clip.rawValue,
            ])
        }

        if self.locationMode != .off {
            commands.append(OpenClawLocationCommand.get.rawValue)
        }

        return commands
    }
}
