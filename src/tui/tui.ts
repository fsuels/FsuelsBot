import {
  CombinedAutocompleteProvider,
  Container,
  ProcessTerminal,
  isKeyRelease,
  setEditorKeybindings,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import type {
  AgentSummary,
  SessionInfo,
  SessionScope,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { getSlashCommands } from "./commands.js";
import { ChatLog } from "./components/chat-log.js";
import { CustomEditor } from "./components/custom-editor.js";
import { GatewayChatClient } from "./gateway-chat.js";
import { editorTheme, theme } from "./theme/theme.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { resolveTuiCtrlCAction, type TuiCtrlCMode } from "./tui-ctrl-c.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { formatTokens } from "./tui-formatters.js";
import { InterceptingTerminal } from "./tui-intercepting-terminal.js";
import { createEditorKeybindingsManager, TuiShortcutManager } from "./tui-keybindings.js";
import { formatTuiFooterLine, formatTuiHeaderLine } from "./tui-layout.js";
import { createLocalShellRunner } from "./tui-local-shell.js";
import { createOverlayHandlers, handleOverlayEscape } from "./tui-overlays.js";
import { createSessionActions } from "./tui-session-actions.js";
import { createTuiSessionManager } from "./tui-session-manager.js";
import {
  buildBusyStatusLine,
  buildIdleStatusLine,
  resolveStatusTickMs,
} from "./tui-status-line.js";
import { createTuiTurnLifecycleStore } from "./tui-turn-lifecycle.js";

export { resolveFinalAssistantText } from "./tui-formatters.js";
export type { TuiOptions } from "./tui-types.js";

export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => Promise<void> | void;
  sendMessage: (value: string) => Promise<void> | void;
  handleBangLine: (value: string) => Promise<void> | void;
}) {
  return (text: string) => {
    const raw = text;
    const value = raw.trim();
    params.editor.setText("");

    // Keep previous behavior: ignore empty/whitespace-only submissions.
    if (!value) {
      return;
    }

    // Bash mode: only if the very first character is '!' and it's not just '!'.
    // IMPORTANT: use the raw (untrimmed) text so leading spaces do NOT trigger.
    // Per requirement: a lone '!' should be treated as a normal message.
    if (raw.startsWith("!") && raw !== "!") {
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    // Enable built-in editor prompt history navigation (up/down).
    params.editor.addToHistory(value);

    if (value.startsWith("/")) {
      void params.handleCommand(value);
      return;
    }

    void params.sendMessage(value);
  };
}

export async function runTui(opts: TuiOptions) {
  const config = loadConfig();
  setEditorKeybindings(createEditorKeybindingsManager(config.ui?.tui?.editor ?? {}));
  const shortcutManager = new TuiShortcutManager(config.ui?.tui?.shortcuts ?? {});
  const initialSessionInput = (opts.session ?? "").trim();
  let sessionScope: SessionScope = (config.session?.scope ?? "per-sender") as SessionScope;
  let sessionMainKey = normalizeMainKey(config.session?.mainKey);
  let agentDefaultId = resolveDefaultAgentId(config);
  let currentAgentId = agentDefaultId;
  let agents: AgentSummary[] = [];
  const agentNames = new Map<string, string>();
  let currentSessionKey = "";
  let initialSessionApplied = false;
  let currentSessionId: string | null = null;
  let historyLoaded = false;
  let isConnected = false;
  let wasDisconnected = false;
  let toolsExpanded = false;
  let showThinking = false;
  const localRunIds = new Set<string>();

  const deliverDefault = opts.deliver ?? false;
  const autoMessage = opts.message?.trim();
  let autoMessageSent = false;
  let sessionInfo: SessionInfo = {};
  let lastCtrlCAt = 0;
  let activityStatus = "idle";
  let connectionStatus = "connecting";
  let statusTimeout: NodeJS.Timeout | null = null;
  const turnLifecycle = createTuiTurnLifecycleStore();

  const state: TuiStateAccess = {
    get agentDefaultId() {
      return agentDefaultId;
    },
    set agentDefaultId(value) {
      agentDefaultId = value;
    },
    get sessionMainKey() {
      return sessionMainKey;
    },
    set sessionMainKey(value) {
      sessionMainKey = value;
    },
    get sessionScope() {
      return sessionScope;
    },
    set sessionScope(value) {
      sessionScope = value;
    },
    get agents() {
      return agents;
    },
    set agents(value) {
      agents = value;
    },
    get currentAgentId() {
      return currentAgentId;
    },
    set currentAgentId(value) {
      currentAgentId = value;
    },
    get currentSessionKey() {
      return currentSessionKey;
    },
    set currentSessionKey(value) {
      currentSessionKey = value;
    },
    get currentSessionId() {
      return currentSessionId;
    },
    set currentSessionId(value) {
      currentSessionId = value;
    },
    get activeChatRunId() {
      return turnLifecycle.getSnapshot().activeRunId;
    },
    set activeChatRunId(_value) {
      // The turn lifecycle store owns this value; writes are ignored here.
    },
    get historyLoaded() {
      return historyLoaded;
    },
    set historyLoaded(value) {
      historyLoaded = value;
    },
    get sessionInfo() {
      return sessionInfo;
    },
    set sessionInfo(value) {
      sessionInfo = value;
    },
    get initialSessionApplied() {
      return initialSessionApplied;
    },
    set initialSessionApplied(value) {
      initialSessionApplied = value;
    },
    get isConnected() {
      return isConnected;
    },
    set isConnected(value) {
      isConnected = value;
    },
    get autoMessageSent() {
      return autoMessageSent;
    },
    set autoMessageSent(value) {
      autoMessageSent = value;
    },
    get toolsExpanded() {
      return toolsExpanded;
    },
    set toolsExpanded(value) {
      toolsExpanded = value;
    },
    get showThinking() {
      return showThinking;
    },
    set showThinking(value) {
      showThinking = value;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    set connectionStatus(value) {
      connectionStatus = value;
    },
    get activityStatus() {
      return activityStatus;
    },
    set activityStatus(value) {
      activityStatus = value;
    },
    get statusTimeout() {
      return statusTimeout;
    },
    set statusTimeout(value) {
      statusTimeout = value;
    },
    get lastCtrlCAt() {
      return lastCtrlCAt;
    },
    set lastCtrlCAt(value) {
      lastCtrlCAt = value;
    },
  };

  const noteLocalRunId = (runId: string) => {
    if (!runId) {
      return;
    }
    localRunIds.add(runId);
    if (localRunIds.size > 200) {
      const [first] = localRunIds;
      if (first) {
        localRunIds.delete(first);
      }
    }
  };

  const forgetLocalRunId = (runId: string) => {
    localRunIds.delete(runId);
  };

  const isLocalRunId = (runId: string) => localRunIds.has(runId);

  const clearLocalRunIds = () => {
    localRunIds.clear();
  };

  const client = new GatewayChatClient({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const processTerminal = new ProcessTerminal();
  const terminal = new InterceptingTerminal(processTerminal);
  const tui = new TUI(terminal);
  const header = new Text("", 1, 0);
  const statusContainer = new Container();
  const statusText = new Text("", 1, 0);
  statusContainer.addChild(statusText);
  const footer = new Text("", 1, 0);
  const chatLog = new ChatLog();
  const editor = new CustomEditor(tui, editorTheme);
  editor.setShortcutManager(shortcutManager);
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(footer);
  root.addChild(editor);

  const updateAutocompleteProvider = () => {
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        getSlashCommands({
          cfg: config,
          provider: sessionInfo.modelProvider,
          model: sessionInfo.model,
        }),
        process.cwd(),
      ),
    );
  };

  tui.addChild(root);
  tui.setFocus(editor);

  const formatSessionKey = (key: string) => {
    if (key === "global" || key === "unknown") {
      return key;
    }
    const parsed = parseAgentSessionKey(key);
    return parsed?.rest ?? key;
  };

  const formatAgentLabel = (id: string) => {
    const name = agentNames.get(id);
    return name ? `${id} (${name})` : id;
  };

  const resolveSessionKey = (raw?: string) => {
    const trimmed = (raw ?? "").trim();
    if (sessionScope === "global") {
      return "global";
    }
    if (!trimmed) {
      return buildAgentMainSessionKey({
        agentId: currentAgentId,
        mainKey: sessionMainKey,
      });
    }
    if (trimmed === "global" || trimmed === "unknown") {
      return trimmed;
    }
    if (trimmed.startsWith("agent:")) {
      return trimmed;
    }
    return `agent:${currentAgentId}:${trimmed}`;
  };

  currentSessionKey = resolveSessionKey(initialSessionInput);

  const updateHeader = () => {
    const sessionLabel = formatSessionKey(currentSessionKey);
    const agentLabel = formatAgentLabel(currentAgentId);
    header.setText(
      theme.header(
        formatTuiHeaderLine({
          connectionUrl: client.connection.url,
          agentLabel,
          sessionLabel,
        }),
      ),
    );
  };

  let statusTick = 0;
  let lastBusyActivity: string | null = null;
  let statusTickTimer: NodeJS.Timeout | null = null;
  let statusTickDelayMs: number | null = null;

  const updateBusyStatusMessage = () => {
    const snapshot = turnLifecycle.getSnapshot();
    if (!snapshot.isLoading) {
      return;
    }
    statusText.setText(
      buildBusyStatusLine({
        snapshot,
        connectionStatus,
        width: process.stdout.columns ?? 80,
        theme,
        nowMs: Date.now(),
        tick: statusTick,
      }),
    );
  };

  const stopStatusTicker = () => {
    if (!statusTickTimer) {
      return;
    }
    clearTimeout(statusTickTimer);
    statusTickTimer = null;
    statusTickDelayMs = null;
  };

  const syncStatusTicker = () => {
    const snapshot = turnLifecycle.getSnapshot();
    const nextDelay = resolveStatusTickMs(snapshot, Date.now());
    if (nextDelay === null) {
      stopStatusTicker();
      return;
    }
    if (statusTickTimer && statusTickDelayMs === nextDelay) {
      return;
    }
    stopStatusTicker();
    statusTickDelayMs = nextDelay;

    const tick = () => {
      statusTickTimer = setTimeout(() => {
        const current = turnLifecycle.getSnapshot();
        if (!current.isLoading) {
          stopStatusTicker();
          return;
        }
        statusTick += 1;
        updateBusyStatusMessage();
        tui.requestRender();
        syncStatusTicker();
      }, nextDelay);
      statusTickTimer.unref?.();
    };

    tick();
  };

  const renderStatus = () => {
    const snapshot = turnLifecycle.getSnapshot();
    if (snapshot.isLoading) {
      if (lastBusyActivity !== snapshot.activityLabel) {
        statusTick = 0;
        lastBusyActivity = snapshot.activityLabel;
      }
      syncStatusTicker();
      updateBusyStatusMessage();
    } else {
      statusTick = 0;
      lastBusyActivity = null;
      stopStatusTicker();
      statusText.setText(
        buildIdleStatusLine({
          connectionStatus,
          activityStatus,
          width: process.stdout.columns ?? 80,
          theme,
        }),
      );
    }
  };

  const setConnectionStatus = (text: string, ttlMs?: number) => {
    connectionStatus = text;
    renderStatus();
    if (statusTimeout) {
      clearTimeout(statusTimeout);
    }
    if (ttlMs && ttlMs > 0) {
      statusTimeout = setTimeout(() => {
        connectionStatus = isConnected ? "connected" : "disconnected";
        renderStatus();
        tui.requestRender();
      }, ttlMs);
      statusTimeout.unref?.();
    }
    tui.requestRender();
  };

  const setActivityStatus = (text: string) => {
    activityStatus = text;
    renderStatus();
    tui.requestRender();
  };

  turnLifecycle.subscribe(() => {
    renderStatus();
    tui.requestRender();
  });

  const updateFooter = () => {
    const sessionKeyLabel = formatSessionKey(currentSessionKey);
    const sessionLabel = sessionInfo.displayName
      ? `${sessionKeyLabel} (${sessionInfo.displayName})`
      : sessionKeyLabel;
    const agentLabel = formatAgentLabel(currentAgentId);
    const modelLabel = sessionInfo.model
      ? sessionInfo.modelProvider
        ? `${sessionInfo.modelProvider}/${sessionInfo.model}`
        : sessionInfo.model
      : "unknown";
    const tokens = formatTokens(sessionInfo.totalTokens ?? null, sessionInfo.contextTokens ?? null);
    const think = sessionInfo.thinkingLevel ?? "off";
    const verbose = sessionInfo.verboseLevel ?? "off";
    const reasoning = sessionInfo.reasoningLevel ?? "off";
    const reasoningLabel =
      reasoning === "on" ? "reasoning" : reasoning === "stream" ? "reasoning:stream" : null;
    footer.setText(
      theme.dim(
        formatTuiFooterLine({
          sessionLabel: `${agentLabel} · ${sessionLabel}`,
          modelLabel,
          tokensLabel: tokens,
          thinkLabel: think !== "off" ? `think ${think}` : null,
          verboseLabel: verbose !== "off" ? `verbose ${verbose}` : null,
          reasoningLabel,
        }),
      ),
    );
  };

  const sessionManager = createTuiSessionManager({
    tui,
    terminal,
    onResizeSync: () => {
      updateHeader();
      updateFooter();
      renderStatus();
    },
    requestTerminalSizeRefresh: () => {
      if (process.platform !== "win32") {
        try {
          process.kill(process.pid, "SIGWINCH");
        } catch {
          // Best effort only; some platforms/environments may reject this.
        }
      }
    },
  });

  let exitRequested = false;
  let resolveExit: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const requestExit = (code = 0) => {
    if (exitRequested) {
      return;
    }
    exitRequested = true;
    void (async () => {
      try {
        client.stop();
      } catch {
        // Ignore shutdown races; cleanup below is idempotent.
      }
      if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      stopStatusTicker();
      await sessionManager.cleanup("tui exit");
      if (code !== 0) {
        process.exitCode = code;
      }
      resolveExit?.();
    })();
  };

  const forceRedraw = () => {
    sessionManager.forceRedraw();
    setActivityStatus("screen refreshed");
  };

  const { openOverlay, closeOverlay, hasActiveOverlay } = createOverlayHandlers(tui, editor);
  const ctrlCMode = (config.ui?.tui?.ctrlC ?? "double-press-exit") as TuiCtrlCMode;

  const initialSessionAgentId = (() => {
    if (!initialSessionInput) {
      return null;
    }
    const parsed = parseAgentSessionKey(initialSessionInput);
    return parsed ? normalizeAgentId(parsed.agentId) : null;
  })();

  const sessionActions = createSessionActions({
    client,
    chatLog,
    tui,
    opts,
    state,
    agentNames,
    initialSessionInput,
    initialSessionAgentId,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    updateAutocompleteProvider,
    setActivityStatus,
    turnLifecycle,
    clearLocalRunIds,
  });
  const {
    refreshAgents,
    refreshSessionInfo,
    applySessionInfoFromPatch,
    loadHistory,
    setSession,
    abortActive,
  } = sessionActions;

  const { handleChatEvent, handleAgentEvent } = createEventHandlers({
    chatLog,
    tui,
    state,
    setActivityStatus,
    turnLifecycle,
    refreshSessionInfo,
    loadHistory,
    isLocalRunId,
    forgetLocalRunId,
    clearLocalRunIds,
  });

  const { handleCommand, sendMessage, openModelSelector, openAgentSelector, openSessionSelector } =
    createCommandHandlers({
      client,
      chatLog,
      tui,
      opts,
      state,
      deliverDefault,
      openOverlay,
      closeOverlay,
      refreshSessionInfo,
      applySessionInfoFromPatch,
      loadHistory,
      setSession,
      refreshAgents,
      abortActive,
      setActivityStatus,
      turnLifecycle,
      formatSessionKey,
      noteLocalRunId,
      forgetLocalRunId,
      forceRedraw,
      requestExit,
    });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    openOverlay,
    closeOverlay,
  });
  updateAutocompleteProvider();
  editor.onSubmit = createEditorSubmitHandler({
    editor,
    handleCommand,
    sendMessage,
    handleBangLine: runLocalShellLine,
  });

  const handleCtrlCShortcut = () => {
    const decision = resolveTuiCtrlCAction({
      nowMs: Date.now(),
      lastCtrlCAt,
      mode: ctrlCMode,
      hasActiveOverlay: hasActiveOverlay(),
      hasEditorText: editor.getText().trim().length > 0,
      hasActiveRun: Boolean(turnLifecycle.getSnapshot().activeRunId),
    });
    lastCtrlCAt = decision.nextLastCtrlCAt;

    if (decision.action === "close-overlay") {
      closeOverlay();
    } else if (decision.action === "clear-input") {
      editor.setText("");
    } else if (decision.action === "abort") {
      void abortActive();
    } else if (decision.action === "exit") {
      requestExit(0);
      return;
    }

    if (decision.statusText) {
      setActivityStatus(decision.statusText);
    } else {
      tui.requestRender();
    }
  };

  terminal.setInputInterceptor((data) => {
    if (isKeyRelease(data)) {
      return false;
    }
    if (!shortcutManager.matches(data, "clearInputOrExit")) {
      return false;
    }
    handleCtrlCShortcut();
    return true;
  });

  editor.setShortcutHandler("abortRun", () => {
    handleOverlayEscape({
      hasActiveOverlay,
      closeOverlay,
      canAbortActive: () => Boolean(turnLifecycle.getSnapshot().activeRunId),
      abortActive,
      requestRender: () => tui.requestRender(),
    });
  });
  editor.setShortcutHandler("clearInputOrExit", () => {
    handleCtrlCShortcut();
  });
  editor.setShortcutHandler("exit", () => {
    requestExit(0);
  });
  editor.setShortcutHandler("forceRedraw", () => {
    forceRedraw();
  });
  editor.setShortcutHandler("toggleToolOutput", () => {
    toolsExpanded = !toolsExpanded;
    chatLog.setToolsExpanded(toolsExpanded);
    setActivityStatus(toolsExpanded ? "tools expanded" : "tools collapsed");
    tui.requestRender();
  });
  editor.setShortcutHandler("openModelPicker", () => {
    void openModelSelector();
  });
  editor.setShortcutHandler("openAgentPicker", () => {
    void openAgentSelector();
  });
  editor.setShortcutHandler("openSessionPicker", () => {
    void openSessionSelector();
  });
  editor.setShortcutHandler("toggleThinking", () => {
    showThinking = !showThinking;
    void loadHistory();
  });

  client.onEvent = (evt) => {
    if (evt.event === "chat") {
      handleChatEvent(evt.payload);
    }
    if (evt.event === "agent") {
      handleAgentEvent(evt.payload);
    }
  };

  client.onConnected = () => {
    isConnected = true;
    const reconnected = wasDisconnected;
    wasDisconnected = false;
    setConnectionStatus("connected");
    void (async () => {
      await refreshAgents();
      updateHeader();
      await loadHistory();
      setConnectionStatus(reconnected ? "gateway reconnected" : "gateway connected", 4000);
      tui.requestRender();
      if (!autoMessageSent && autoMessage) {
        autoMessageSent = true;
        await sendMessage(autoMessage);
      }
      updateFooter();
      tui.requestRender();
    })();
  };

  client.onDisconnected = (reason) => {
    isConnected = false;
    wasDisconnected = true;
    historyLoaded = false;
    turnLifecycle.reset();
    const reasonLabel = reason?.trim() ? reason.trim() : "closed";
    setConnectionStatus(`gateway disconnected: ${reasonLabel}`, 5000);
    setActivityStatus("idle");
    updateFooter();
    tui.requestRender();
  };

  client.onGap = (info) => {
    setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`, 5000);
    tui.requestRender();
  };

  const handleResize = () => {
    sessionManager.handleResize();
  };
  const handleSigCont = () => {
    sessionManager.handleSigCont();
  };
  const handleSigInt = () => {
    requestExit(0);
  };
  const handleSigTerm = () => {
    requestExit(0);
  };
  process.stdout.on("resize", handleResize);
  process.on("SIGCONT", handleSigCont);
  process.once("SIGINT", handleSigInt);
  process.once("SIGTERM", handleSigTerm);

  updateHeader();
  setConnectionStatus("connecting");
  updateFooter();
  sessionManager.activate();
  try {
    tui.start();
    client.start();
    await exitPromise;
  } finally {
    process.stdout.off("resize", handleResize);
    process.off("SIGCONT", handleSigCont);
    process.off("SIGINT", handleSigInt);
    process.off("SIGTERM", handleSigTerm);
    await sessionManager.cleanup("tui finalizer");
  }
}
