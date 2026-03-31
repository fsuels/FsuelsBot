import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
  loadSessionStore: vi.fn(),
  resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => mocks.callGateway(opts),
}));

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    loadSessionStore: (...args: unknown[]) => mocks.loadSessionStore(...args),
    resolveStorePath: (...args: unknown[]) => mocks.resolveStorePath(...args),
  };
});

import {
  reserveSubagentSessionSettings,
  resolveSubagentLaunchConfig,
} from "./subagent-launch-config.js";

describe("subagent launch config", () => {
  beforeEach(() => {
    mocks.callGateway.mockReset();
    mocks.loadSessionStore.mockReset();
    mocks.resolveStorePath.mockClear();
    mocks.resolveStorePath.mockReturnValue("/tmp/sessions.json");
    mocks.loadSessionStore.mockReturnValue({});
  });

  it("inherits the requester session model when subagent model is otherwise unset", () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:main:main": {
        sessionId: "session-main",
        updatedAt: 1000,
        providerOverride: "openai",
        modelOverride: "gpt-5.2",
      },
    });

    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-5" },
        },
      },
    };

    const result = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-1",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        resolvedModel: "openai/gpt-5.2",
        resolvedModelSource: "parent-session",
      },
    });
  });

  it("supports explicit model=inherit even when subagent model defaults exist", () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:main:main": {
        sessionId: "session-main",
        updatedAt: 1000,
        providerOverride: "openai",
        modelOverride: "gpt-5.2",
      },
    });

    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-5" },
          subagents: {
            model: "minimax/MiniMax-M2.1",
          },
        },
        list: [
          {
            id: "research",
            subagents: {
              model: "opencode/claude",
            },
          },
        ],
      },
    };

    const result = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-2",
      requestedModel: "inherit",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        resolvedModel: "openai/gpt-5.2",
        resolvedModelSource: "parent-session",
      },
    });
  });

  it("supports explicit thinking=inherit without forcing thinking by default", () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:main:main": {
        sessionId: "session-main",
        updatedAt: 1000,
      },
    });

    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-5" },
          thinkingDefault: "high",
        },
      },
    };

    const inherited = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-3",
      requestedThinking: "inherit",
    });
    expect(inherited).toMatchObject({
      ok: true,
      value: {
        resolvedThinking: "high",
        resolvedThinkingSource: "parent-session",
      },
    });

    const unset = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-4",
    });
    expect(unset).toMatchObject({
      ok: true,
      value: {
        resolvedThinking: undefined,
        resolvedThinkingSource: undefined,
      },
    });
  });

  it("builds deterministic child ids from the tool call context", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-5" },
        },
      },
    };

    const first = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-5",
    });
    const second = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-5",
    });
    const third = resolveSubagentLaunchConfig({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "research",
      task: "inspect the repo",
      toolCallId: "call-6",
    });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(third).toMatchObject({ ok: true });
    if (!first.ok || !second.ok || !third.ok) {
      throw new Error("launch config unexpectedly failed");
    }

    expect(first.value.childSessionKey).toBe(second.value.childSessionKey);
    expect(first.value.childIdempotencyKey).toBe(second.value.childIdempotencyKey);
    expect(first.value.childSessionKey).not.toBe(third.value.childSessionKey);
    expect(first.value.childIdempotencyKey).not.toBe(third.value.childIdempotencyKey);
  });

  it("retries label collisions without losing the rest of the session reservation", async () => {
    mocks.callGateway
      .mockRejectedValueOnce(new Error("invalid model: bad-model"))
      .mockRejectedValueOnce(new Error("label already in use: worker"))
      .mockResolvedValueOnce({ ok: true });

    const result = await reserveSubagentSessionSettings({
      childSessionKey: "agent:main:subagent:worker",
      label: "worker",
      resolvedModel: "bad-model",
      resolvedThinking: "high",
    });

    expect(result).toEqual({
      appliedLabel: "worker 2",
      modelApplied: false,
      modelWarning: "invalid model: bad-model",
    });

    const calls = mocks.callGateway.mock.calls.map(
      ([value]) => value as { method?: string; params?: Record<string, unknown> },
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      method: "sessions.patch",
      params: {
        key: "agent:main:subagent:worker",
        model: "bad-model",
        thinkingLevel: "high",
        label: "worker",
      },
    });
    expect(calls[1]).toMatchObject({
      method: "sessions.patch",
      params: {
        key: "agent:main:subagent:worker",
        thinkingLevel: "high",
        label: "worker",
      },
    });
    expect(calls[2]).toMatchObject({
      method: "sessions.patch",
      params: {
        key: "agent:main:subagent:worker",
        thinkingLevel: "high",
        label: "worker 2",
      },
    });
  });
});
