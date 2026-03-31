import type { TUI } from "@mariozechner/pi-tui";
import type { ChatLog } from "./components/chat-log.js";
import type { TuiTurnLifecycleStore } from "./tui-turn-lifecycle.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";
import { asString, extractTextFromMessage, isCommandMessage } from "./tui-formatters.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";

type EventHandlerContext = {
  chatLog: ChatLog;
  tui: TUI;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  turnLifecycle: TuiTurnLifecycleStore;
  refreshSessionInfo?: () => Promise<void>;
  loadHistory?: () => Promise<void>;
  isLocalRunId?: (runId: string) => boolean;
  forgetLocalRunId?: (runId: string) => void;
  clearLocalRunIds?: () => void;
};

export function createEventHandlers(context: EventHandlerContext) {
  const {
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
  } = context;
  const finalizedRuns = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  let streamAssembler = new TuiStreamAssembler();
  let lastSessionKey = state.currentSessionKey;

  const pruneRunMap = (runs: Map<string, number>) => {
    if (runs.size <= 200) {
      return;
    }
    const keepUntil = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of runs) {
      if (runs.size <= 150) {
        break;
      }
      if (ts < keepUntil) {
        runs.delete(key);
      }
    }
    if (runs.size > 200) {
      for (const key of runs.keys()) {
        runs.delete(key);
        if (runs.size <= 150) {
          break;
        }
      }
    }
  };

  const syncSessionKey = () => {
    if (state.currentSessionKey === lastSessionKey) {
      return;
    }
    lastSessionKey = state.currentSessionKey;
    finalizedRuns.clear();
    sessionRuns.clear();
    streamAssembler = new TuiStreamAssembler();
    turnLifecycle.reset();
    clearLocalRunIds?.();
  };

  const noteSessionRun = (runId: string) => {
    sessionRuns.set(runId, Date.now());
    pruneRunMap(sessionRuns);
  };

  const noteFinalizedRun = (runId: string) => {
    finalizedRuns.set(runId, Date.now());
    sessionRuns.delete(runId);
    streamAssembler.drop(runId);
    pruneRunMap(finalizedRuns);
  };

  const readOptionalNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const readOptionalString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const handleChatEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as ChatEvent;
    syncSessionKey();
    if (evt.sessionKey !== state.currentSessionKey) {
      return;
    }
    if (finalizedRuns.has(evt.runId)) {
      if (evt.state === "delta") {
        return;
      }
      if (evt.state === "final") {
        return;
      }
    }
    noteSessionRun(evt.runId);
    if (evt.state === "delta") {
      if (!turnLifecycle.markStreaming(evt.runId)) {
        turnLifecycle.adoptObservedRun(evt.runId, "streaming");
      }
      const displayText = streamAssembler.ingestDelta(evt.runId, evt.message, state.showThinking);
      if (!displayText) {
        return;
      }
      chatLog.updateAssistant(displayText, evt.runId);
    }
    if (evt.state === "final") {
      if (isCommandMessage(evt.message)) {
        if (isLocalRunId?.(evt.runId)) {
          forgetLocalRunId?.(evt.runId);
        } else {
          void loadHistory?.();
        }
        const text = extractTextFromMessage(evt.message);
        if (text) {
          chatLog.addSystem(text);
        }
        streamAssembler.drop(evt.runId);
        noteFinalizedRun(evt.runId);
        if (turnLifecycle.complete(evt.runId)) {
          setActivityStatus("idle");
        }
        void refreshSessionInfo?.();
        tui.requestRender();
        return;
      }
      if (isLocalRunId?.(evt.runId)) {
        forgetLocalRunId?.(evt.runId);
      } else {
        void loadHistory?.();
      }
      const stopReason =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? typeof (evt.message as Record<string, unknown>).stopReason === "string"
            ? ((evt.message as Record<string, unknown>).stopReason as string)
            : ""
          : "";

      const finalText = streamAssembler.finalize(evt.runId, evt.message, state.showThinking);
      chatLog.finalizeAssistant(finalText, evt.runId);
      noteFinalizedRun(evt.runId);
      if (stopReason === "error") {
        if (turnLifecycle.fail(evt.runId)) {
          setActivityStatus("error");
        }
      } else if (turnLifecycle.complete(evt.runId)) {
        setActivityStatus("idle");
      }
      // Refresh session info to update token counts in footer
      void refreshSessionInfo?.();
    }
    if (evt.state === "aborted") {
      chatLog.addSystem("run aborted");
      streamAssembler.drop(evt.runId);
      sessionRuns.delete(evt.runId);
      if (turnLifecycle.cancel(evt.runId)) {
        setActivityStatus("aborted");
      }
      void refreshSessionInfo?.();
      if (isLocalRunId?.(evt.runId)) {
        forgetLocalRunId?.(evt.runId);
      } else {
        void loadHistory?.();
      }
    }
    if (evt.state === "error") {
      chatLog.addSystem(`run error: ${evt.errorMessage ?? "unknown"}`);
      streamAssembler.drop(evt.runId);
      sessionRuns.delete(evt.runId);
      if (turnLifecycle.fail(evt.runId)) {
        setActivityStatus("error");
      }
      void refreshSessionInfo?.();
      if (isLocalRunId?.(evt.runId)) {
        forgetLocalRunId?.(evt.runId);
      } else {
        void loadHistory?.();
      }
    }
    tui.requestRender();
  };

  const handleAgentEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as AgentEvent;
    syncSessionKey();
    // Agent events (tool streaming, lifecycle) are emitted per-run. Filter against the
    // active chat run id, not the session id. Tool results can arrive after the chat
    // final event, so accept finalized runs for tool updates.
    const isActiveRun = evt.runId === state.activeChatRunId;
    const isKnownRun = isActiveRun || sessionRuns.has(evt.runId) || finalizedRuns.has(evt.runId);
    if (!isKnownRun) {
      return;
    }
    if (evt.stream === "tool") {
      const verbose = state.sessionInfo.verboseLevel ?? "off";
      const allowToolEvents = verbose !== "off";
      const allowToolOutput = verbose === "full";
      if (!allowToolEvents) {
        return;
      }
      const data = evt.data ?? {};
      const phase = asString(data.phase, "");
      const toolCallId = asString(data.toolCallId, "");
      const toolName = asString(data.name, "tool");
      const startedAt = readOptionalNumber(data.startedAt);
      const completedAt = readOptionalNumber(data.endedAt);
      const elapsedMs = readOptionalNumber(data.elapsedMs);
      const resultStatus = readOptionalString(data.resultStatus);
      const errorSummary = readOptionalString(data.errorSummary);
      if (!toolCallId) {
        return;
      }
      if (phase === "start") {
        if (startedAt !== undefined) {
          chatLog.startTool(toolCallId, toolName, data.args, { startedAt });
        } else {
          chatLog.startTool(toolCallId, toolName, data.args);
        }
      } else if (phase === "update") {
        if (!allowToolOutput) {
          return;
        }
        if (startedAt !== undefined) {
          chatLog.startTool(toolCallId, toolName, data.args, { startedAt });
        } else {
          chatLog.startTool(toolCallId, toolName, data.args);
        }
        chatLog.updateToolResult(toolCallId, data.partialResult, {
          partial: true,
        });
      } else if (phase === "result") {
        if (startedAt !== undefined) {
          chatLog.startTool(toolCallId, toolName, data.args, { startedAt });
        } else {
          chatLog.startTool(toolCallId, toolName, data.args);
        }
        const resultOpts = {
          isError: Boolean(data.isError),
          ...(resultStatus !== undefined ? { status: resultStatus } : {}),
          ...(errorSummary !== undefined ? { errorSummary } : {}),
          ...(startedAt !== undefined ? { startedAt } : {}),
          ...(completedAt !== undefined ? { completedAt } : {}),
          ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        };
        if (allowToolOutput) {
          chatLog.updateToolResult(toolCallId, data.result, resultOpts);
        } else {
          chatLog.updateToolResult(toolCallId, { content: [] }, resultOpts);
        }
      }
      tui.requestRender();
      return;
    }
    if (evt.stream === "lifecycle") {
      if (!isActiveRun) {
        return;
      }
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      if (phase === "start") {
        turnLifecycle.markRunning(evt.runId);
      }
      if (phase === "end") {
        if (turnLifecycle.complete(evt.runId)) {
          setActivityStatus("idle");
        }
      }
      if (phase === "error") {
        if (turnLifecycle.fail(evt.runId)) {
          setActivityStatus("error");
        }
      }
      tui.requestRender();
    }
  };

  return { handleChatEvent, handleAgentEvent };
}
