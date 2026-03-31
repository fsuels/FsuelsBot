import type { TUI } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ChatLog } from "./components/chat-log.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { createTuiTurnLifecycleStore } from "./tui-turn-lifecycle.js";

type MockChatLog = Pick<
  ChatLog,
  "startTool" | "updateToolResult" | "addSystem" | "updateAssistant" | "finalizeAssistant"
>;
type MockTui = Pick<TUI, "requestRender">;

describe("tui-event-handlers: handleAgentEvent", () => {
  const makeState = (overrides?: Partial<TuiStateAccess>): TuiStateAccess => ({
    agentDefaultId: "main",
    sessionMainKey: "agent:main:main",
    sessionScope: "global",
    agents: [],
    currentAgentId: "main",
    currentSessionKey: "agent:main:main",
    currentSessionId: "session-1",
    activeChatRunId: "run-1",
    historyLoaded: true,
    sessionInfo: { verboseLevel: "on" },
    initialSessionApplied: true,
    isConnected: true,
    autoMessageSent: false,
    toolsExpanded: false,
    showThinking: false,
    connectionStatus: "connected",
    activityStatus: "idle",
    statusTimeout: null,
    lastCtrlCAt: 0,
    ...overrides,
  });

  const makeContext = (state: TuiStateAccess) => {
    const turnLifecycle = createTuiTurnLifecycleStore();
    if (state.activeChatRunId) {
      turnLifecycle.adoptObservedRun(state.activeChatRunId);
    }
    Object.defineProperty(state, "activeChatRunId", {
      configurable: true,
      get: () => turnLifecycle.getSnapshot().activeRunId,
      set: (value: string | null) => {
        if (!value) {
          turnLifecycle.reset();
          return;
        }
        turnLifecycle.adoptObservedRun(value);
      },
    });
    const chatLog: MockChatLog = {
      startTool: vi.fn(),
      updateToolResult: vi.fn(),
      addSystem: vi.fn(),
      updateAssistant: vi.fn(),
      finalizeAssistant: vi.fn(),
    };
    const tui: MockTui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();
    const loadHistory = vi.fn();
    const localRunIds = new Set<string>();
    const noteLocalRunId = (runId: string) => {
      localRunIds.add(runId);
    };
    const forgetLocalRunId = (runId: string) => {
      localRunIds.delete(runId);
    };
    const isLocalRunId = (runId: string) => localRunIds.has(runId);
    const clearLocalRunIds = () => {
      localRunIds.clear();
    };

    return {
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
      loadHistory,
      noteLocalRunId,
      forgetLocalRunId,
      isLocalRunId,
      clearLocalRunIds,
    };
  };

  it("processes tool events when runId matches activeChatRunId (even if sessionId differs)", () => {
    const state = makeState({ currentSessionId: "session-xyz", activeChatRunId: "run-123" });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    const evt: AgentEvent = {
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc1",
        name: "exec",
        args: { command: "echo hi" },
      },
    };

    handleAgentEvent(evt);

    expect(chatLog.startTool).toHaveBeenCalledWith("tc1", "exec", { command: "echo hi" });
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("ignores tool events when runId does not match activeChatRunId", () => {
    const state = makeState({ activeChatRunId: "run-1" });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    const evt: AgentEvent = {
      runId: "run-2",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc1", name: "exec" },
    };

    handleAgentEvent(evt);

    expect(chatLog.startTool).not.toHaveBeenCalled();
    expect(chatLog.updateToolResult).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("processes lifecycle events when runId matches activeChatRunId", () => {
    const state = makeState({ activeChatRunId: "run-9" });
    const { tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog: {
        startTool: vi.fn(),
        updateToolResult: vi.fn(),
        addSystem: vi.fn(),
        updateAssistant: vi.fn(),
        finalizeAssistant: vi.fn(),
      },
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    const evt: AgentEvent = {
      runId: "run-9",
      stream: "lifecycle",
      data: { phase: "start" },
    };

    handleAgentEvent(evt);

    expect(turnLifecycle.getSnapshot().activityLabel).toBe("running");
    expect(setActivityStatus).not.toHaveBeenCalled();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("captures runId from chat events when activeChatRunId is unset", () => {
    const state = makeState({ activeChatRunId: null });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleChatEvent, handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    const chatEvt: ChatEvent = {
      runId: "run-42",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    };

    handleChatEvent(chatEvt);

    expect(turnLifecycle.getSnapshot().activeRunId).toBe("run-42");

    const agentEvt: AgentEvent = {
      runId: "run-42",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc1", name: "exec" },
    };

    handleAgentEvent(agentEvt);

    expect(chatLog.startTool).toHaveBeenCalledWith("tc1", "exec", undefined);
  });

  it("ignores a late final after the run was already cancelled", () => {
    const state = makeState({ activeChatRunId: "run-cancelled" });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleChatEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    turnLifecycle.cancel("run-cancelled");
    setActivityStatus.mockClear();

    handleChatEvent({
      runId: "run-cancelled",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    expect(turnLifecycle.getSnapshot().phase).toBe("cancelled");
    expect(setActivityStatus).not.toHaveBeenCalled();
  });

  it("clears run mapping when the session changes", () => {
    const state = makeState({ activeChatRunId: null });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleChatEvent, handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleChatEvent({
      runId: "run-old",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    });

    state.currentSessionKey = "agent:main:other";
    state.activeChatRunId = null;
    tui.requestRender.mockClear();

    handleAgentEvent({
      runId: "run-old",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc2", name: "exec" },
    });

    expect(chatLog.startTool).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("accepts tool events after chat final for the same run", () => {
    const state = makeState({ activeChatRunId: null });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleChatEvent, handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleChatEvent({
      runId: "run-final",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    handleAgentEvent({
      runId: "run-final",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc-final", name: "session_status" },
    });

    expect(chatLog.startTool).toHaveBeenCalledWith("tc-final", "session_status", undefined);
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("ignores lifecycle updates for non-active runs in the same session", () => {
    const state = makeState({ activeChatRunId: "run-active" });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleChatEvent, handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleChatEvent({
      runId: "run-other",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    });
    setActivityStatus.mockClear();
    tui.requestRender.mockClear();

    handleAgentEvent({
      runId: "run-other",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    expect(setActivityStatus).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("suppresses tool events when verbose is off", () => {
    const state = makeState({
      activeChatRunId: "run-123",
      sessionInfo: { verboseLevel: "off" },
    });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc-off", name: "session_status" },
    });

    expect(chatLog.startTool).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("omits tool output when verbose is on (non-full)", () => {
    const state = makeState({
      activeChatRunId: "run-123",
      sessionInfo: { verboseLevel: "on" },
    });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "update",
        toolCallId: "tc-on",
        name: "session_status",
        partialResult: { content: [{ type: "text", text: "secret" }] },
      },
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "result",
        toolCallId: "tc-on",
        name: "session_status",
        result: { content: [{ type: "text", text: "secret" }] },
        isError: false,
      },
    });

    expect(chatLog.updateToolResult).toHaveBeenCalledTimes(1);
    expect(chatLog.updateToolResult).toHaveBeenCalledWith(
      "tc-on",
      { content: [] },
      { isError: false },
    );
  });

  it("preserves tool status metadata when verbose output is hidden", () => {
    const state = makeState({
      activeChatRunId: "run-123",
      sessionInfo: { verboseLevel: "on" },
    });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "result",
        toolCallId: "tc-meta",
        name: "sessions_send",
        isError: true,
        startedAt: 1_000,
        endedAt: 2_500,
        elapsedMs: 1_500,
        resultStatus: "timeout",
        errorSummary: "gateway timeout",
      },
    });

    expect(chatLog.startTool).toHaveBeenCalledWith("tc-meta", "sessions_send", undefined, {
      startedAt: 1_000,
    });
    expect(chatLog.updateToolResult).toHaveBeenCalledWith(
      "tc-meta",
      { content: [] },
      {
        isError: true,
        status: "timeout",
        errorSummary: "gateway timeout",
        startedAt: 1_000,
        completedAt: 2_500,
        elapsedMs: 1_500,
      },
    );
  });

  it("creates a tool bubble when a result arrives before the start event", () => {
    const state = makeState({
      activeChatRunId: "run-123",
      sessionInfo: { verboseLevel: "full" },
    });
    const { chatLog, tui, setActivityStatus, turnLifecycle } = makeContext(state);
    const { handleAgentEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "result",
        toolCallId: "tc-late",
        name: "exec",
        result: { content: [{ type: "text", text: "ok" }] },
        isError: false,
      },
    });

    expect(chatLog.startTool).toHaveBeenCalledWith("tc-late", "exec", undefined);
    expect(chatLog.updateToolResult).toHaveBeenCalledWith(
      "tc-late",
      { content: [{ type: "text", text: "ok" }] },
      { isError: false },
    );
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("refreshes history after a non-local chat final", () => {
    const state = makeState({ activeChatRunId: null });
    const {
      chatLog,
      tui,
      setActivityStatus,
      turnLifecycle,
      loadHistory,
      isLocalRunId,
      forgetLocalRunId,
    } = makeContext(state);
    const { handleChatEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      turnLifecycle,
      loadHistory,
      isLocalRunId,
      forgetLocalRunId,
    });

    handleChatEvent({
      runId: "external-run",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    expect(loadHistory).toHaveBeenCalledTimes(1);
  });
});
