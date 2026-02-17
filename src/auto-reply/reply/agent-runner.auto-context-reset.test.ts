import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({
    provider,
    model,
    run,
  }: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => ({
    result: await run(provider, model),
    provider,
    model,
  }),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(),
    scheduleFollowupDrain: vi.fn(),
  };
});

import { runReplyAgent } from "./agent-runner.js";

function createMinimalRun(params: {
  sessionStore: Record<string, SessionEntry>;
  sessionEntry: SessionEntry;
  sessionKey: string;
  storePath: string;
}) {
  const typing = createMockTypingController();
  const sessionCtx = {
    Provider: "whatsapp",
    MessageSid: "msg",
  } as unknown as TemplateContext;
  const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      sessionId: params.sessionEntry.sessionId,
      sessionKey: params.sessionKey,
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as unknown as FollowupRun;

  return runReplyAgent({
    commandBody: "hello",
    followupRun,
    queueKey: "main",
    resolvedQueue,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    typing,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    sessionCtx,
    defaultModel: "anthropic/claude-opus-4-5",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  });
}

describe("runReplyAgent auto context reset", () => {
  beforeEach(() => {
    runEmbeddedPiAgentMock.mockReset();
    delete process.env.OPENCLAW_CONTEXT_PRESSURE_AUTO_RESET;
    delete process.env.OPENCLAW_CONTEXT_PRESSURE_RESET_THRESHOLD;
  });

  it("resets session before run when context pressure is high", async () => {
    const stateDir = await fs.mkdtemp(path.join(tmpdir(), "openclaw-autoreset-"));
    try {
      const storePath = path.join(stateDir, "sessions", "sessions.json");
      const sessionEntry: SessionEntry = {
        sessionId: "session-old",
        updatedAt: Date.now(),
        totalTokens: 920,
        contextTokens: 1000,
      };
      const sessionStore = { main: { ...sessionEntry } };
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, JSON.stringify(sessionStore), "utf-8");

      runEmbeddedPiAgentMock.mockImplementationOnce(async () => ({
        payloads: [{ text: "done" }],
        meta: { agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
      }));

      const result = await createMinimalRun({
        sessionEntry,
        sessionStore,
        sessionKey: "main",
        storePath,
      });
      const payload = Array.isArray(result) ? result[0] : result;
      expect(payload?.text).toContain("done");
      expect(sessionStore.main?.sessionId).not.toBe("session-old");

      const runArgs = runEmbeddedPiAgentMock.mock.calls[0]?.[0] as
        | { sessionId?: string }
        | undefined;
      expect(runArgs?.sessionId).toBe(sessionStore.main?.sessionId);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps session when pressure is below threshold", async () => {
    const stateDir = await fs.mkdtemp(path.join(tmpdir(), "openclaw-autoreset-"));
    try {
      const storePath = path.join(stateDir, "sessions", "sessions.json");
      const sessionEntry: SessionEntry = {
        sessionId: "session-old",
        updatedAt: Date.now(),
        totalTokens: 300,
        contextTokens: 1000,
      };
      const sessionStore = { main: { ...sessionEntry } };
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, JSON.stringify(sessionStore), "utf-8");

      runEmbeddedPiAgentMock.mockImplementationOnce(async () => ({
        payloads: [{ text: "done" }],
        meta: { agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
      }));

      await createMinimalRun({
        sessionEntry,
        sessionStore,
        sessionKey: "main",
        storePath,
      });
      expect(sessionStore.main?.sessionId).toBe("session-old");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
