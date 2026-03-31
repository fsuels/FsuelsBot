import type { AssistantMessage } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "./pi-embedded-runner/run/types.js";
import { runEmbeddedPiAgent } from "./pi-embedded-runner.js";

const baseUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const buildAssistant = (overrides: Partial<AssistantMessage>): AssistantMessage => ({
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

const makeAttempt = (overrides: Partial<EmbeddedRunAttemptResult>): EmbeddedRunAttemptResult => ({
  aborted: false,
  timedOut: false,
  promptError: null,
  sessionIdUsed: "session:test",
  systemPromptReport: undefined,
  messagesSnapshot: [],
  assistantTexts: [],
  toolMetas: [],
  lastAssistant: undefined,
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentTargets: [],
  cloudCodeAssistFormatError: false,
  ...overrides,
});

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

function createDeferredEnqueue() {
  const queued: Array<() => Promise<void>> = [];
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queued.push(() => task().then(resolve, reject));
      });
    },
    queuedCount() {
      return queued.length;
    },
    async flushNext() {
      const next = queued.shift();
      if (!next) {
        throw new Error("No queued task available");
      }
      await next();
    },
  };
}

describe("runEmbeddedPiAgent config snapshot", () => {
  it("freezes queued params and env-derived defaults at run start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-run-config-"));
    const previousOpenClawAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const previousPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDirAtStart = path.join(root, "agent-a");
    const agentDirAfterMutation = path.join(root, "agent-b");
    const originalWorkspace = path.join(root, "workspace-a");
    const mutatedWorkspace = path.join(root, "workspace-b");
    try {
      await fs.mkdir(agentDirAtStart, { recursive: true });
      await fs.mkdir(agentDirAfterMutation, { recursive: true });
      await fs.mkdir(originalWorkspace, { recursive: true });
      await fs.mkdir(mutatedWorkspace, { recursive: true });

      process.env.OPENCLAW_AGENT_DIR = agentDirAtStart;
      delete process.env.PI_CODING_AGENT_DIR;

      const queue = createDeferredEnqueue();
      let seenAttemptParams: EmbeddedRunAttemptParams | undefined;

      const runParams: Parameters<typeof runEmbeddedPiAgent>[0] = {
        sessionId: "session:test",
        sessionKey: "agent:test:snapshot",
        sessionFile: path.join(root, "session.jsonl"),
        workspaceDir: originalWorkspace,
        config: makeConfig(),
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        toolResultFormat: "markdown",
        timeoutMs: 5_000,
        runId: "run:snapshot",
        enqueue: queue.enqueue,
      };

      const runPromise = runEmbeddedPiAgent(runParams, {
        runAttempt: async (attemptParams) => {
          seenAttemptParams = attemptParams;
          return makeAttempt({
            assistantTexts: ["ok"],
            lastAssistant: buildAssistant({
              stopReason: "stop",
            }),
          });
        },
      });

      expect(queue.queuedCount()).toBe(1);

      runParams.provider = "broken-provider";
      runParams.model = "broken-model";
      runParams.prompt = "mutated prompt";
      runParams.workspaceDir = mutatedWorkspace;
      runParams.toolResultFormat = "plain";
      process.env.OPENCLAW_AGENT_DIR = agentDirAfterMutation;

      await queue.flushNext();
      expect(queue.queuedCount()).toBe(1);
      await queue.flushNext();

      const result = await runPromise;
      expect(result.payloads?.[0]?.text).toBe("ok");
      expect(seenAttemptParams?.provider).toBe("openai");
      expect(seenAttemptParams?.modelId).toBe("mock-1");
      expect(seenAttemptParams?.prompt).toBe("hello");
      expect(seenAttemptParams?.workspaceDir).toBe(originalWorkspace);
      expect(seenAttemptParams?.agentDir).toBe(agentDirAtStart);
      expect(seenAttemptParams?.toolResultFormat).toBe("markdown");
    } finally {
      if (previousOpenClawAgentDir === undefined) {
        delete process.env.OPENCLAW_AGENT_DIR;
      } else {
        process.env.OPENCLAW_AGENT_DIR = previousOpenClawAgentDir;
      }
      if (previousPiCodingAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiCodingAgentDir;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
