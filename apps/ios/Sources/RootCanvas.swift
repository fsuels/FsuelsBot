import SwiftUI
import UIKit

struct RootCanvas: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(VoiceWakeManager.self) private var voiceWake
    @Environment(\.colorScheme) private var systemColorScheme
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(VoiceWakePreferences.enabledKey) private var voiceWakeEnabled: Bool = false
    @AppStorage("screen.preventSleep") private var preventSleep: Bool = true
    @AppStorage("canvas.debugStatusEnabled") private var canvasDebugStatusEnabled: Bool = false
    @AppStorage("gateway.onboardingComplete") private var onboardingComplete: Bool = false
    @AppStorage("gateway.hasConnectedOnce") private var hasConnectedOnce: Bool = false
    @AppStorage("gateway.preferredStableID") private var preferredGatewayStableID: String = ""
    @AppStorage("gateway.manual.enabled") private var manualGatewayEnabled: Bool = false
    @AppStorage("gateway.manual.host") private var manualGatewayHost: String = ""
    @State private var presentedSheet: PresentedSheet?
    @State private var voiceWakeToastText: String?
    @State private var toastDismissTask: Task<Void, Never>?
    @State private var didAutoOpenSettings: Bool = false

    private enum PresentedSheet: Identifiable {
        case settings
        case chat

        var id: Int {
            switch self {
            case .settings: 0
            case .chat: 1
            }
        }
    }

    var body: some View {
        ZStack {
            CanvasContent(
                systemColorScheme: self.systemColorScheme,
                gatewayStatus: self.gatewayStatus,
                voiceWakeEnabled: self.voiceWakeEnabled,
                voiceWakeToastText: self.voiceWakeToastText,
                cameraHUDText: self.appModel.cameraHUDText,
                cameraHUDKind: self.appModel.cameraHUDKind,
                openChat: {
                    self.presentedSheet = .chat
                },
                openSettings: {
                    self.presentedSheet = .settings
                })
                .preferredColorScheme(.dark)

            if self.appModel.cameraFlashNonce != 0 {
                CameraFlashOverlay(nonce: self.appModel.cameraFlashNonce)
            }
        }
        .sheet(item: self.$presentedSheet) { sheet in
            switch sheet {
            case .settings:
                SettingsTab()
            case .chat:
                ChatSheet(
                    gateway: self.appModel.operatorSession,
                    sessionKey: self.appModel.mainSessionKey,
                    agentName: self.appModel.activeAgentName,
                    userAccent: self.appModel.seamColor)
            }
        }
        .sheet(
            item: Binding(
                get: { self.appModel.pendingDeepLinkReview },
                set: { self.appModel.pendingDeepLinkReview = $0 }))
        { review in
            DeepLinkReviewSheet(
                review: review,
                approve: { self.appModel.approvePendingDeepLink() },
                cancel: { self.appModel.cancelPendingDeepLink() })
        }
        .onAppear { self.updateIdleTimer() }
        .onAppear { self.maybeAutoOpenSettings() }
        .onChange(of: self.preventSleep) { _, _ in self.updateIdleTimer() }
        .onChange(of: self.scenePhase) { _, _ in self.updateIdleTimer() }
        .onAppear { self.updateCanvasDebugStatus() }
        .onChange(of: self.canvasDebugStatusEnabled) { _, _ in self.updateCanvasDebugStatus() }
        .onChange(of: self.appModel.gatewayStatusText) { _, _ in self.updateCanvasDebugStatus() }
        .onChange(of: self.appModel.gatewayServerName) { _, _ in self.updateCanvasDebugStatus() }
        .onChange(of: self.appModel.gatewayRemoteAddress) { _, _ in self.updateCanvasDebugStatus() }
        .onChange(of: self.appModel.gatewayServerName) { _, newValue in
            if newValue != nil {
                self.onboardingComplete = true
                self.hasConnectedOnce = true
            }
            self.maybeAutoOpenSettings()
        }
        .onChange(of: self.voiceWake.lastTriggeredCommand) { _, newValue in
            guard let newValue else { return }
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }

            self.toastDismissTask?.cancel()
            withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
                self.voiceWakeToastText = trimmed
            }

            self.toastDismissTask = Task {
                try? await Task.sleep(nanoseconds: 2_300_000_000)
                await MainActor.run {
                    withAnimation(.easeOut(duration: 0.25)) {
                        self.voiceWakeToastText = nil
                    }
                }
            }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            self.toastDismissTask?.cancel()
            self.toastDismissTask = nil
        }
    }

    private var gatewayStatus: StatusPill.GatewayState {
        if self.appModel.gatewayServerName != nil { return .connected }

        let text = self.appModel.gatewayStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.localizedCaseInsensitiveContains("connecting") ||
            text.localizedCaseInsensitiveContains("reconnecting")
        {
            return .connecting
        }

        if text.localizedCaseInsensitiveContains("error") {
            return .error
        }

        return .disconnected
    }

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = (self.scenePhase == .active && self.preventSleep)
    }

    private func updateCanvasDebugStatus() {
        self.appModel.screen.setDebugStatusEnabled(self.canvasDebugStatusEnabled)
        guard self.canvasDebugStatusEnabled else { return }
        let title = self.appModel.gatewayStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = self.appModel.gatewayServerName ?? self.appModel.gatewayRemoteAddress
        self.appModel.screen.updateDebugStatus(title: title, subtitle: subtitle)
    }

    private func shouldAutoOpenSettings() -> Bool {
        if self.appModel.gatewayServerName != nil { return false }
        if !self.hasConnectedOnce { return true }
        if !self.onboardingComplete { return true }
        return !self.hasExistingGatewayConfig()
    }

    private func hasExistingGatewayConfig() -> Bool {
        if GatewaySettingsStore.loadLastGatewayConnection() != nil { return true }
        let manualHost = self.manualGatewayHost.trimmingCharacters(in: .whitespacesAndNewlines)
        return self.manualGatewayEnabled && !manualHost.isEmpty
    }

    private func maybeAutoOpenSettings() {
        guard !self.didAutoOpenSettings else { return }
        guard self.shouldAutoOpenSettings() else { return }
        self.didAutoOpenSettings = true
        self.presentedSheet = .settings
    }
}

private struct DeepLinkReviewSheet: View {
    let review: NodeAppModel.PendingDeepLinkReview
    let approve: () -> Void
    let cancel: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    self.warningCard(
                        title: "External prompt review",
                        text: "This request came from outside the chat composer. Review the prompt, source, and routing details before running it.")

                    if self.review.isLongPrompt {
                        self.warningCard(
                            title: "Long prompt",
                            text: "This prompt is longer than a typical one-screen preview. Scroll through the full message before continuing.")
                    }

                    self.metaRow(title: "Source", value: self.sourceLabel)
                    self.metaRow(title: "Payload", value: "\(self.review.origin.payloadLength ?? self.review.link.message.count) characters")

                    if let sessionKey = self.review.link.sessionKey, !sessionKey.isEmpty {
                        self.metaRow(title: "Session", value: sessionKey)
                    }
                    if let channel = self.review.link.channel, !channel.isEmpty {
                        self.metaRow(title: "Channel", value: channel)
                    }
                    if let target = self.review.link.to, !target.isEmpty {
                        self.metaRow(title: "Target", value: target)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Prompt")
                            .font(.headline)
                        Text(self.review.link.message)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }

                    if let rawUri = self.review.origin.rawUri, !rawUri.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Original link")
                                .font(.headline)
                            Text(rawUri)
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Review Deep Link")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    Button("Run Prompt") {
                        self.dismiss()
                        self.approve()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)

                    Button("Cancel", role: .cancel) {
                        self.dismiss()
                        self.cancel()
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 20)
                .background(.ultraThinMaterial)
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var sourceLabel: String {
        switch self.review.origin.source {
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

    @ViewBuilder
    private func warningCard(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.orange.opacity(0.25), lineWidth: 1)
        }
    }

    @ViewBuilder
    private func metaRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct CanvasContent: View {
    @Environment(NodeAppModel.self) private var appModel
    @AppStorage("talk.enabled") private var talkEnabled: Bool = false
    @AppStorage("talk.button.enabled") private var talkButtonEnabled: Bool = true
    @State private var showGatewayActions: Bool = false
    var systemColorScheme: ColorScheme
    var gatewayStatus: StatusPill.GatewayState
    var voiceWakeEnabled: Bool
    var voiceWakeToastText: String?
    var cameraHUDText: String?
    var cameraHUDKind: NodeAppModel.CameraHUDKind?
    var openChat: () -> Void
    var openSettings: () -> Void

    private var brightenButtons: Bool { self.systemColorScheme == .light }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ScreenTab()

            VStack(spacing: 10) {
                OverlayButton(systemImage: "text.bubble.fill", brighten: self.brightenButtons) {
                    self.openChat()
                }
                .accessibilityLabel("Chat")

                if self.talkButtonEnabled {
                    // Talk mode lives on a side bubble so it doesn't get buried in settings.
                    OverlayButton(
                        systemImage: self.appModel.talkMode.isEnabled ? "waveform.circle.fill" : "waveform.circle",
                        brighten: self.brightenButtons,
                        tint: self.appModel.seamColor,
                        isActive: self.appModel.talkMode.isEnabled)
                    {
                        let next = !self.appModel.talkMode.isEnabled
                        self.talkEnabled = next
                        self.appModel.setTalkEnabled(next)
                    }
                    .accessibilityLabel("Talk Mode")
                }

                OverlayButton(systemImage: "gearshape.fill", brighten: self.brightenButtons) {
                    self.openSettings()
                }
                .accessibilityLabel("Settings")
            }
            .padding(.top, 10)
            .padding(.trailing, 10)
        }
        .overlay(alignment: .center) {
            if self.appModel.talkMode.isEnabled {
                TalkOrbOverlay()
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .topLeading) {
            StatusPill(
                gateway: self.gatewayStatus,
                voiceWakeEnabled: self.voiceWakeEnabled,
                activity: self.statusActivity,
                brighten: self.brightenButtons,
                onTap: {
                    if self.gatewayStatus == .connected {
                        self.showGatewayActions = true
                    } else {
                        self.openSettings()
                    }
                })
                .padding(.leading, 10)
                .safeAreaPadding(.top, 10)
        }
        .overlay(alignment: .topLeading) {
            if let voiceWakeToastText, !voiceWakeToastText.isEmpty {
                VoiceWakeToast(
                    command: voiceWakeToastText,
                    brighten: self.brightenButtons)
                    .padding(.leading, 10)
                    .safeAreaPadding(.top, 58)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .confirmationDialog(
            "Gateway",
            isPresented: self.$showGatewayActions,
            titleVisibility: .visible)
        {
            Button("Disconnect", role: .destructive) {
                self.appModel.disconnectGateway()
            }
            Button("Open Settings") {
                self.openSettings()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Disconnect from the gateway?")
        }
    }

    private var statusActivity: StatusPill.Activity? {
        // Status pill owns transient activity state so it doesn't overlap the connection indicator.
        if self.appModel.isBackgrounded {
            return StatusPill.Activity(
                title: "Foreground required",
                systemImage: "exclamationmark.triangle.fill",
                tint: .orange)
        }

        let gatewayStatus = self.appModel.gatewayStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
        let gatewayLower = gatewayStatus.lowercased()
        if gatewayLower.contains("repair") {
            return StatusPill.Activity(title: "Repairing…", systemImage: "wrench.and.screwdriver", tint: .orange)
        }
        if gatewayLower.contains("approval") || gatewayLower.contains("pairing") {
            return StatusPill.Activity(title: "Approval pending", systemImage: "person.crop.circle.badge.clock")
        }
        // Avoid duplicating the primary gateway status ("Connecting…") in the activity slot.

        if self.appModel.screenRecordActive {
            return StatusPill.Activity(title: "Recording screen…", systemImage: "record.circle.fill", tint: .red)
        }

        if let cameraHUDText, !cameraHUDText.isEmpty, let cameraHUDKind {
            let systemImage: String
            let tint: Color?
            switch cameraHUDKind {
            case .photo:
                systemImage = "camera.fill"
                tint = nil
            case .recording:
                systemImage = "video.fill"
                tint = .red
            case .success:
                systemImage = "checkmark.circle.fill"
                tint = .green
            case .error:
                systemImage = "exclamationmark.triangle.fill"
                tint = .red
            }
            return StatusPill.Activity(title: cameraHUDText, systemImage: systemImage, tint: tint)
        }

        if self.voiceWakeEnabled {
            let voiceStatus = self.appModel.voiceWake.statusText
            if voiceStatus.localizedCaseInsensitiveContains("microphone permission") {
                return StatusPill.Activity(title: "Mic permission", systemImage: "mic.slash", tint: .orange)
            }
            if voiceStatus == "Paused" {
                // Talk mode intentionally pauses voice wake to release the mic. Don't spam the HUD for that case.
                if self.appModel.talkMode.isEnabled {
                    return nil
                }
                let suffix = self.appModel.isBackgrounded ? " (background)" : ""
                return StatusPill.Activity(title: "Voice Wake paused\(suffix)", systemImage: "pause.circle.fill")
            }
        }

        return nil
    }
}

private struct OverlayButton: View {
    let systemImage: String
    let brighten: Bool
    var tint: Color?
    var isActive: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Image(systemName: self.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(self.isActive ? (self.tint ?? .primary) : .primary)
                .padding(10)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            .white.opacity(self.brighten ? 0.26 : 0.18),
                                            .white.opacity(self.brighten ? 0.08 : 0.04),
                                            .clear,
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing))
                                .blendMode(.overlay)
                        }
                        .overlay {
                            if let tint {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(
                                        LinearGradient(
                                            colors: [
                                                tint.opacity(self.isActive ? 0.22 : 0.14),
                                                tint.opacity(self.isActive ? 0.10 : 0.06),
                                                .clear,
                                            ],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing))
                                    .blendMode(.overlay)
                            }
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(
                                    (self.tint ?? .white).opacity(self.isActive ? 0.34 : (self.brighten ? 0.24 : 0.18)),
                                    lineWidth: self.isActive ? 0.7 : 0.5)
                        }
                        .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
                }
        }
        .buttonStyle(.plain)
    }
}

private struct CameraFlashOverlay: View {
    var nonce: Int

    @State private var opacity: CGFloat = 0
    @State private var task: Task<Void, Never>?

    var body: some View {
        Color.white
            .opacity(self.opacity)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .onChange(of: self.nonce) { _, _ in
                self.task?.cancel()
                self.task = Task { @MainActor in
                    withAnimation(.easeOut(duration: 0.08)) {
                        self.opacity = 0.85
                    }
                    try? await Task.sleep(nanoseconds: 110_000_000)
                    withAnimation(.easeOut(duration: 0.32)) {
                        self.opacity = 0
                    }
                }
            }
    }
}
