import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { setCompactionSafeguardRuntime } from "../pi-extensions/compaction-safeguard-runtime.js";
import { setContextPruningRuntime } from "../pi-extensions/context-pruning/runtime.js";
import { DEFAULT_CONTEXT_PRUNING_SETTINGS } from "../pi-extensions/context-pruning/settings.js";
import {
  createEmbeddedRuntimeState,
  getEmbeddedRuntimeState,
  wrapStreamFnWithRuntimeState,
} from "./runtime-state.js";

describe("embedded runtime state", () => {
  it("keeps session ids and storage paths in sync", () => {
    const state = createEmbeddedRuntimeState({
      sessionId: "session-a",
      sessionFile: "/tmp/openclaw/session-a.jsonl",
    });

    expect(state.getPathsSnapshot().sessionStorageDir).toBe("/tmp/openclaw");

    state.switchSession({
      sessionId: "session-b",
      sessionFile: "/tmp/openclaw/sub/session-b.jsonl",
    });

    expect(state.getSessionSnapshot().sessionId).toBe("session-b");
    expect(state.getPathsSnapshot().sessionStorageDir).toBe("/tmp/openclaw/sub");

    const regenerated = state.regenerateSessionId({ setCurrentAsParent: true });
    expect(regenerated.parentSessionId).toBe("session-b");
    expect(regenerated.sessionId).not.toBe("session-b");
  });

  it("stores immutable request snapshots and bounds debug buffers", () => {
    const state = createEmbeddedRuntimeState({
      sessionId: "session-debug",
      sessionKey: "main",
    });

    const messages: AgentMessage[] = [{ role: "user", content: "hello" } as AgentMessage];
    state.recordFinalRequest({
      requestId: "run-1",
      system: "system prompt",
      messages,
    });
    messages[0] = { role: "user", content: "mutated" } as AgentMessage;

    const snapshot = state.getLastRequestSnapshot();
    expect(snapshot?.messages[0]).toMatchObject({ content: "hello" });
    expect(state.getSessionSnapshot().lastMainRequestId).toBe("run-1");
    expect(state.getSessionSnapshot().currentPromptId).toBe(snapshot?.promptId);

    for (let index = 0; index < 25; index += 1) {
      state.recordError({
        phase: `phase-${index}`,
        message: `error-${index}`,
      });
      state.recordSlowOperation({
        label: `op-${index}`,
        durationMs: index * 100,
      });
    }

    const debug = state.getDebugSnapshot();
    expect(debug.errorLog).toHaveLength(20);
    expect(debug.errorLog[0]).toMatchObject({ phase: "phase-5" });
    expect(debug.slowOperations).toHaveLength(20);
    expect(debug.slowOperations[0]).toMatchObject({ label: "op-5" });
  });

  it("marks and consumes post-compaction request state when wrapping streamFns", () => {
    const state = createEmbeddedRuntimeState({
      sessionId: "session-post-compaction",
      sessionKey: "main",
    });
    const streamFn = vi.fn<StreamFn>().mockReturnValue(Promise.resolve(undefined));
    const wrapped = wrapStreamFnWithRuntimeState({
      streamFn,
      runtimeState: state,
      requestId: "run-42",
    });

    state.markPostCompaction();
    wrapped(
      { id: "claude", provider: "anthropic", api: "anthropic-messages" } as never,
      {
        system: "sys",
        messages: [{ role: "user", content: "hello" }],
      } as never,
      { maxTokens: 64 } as never,
    );

    const snapshot = state.getLastRequestSnapshot();
    expect(snapshot?.wasPostCompaction).toBe(true);
    expect(snapshot?.requestId).toBe("run-42");
    expect(state.consumePostCompaction()).toBe(false);
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("shares one registry-backed runtime across extension adapters", () => {
    const sessionManager = {};
    setContextPruningRuntime(sessionManager, {
      settings: DEFAULT_CONTEXT_PRUNING_SETTINGS,
      contextWindowTokens: 200_000,
      isToolPrunable: () => true,
      lastCacheTouchAt: 123,
    });
    setCompactionSafeguardRuntime(sessionManager, {
      maxHistoryShare: 0.4,
      contextWindowTokens: 200_000,
    });

    const runtimeState = getEmbeddedRuntimeState(sessionManager);
    expect(runtimeState).not.toBeNull();
    expect(runtimeState?.getPromptCacheSnapshot().lastCacheTouchAt).toBe(123);
    expect(runtimeState?.getExtensionRuntime("contextPruning")).toMatchObject({
      contextWindowTokens: 200_000,
    });
    expect(runtimeState?.getExtensionRuntime("compactionSafeguard")).toMatchObject({
      maxHistoryShare: 0.4,
    });
  });
});
