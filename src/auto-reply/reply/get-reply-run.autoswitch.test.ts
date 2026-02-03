import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_TURN_CONTROL_EVENT_VERSION,
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "../../infra/diagnostic-events.js";

const mockRunReplyAgent = vi.fn(async () => ({ text: "ok" }));
const mockInferTaskHintFromMessage = vi.fn();
const mockCommitMemoryEvents = vi.fn(async () => ({ committed: [] }));

vi.mock("./agent-runner.js", () => ({
  runReplyAgent: (...args: unknown[]) => mockRunReplyAgent(...args),
}));

vi.mock("./task-hints.js", () => ({
  inferTaskHintFromMessage: (...args: unknown[]) => mockInferTaskHintFromMessage(...args),
}));

vi.mock("../../memory/task-memory-system.js", () => ({
  commitMemoryEvents: (...args: unknown[]) => mockCommitMemoryEvents(...args),
}));

vi.mock("./body.js", () => ({
  applySessionHints: async ({ baseBody }: { baseBody: string }) => baseBody,
}));

vi.mock("./session-updates.js", () => ({
  ensureSkillSnapshot: async ({ sessionEntry }: { sessionEntry: unknown }) => ({
    sessionEntry,
    systemSent: true,
    skillsSnapshot: undefined,
  }),
  prependSystemEvents: async ({ prefixedBodyBase }: { prefixedBodyBase: string }) =>
    prefixedBodyBase,
}));

vi.mock("./groups.js", () => ({
  buildGroupIntro: () => "",
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: () => ({ mode: "none" }),
}));

vi.mock("./typing-mode.js", () => ({
  resolveTypingMode: () => "normal",
}));

vi.mock("./route-reply.js", () => ({
  routeReply: async () => undefined,
}));

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: async () => undefined,
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: () => false,
  isEmbeddedPiRunActive: () => false,
  isEmbeddedPiRunStreaming: () => false,
  resolveEmbeddedSessionLane: () => "lane:test",
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: () => 0,
  getQueueSize: () => 0,
}));

vi.mock("../../memory/pins.js", () => ({
  listConstraintPinsForInjection: async () => [],
}));

vi.mock("./task-memory-guidance.js", () => ({
  resolveMemoryGuidanceState: () => ({
    mode: "minimal",
    promptCount: 0,
    explicitCount: 0,
    ignoredCount: 0,
  }),
  detectMemoryGuidanceUserSignal: () => "none",
  selectTaskMemoryNudge: () => null,
  applyMemoryGuidanceTurn: () => ({
    changed: false,
    next: {
      mode: "minimal",
      promptCount: 0,
      explicitCount: 0,
      ignoredCount: 0,
    },
  }),
}));

vi.mock("../../sessions/task-context.js", () => ({
  DEFAULT_SESSION_TASK_ID: "default",
  resolveSessionTaskView: ({ entry }: { entry?: { activeTaskId?: string } }) => ({
    taskId: entry?.activeTaskId ?? "default",
    title: entry?.activeTaskId ?? "default",
    compactionCount: 0,
    totalTokens: 0,
  }),
  applySessionTaskUpdate: (entry: Record<string, unknown>, update: { taskId: string }) => ({
    ...entry,
    activeTaskId: update.taskId,
  }),
}));

import { runPreparedReply } from "./get-reply-run.js";

describe("get-reply-run autoswitch gating", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
    mockRunReplyAgent.mockReset();
    mockRunReplyAgent.mockResolvedValue({ text: "ok" });
    mockInferTaskHintFromMessage.mockReset();
    mockCommitMemoryEvents.mockReset();
  });

  it("does not mutate activeTaskId when autoswitch is off even with high-confidence inferred task", async () => {
    mockInferTaskHintFromMessage.mockReturnValue({
      taskId: "task-b",
      score: 0.99,
      confidence: "high",
      ambiguousTaskIds: [],
    });

    const sessionKey = "agent:main:main";
    const sessionStore: Record<string, any> = {
      [sessionKey]: {
        sessionId: "session-a",
        activeTaskId: "task-a",
        autoSwitchOptIn: false,
        taskStateById: {
          "task-a": { title: "Task A" },
          "task-b": { title: "Task B" },
        },
      },
    };

    const result = await runPreparedReply({
      ctx: {
        Body: "continue API work",
        RawBody: "continue API work",
        WasMentioned: false,
      } as any,
      sessionCtx: {
        Body: "continue API work",
        BodyStripped: "continue API work",
        ChatType: "private",
        Provider: "telegram",
      } as any,
      cfg: {} as any,
      agentId: "main",
      agentDir: ".",
      agentCfg: {} as any,
      sessionCfg: {} as any,
      commandAuthorized: true,
      command: {
        isAuthorizedSender: true,
        abortKey: "abort:key",
        ownerList: [],
      } as any,
      commandSource: "text",
      allowTextCommands: true,
      directives: {
        hasThinkDirective: false,
      } as any,
      defaultActivation: "mention" as any,
      resolvedThinkLevel: undefined,
      resolvedVerboseLevel: "off",
      resolvedReasoningLevel: "off" as any,
      resolvedElevatedLevel: "off",
      elevatedEnabled: false,
      elevatedAllowed: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      modelState: {
        resolveDefaultThinkingLevel: async () => undefined,
      } as any,
      provider: "openai",
      model: "gpt-5",
      typing: {
        cleanup: () => undefined,
        onReplyStart: async () => undefined,
      } as any,
      opts: {},
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      timeoutMs: 10_000,
      isNewSession: false,
      resetTriggered: false,
      systemSent: true,
      sessionEntry: sessionStore[sessionKey],
      sessionStore,
      sessionKey,
      sessionId: "session-a",
      workspaceDir: ".",
      abortedLastRun: false,
    });

    expect(result).toEqual({ text: "ok" });
    expect(sessionStore[sessionKey]?.activeTaskId).toBe("task-a");
    expect(mockCommitMemoryEvents).not.toHaveBeenCalled();
    expect(mockRunReplyAgent).toHaveBeenCalledTimes(1);
    const runArg = mockRunReplyAgent.mock.calls[0]?.[0] as
      | { followupRun?: { run?: { taskId?: string; extraSystemPrompt?: string } } }
      | undefined;
    expect(runArg?.followupRun?.run?.taskId).toBe("task-a");
    expect(runArg?.followupRun?.run?.extraSystemPrompt).toContain(
      'Potential task switch detected to "task-b". Do not switch automatically.',
    );
  });

  it("blocks autoswitch when thrash/mismatch counters are above guard thresholds", async () => {
    mockInferTaskHintFromMessage.mockReturnValue({
      taskId: "task-b",
      score: 0.99,
      confidence: "high",
      ambiguousTaskIds: [],
    });

    const sessionKey = "agent:main:main";
    const sessionStore: Record<string, any> = {
      [sessionKey]: {
        sessionId: "session-a",
        activeTaskId: "task-a",
        autoSwitchOptIn: true,
        taskMismatchCounter: 4,
        taskSwitchThrashCounter: 4,
        lastTaskSwitchAt: Date.now(),
        taskStateById: {
          "task-a": { title: "Task A" },
          "task-b": { title: "Task B" },
        },
      },
    };

    await runPreparedReply({
      ctx: {
        Body: "continue API work",
        RawBody: "continue API work",
        WasMentioned: false,
      } as any,
      sessionCtx: {
        Body: "continue API work",
        BodyStripped: "continue API work",
        ChatType: "private",
        Provider: "telegram",
      } as any,
      cfg: {} as any,
      agentId: "main",
      agentDir: ".",
      agentCfg: {} as any,
      sessionCfg: {} as any,
      commandAuthorized: true,
      command: {
        isAuthorizedSender: true,
        abortKey: "abort:key",
        ownerList: [],
      } as any,
      commandSource: "text",
      allowTextCommands: true,
      directives: {
        hasThinkDirective: false,
      } as any,
      defaultActivation: "mention" as any,
      resolvedThinkLevel: undefined,
      resolvedVerboseLevel: "off",
      resolvedReasoningLevel: "off" as any,
      resolvedElevatedLevel: "off",
      elevatedEnabled: false,
      elevatedAllowed: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      modelState: {
        resolveDefaultThinkingLevel: async () => undefined,
      } as any,
      provider: "openai",
      model: "gpt-5",
      typing: {
        cleanup: () => undefined,
        onReplyStart: async () => undefined,
      } as any,
      opts: {},
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      timeoutMs: 10_000,
      isNewSession: false,
      resetTriggered: false,
      systemSent: true,
      sessionEntry: sessionStore[sessionKey],
      sessionStore,
      sessionKey,
      sessionId: "session-a",
      workspaceDir: ".",
      abortedLastRun: false,
    });

    expect(sessionStore[sessionKey]?.activeTaskId).toBe("task-a");
    expect(mockCommitMemoryEvents).not.toHaveBeenCalled();
    const runArg = mockRunReplyAgent.mock.calls.at(-1)?.[0] as
      | { followupRun?: { run?: { extraSystemPrompt?: string } } }
      | undefined;
    expect(runArg?.followupRun?.run?.extraSystemPrompt).toContain(
      "gated due to recent mismatch/thrash",
    );
  });

  it("emits memory.turn-control diagnostics payload contract at reply boundary", async () => {
    mockInferTaskHintFromMessage.mockReturnValue({
      taskId: "task-b",
      score: 0.99,
      confidence: "high",
      ambiguousTaskIds: [],
    });

    const sessionKey = "agent:main:main";
    const sessionStore: Record<string, any> = {
      [sessionKey]: {
        sessionId: "session-a",
        activeTaskId: "task-a",
        autoSwitchOptIn: false,
        taskStateById: {
          "task-a": { title: "Task A" },
          "task-b": { title: "Task B" },
        },
      },
    };
    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = onDiagnosticEvent((event) => {
      events.push(event as unknown as Record<string, unknown>);
    });

    try {
      await runPreparedReply({
        ctx: {
          Body: "continue API work",
          RawBody: "continue API work",
          WasMentioned: false,
        } as any,
        sessionCtx: {
          Body: "continue API work",
          BodyStripped: "continue API work",
          ChatType: "private",
          Provider: "telegram",
        } as any,
        cfg: { diagnostics: { enabled: true } } as any,
        agentId: "main",
        agentDir: ".",
        agentCfg: {} as any,
        sessionCfg: {} as any,
        commandAuthorized: true,
        command: {
          isAuthorizedSender: true,
          abortKey: "abort:key",
          ownerList: [],
        } as any,
        commandSource: "text",
        allowTextCommands: true,
        directives: {
          hasThinkDirective: false,
        } as any,
        defaultActivation: "mention" as any,
        resolvedThinkLevel: undefined,
        resolvedVerboseLevel: "off",
        resolvedReasoningLevel: "off" as any,
        resolvedElevatedLevel: "off",
        elevatedEnabled: false,
        elevatedAllowed: false,
        blockStreamingEnabled: false,
        resolvedBlockStreamingBreak: "message_end",
        modelState: {
          resolveDefaultThinkingLevel: async () => undefined,
        } as any,
        provider: "openai",
        model: "gpt-5",
        typing: {
          cleanup: () => undefined,
          onReplyStart: async () => undefined,
        } as any,
        opts: {},
        defaultProvider: "openai",
        defaultModel: "gpt-5",
        timeoutMs: 10_000,
        isNewSession: false,
        resetTriggered: false,
        systemSent: true,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
        sessionKey,
        sessionId: "session-a",
        workspaceDir: ".",
        abortedLastRun: false,
      });
    } finally {
      unsubscribe();
    }

    const turnControl = events.find((event) => event.type === "memory.turn-control");
    expect(turnControl).toBeDefined();
    expect(turnControl).toEqual(
      expect.objectContaining({
        type: "memory.turn-control",
        eventVersion: MEMORY_TURN_CONTROL_EVENT_VERSION,
        sessionKey,
        sessionId: "session-a",
        activeTaskId: "task-a",
        inferredTaskId: "task-b",
        resolvedTaskId: "task-a",
        autoSwitchOptIn: false,
        autoSwitched: false,
        ambiguous: false,
        decisionMode: "ask",
      }),
    );
    expect(typeof turnControl?.seq).toBe("number");
    expect(typeof turnControl?.ts).toBe("number");
  });
});
