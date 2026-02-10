import { describe, expect, it, vi, beforeEach } from "vitest";

import { completeSimple } from "@mariozechner/pi-ai";

import { getApiKeyForModel } from "../model-auth.js";
import { resolveModel } from "../pi-embedded-runner/model.js";
import { createDelegateTool } from "./delegate-tool.js";

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(),
}));

vi.mock("../model-auth.js", () => ({
  getApiKeyForModel: vi.fn(),
  requireApiKey: vi.fn((auth: { apiKey?: string }, _provider: string) => {
    if (!auth.apiKey) throw new Error("No API key");
    return auth.apiKey;
  }),
}));

vi.mock("../pi-embedded-runner/model.js", () => ({
  resolveModel: vi.fn(),
}));

const MOCK_MODEL = {
  id: "claude-sonnet-4-5",
  name: "Claude Sonnet 4.5",
  provider: "anthropic",
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 200000,
  maxTokens: 8192,
};

describe("delegate tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(resolveModel).mockReturnValue({
      model: MOCK_MODEL as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
    });

    vi.mocked(getApiKeyForModel).mockResolvedValue({
      apiKey: "sk-ant-oat01-test-key",
      source: "profile:anthropic:manual",
      mode: "token",
    });

    vi.mocked(completeSimple).mockResolvedValue({
      content: [{ type: "text", text: "The answer is 42." }],
    } as never);
  });

  it("delegates a task and returns the result", async () => {
    const tool = createDelegateTool();
    const result = await tool.execute("call-1", { task: "What is 6 * 7?" }, undefined, undefined);

    expect(result.content[0]).toHaveProperty("type", "text");
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.status).toBe("ok");
    expect(payload.text).toBe("The answer is 42.");
    expect(payload.model).toBe("anthropic/claude-sonnet-4-5");
    expect(payload.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("uses configured default model from config", async () => {
    const tool = createDelegateTool({
      config: {
        agents: {
          defaults: {
            delegate: { model: "opencode/gpt-5.1" },
          },
        },
      } as never,
    });

    await tool.execute("call-2", { task: "hello" }, undefined, undefined);

    expect(resolveModel).toHaveBeenCalledWith("opencode", "gpt-5.1", undefined, expect.anything());
  });

  it("explicit model param overrides config default", async () => {
    const tool = createDelegateTool({
      config: {
        agents: {
          defaults: {
            delegate: { model: "opencode/gpt-5.1" },
          },
        },
      } as never,
    });

    await tool.execute(
      "call-3",
      { task: "hello", model: "anthropic/claude-haiku-3-5" },
      undefined,
      undefined,
    );

    expect(resolveModel).toHaveBeenCalledWith(
      "anthropic",
      "claude-haiku-3-5",
      undefined,
      expect.anything(),
    );
  });

  it("passes systemPrompt to completeSimple", async () => {
    const tool = createDelegateTool();

    await tool.execute(
      "call-4",
      { task: "summarize this", systemPrompt: "You are a summarizer." },
      undefined,
      undefined,
    );

    const callArgs = vi.mocked(completeSimple).mock.calls[0];
    expect(callArgs?.[1]).toHaveProperty("systemPrompt", "You are a summarizer.");
  });

  it("returns error when model is unknown", async () => {
    vi.mocked(resolveModel).mockReturnValue({
      model: undefined,
      error: "Unknown model: fake/model",
      authStorage: {} as never,
      modelRegistry: {} as never,
    });

    const tool = createDelegateTool();
    const result = await tool.execute(
      "call-5",
      { task: "hello", model: "fake/model" },
      undefined,
      undefined,
    );

    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.status).toBe("error");
    expect(payload.error).toContain("Unknown model");
  });

  it("returns error when delegate returns empty content", async () => {
    vi.mocked(completeSimple).mockResolvedValue({
      content: [],
    } as never);

    const tool = createDelegateTool();
    const result = await tool.execute("call-6", { task: "hello" }, undefined, undefined);

    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.status).toBe("error");
    expect(payload.error).toContain("no text content");
  });

  it("returns error on API failure", async () => {
    vi.mocked(completeSimple).mockRejectedValue(new Error("API rate limited"));

    const tool = createDelegateTool();
    const result = await tool.execute("call-7", { task: "hello" }, undefined, undefined);

    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.status).toBe("error");
    expect(payload.error).toBe("API rate limited");
  });

  it("respects maxTokens from config", async () => {
    const tool = createDelegateTool({
      config: {
        agents: {
          defaults: {
            delegate: { maxTokens: 2048 },
          },
        },
      } as never,
    });

    await tool.execute("call-8", { task: "hello" }, undefined, undefined);

    const callArgs = vi.mocked(completeSimple).mock.calls[0];
    expect(callArgs?.[2]).toHaveProperty("maxTokens", 2048);
  });

  it("explicit maxTokens param overrides config", async () => {
    const tool = createDelegateTool({
      config: {
        agents: {
          defaults: {
            delegate: { maxTokens: 2048 },
          },
        },
      } as never,
    });

    await tool.execute("call-9", { task: "hello", maxTokens: 512 }, undefined, undefined);

    const callArgs = vi.mocked(completeSimple).mock.calls[0];
    expect(callArgs?.[2]).toHaveProperty("maxTokens", 512);
  });

  it("defaults to anthropic/claude-sonnet-4-5 when no config", async () => {
    const tool = createDelegateTool();

    await tool.execute("call-10", { task: "hello" }, undefined, undefined);

    expect(resolveModel).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-4-5",
      undefined,
      undefined,
    );
  });

  it("handles model without provider prefix", async () => {
    const tool = createDelegateTool();

    await tool.execute(
      "call-11",
      { task: "hello", model: "claude-haiku-3-5" },
      undefined,
      undefined,
    );

    // Should default provider to "anthropic"
    expect(resolveModel).toHaveBeenCalledWith(
      "anthropic",
      "claude-haiku-3-5",
      undefined,
      undefined,
    );
  });
});
