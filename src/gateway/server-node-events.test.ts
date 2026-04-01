import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSessionEntry: vi.fn(),
  updateSessionStore: vi.fn(),
  agentCommand: vi.fn(),
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: vi.fn(),
}));
vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: vi.fn(),
}));
vi.mock("../commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));
vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));
vi.mock("../config/sessions.js", async () => {
  const actual =
    await vi.importActual<typeof import("../config/sessions.js")>("../config/sessions.js");
  return {
    ...actual,
    updateSessionStore: mocks.updateSessionStore,
  };
});
vi.mock("./session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
}));

import type { CliDeps } from "../cli/deps.js";
import type { HealthSummary } from "../commands/health.js";
import type { NodeEventContext } from "./server-node-events-types.js";
import { agentCommand } from "../commands/agent.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { handleNodeEvent } from "./server-node-events.js";

const agentCommandMock = vi.mocked(agentCommand);
const enqueueSystemEventMock = vi.mocked(enqueueSystemEvent);
const requestHeartbeatNowMock = vi.mocked(requestHeartbeatNow);

function buildCtx(): NodeEventContext {
  return {
    deps: {} as CliDeps,
    broadcast: () => {},
    nodeSendToSession: () => {},
    nodeSubscribe: () => {},
    nodeUnsubscribe: () => {},
    broadcastVoiceWakeChanged: () => {},
    addChatRun: () => {},
    removeChatRun: () => undefined,
    chatAbortControllers: new Map(),
    chatAbortedRuns: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    dedupe: new Map(),
    agentRunSeq: new Map(),
    getHealthCache: () => null,
    refreshHealthSnapshot: async () => ({}) as HealthSummary,
    loadGatewayModelCatalog: async () => [],
    logGateway: { warn: () => {} },
  };
}

describe("node exec events", () => {
  beforeEach(() => {
    mocks.loadSessionEntry.mockReset();
    mocks.updateSessionStore.mockReset();
    mocks.loadConfig.mockReset();
    mocks.loadConfig.mockReturnValue({});
    agentCommandMock.mockReset();
    enqueueSystemEventMock.mockReset();
    requestHeartbeatNowMock.mockReset();
  });

  it("enqueues exec.started events", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-1", {
      event: "exec.started",
      payloadJSON: JSON.stringify({
        sessionKey: "agent:main:main",
        runId: "run-1",
        command: "ls -la",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec started (node=node-1 id=run-1): ls -la",
      { sessionKey: "agent:main:main", contextKey: "exec:run-1" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("enqueues exec.finished events with output", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-2", {
      event: "exec.finished",
      payloadJSON: JSON.stringify({
        runId: "run-2",
        exitCode: 0,
        timedOut: false,
        output: "done",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec finished (node=node-2 id=run-2, code 0)\ndone",
      { sessionKey: "node-node-2", contextKey: "exec:run-2" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("enqueues exec.denied events with reason", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-3", {
      event: "exec.denied",
      payloadJSON: JSON.stringify({
        sessionKey: "agent:demo:main",
        runId: "run-3",
        command: "rm -rf /",
        reason: "allowlist-miss",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec denied (node=node-3 id=run-3, allowlist-miss): rm -rf /",
      { sessionKey: "agent:demo:main", contextKey: "exec:run-3" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("persists external origin metadata for agent.request events", async () => {
    const ctx = buildCtx();
    mocks.loadSessionEntry.mockReturnValue({
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: 1,
      },
      canonicalKey: "agent:main:main",
    });
    let capturedEntry: Record<string, unknown> | undefined;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store: Record<string, unknown> = {};
      await updater(store);
      capturedEntry = store["agent:main:main"] as Record<string, unknown>;
    });
    agentCommandMock.mockResolvedValue(undefined);

    await handleNodeEvent(ctx, "node-4", {
      event: "agent.request",
      payloadJSON: JSON.stringify({
        message: "hello from link",
        sessionKey: "agent:main:main",
        origin: {
          source: "browser-link",
          rawUri: "openclaw://agent?message=hello%20from%20link",
          receivedAt: 1234,
          payloadLength: 15,
          trustLevel: "external",
        },
      }),
    });

    expect(capturedEntry?.externalOrigin).toEqual({
      source: "browser-link",
      rawUri: "openclaw://agent?message=hello%20from%20link",
      receivedAt: 1234,
      payloadLength: 15,
      trustLevel: "external",
    });
    expect(agentCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "hello from link",
        sessionKey: "agent:main:main",
      }),
      expect.anything(),
      ctx.deps,
    );
  });
});
