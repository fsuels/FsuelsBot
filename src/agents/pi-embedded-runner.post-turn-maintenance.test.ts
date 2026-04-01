import type { AssistantMessage } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "./pi-embedded-runner/run/types.js";
import { runEmbeddedPiAgent } from "./pi-embedded-runner.js";

const runEmbeddedAttemptMock =
  vi.fn<(params: EmbeddedRunAttemptParams) => Promise<EmbeddedRunAttemptResult>>();

const maintenanceManager = {
  schedule: vi.fn(),
  drainPendingMaintenance: vi.fn(async () => true),
};

const baseUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const makeConfig = (): OpenClawConfig =>
  ({
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.com",
          models: [
            {
              id: "mock-1",
              name: "Mock 1",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
  }) satisfies OpenClawConfig;

const buildAssistant = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text: "ok" }],
  api: "openai-responses",
  provider: "openai",
  model: "mock-1",
  usage: baseUsage,
  stopReason: "stop",
  timestamp: Date.now(),
  ...overrides,
});

const makeAttempt = (
  overrides: Partial<EmbeddedRunAttemptResult> = {},
): EmbeddedRunAttemptResult => ({
  aborted: false,
  timedOut: false,
  promptError: null,
  sessionIdUsed: "session:test",
  systemPromptReport: undefined,
  messagesSnapshot: [
    {
      role: "user",
      content: [{ type: "text", text: "remember this" }],
      timestamp: Date.now(),
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      timestamp: Date.now(),
    },
  ],
  assistantTexts: ["ok"],
  toolMetas: [],
  lastAssistant: buildAssistant(),
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentTargets: [],
  cloudCodeAssistFormatError: false,
  ...overrides,
});

let agentDir: string;
let workspaceDir: string;

beforeEach(async () => {
  runEmbeddedAttemptMock.mockReset();
  maintenanceManager.schedule.mockReset();
  maintenanceManager.drainPendingMaintenance.mockClear();
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-"));
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-"));
});

afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("runEmbeddedPiAgent post-turn maintenance integration", () => {
  it("schedules maintenance after a completed primary run", async () => {
    runEmbeddedAttemptMock.mockResolvedValueOnce(makeAttempt());

    await runEmbeddedPiAgent(
      {
        sessionId: "session:test",
        sessionKey: "agent:main:test",
        sessionFile: path.join(workspaceDir, "session.jsonl"),
        workspaceDir,
        agentDir,
        config: makeConfig(),
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 5_000,
      },
      {
        runAttempt: (attemptParams) => runEmbeddedAttemptMock(attemptParams),
        postTurnMaintenanceManager: maintenanceManager,
      },
    );

    expect(maintenanceManager.schedule).toHaveBeenCalledTimes(1);
    expect(maintenanceManager.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session:test",
        sessionKey: "agent:main:test",
        workspaceDir,
        provider: "openai",
        model: "mock-1",
      }),
    );
  });

  it("does not schedule maintenance for background runs", async () => {
    runEmbeddedAttemptMock.mockResolvedValueOnce(makeAttempt());

    await runEmbeddedPiAgent(
      {
        sessionId: "session:test",
        sessionKey: "agent:main:test",
        sessionFile: path.join(workspaceDir, "session.jsonl"),
        workspaceDir,
        agentDir,
        config: makeConfig(),
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 5_000,
        runPurpose: "background",
      },
      {
        runAttempt: (attemptParams) => runEmbeddedAttemptMock(attemptParams),
        postTurnMaintenanceManager: maintenanceManager,
      },
    );

    expect(maintenanceManager.schedule).not.toHaveBeenCalled();
  });
});
