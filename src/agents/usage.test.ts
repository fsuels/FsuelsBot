import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  deriveSessionTotalTokens,
  finalContextTokensFromLastResponse,
  getTokenCountFromUsage,
  hasNonzeroUsage,
  messageOutputTokensFromLastResponse,
  normalizeUsage,
  tokenCountWithEstimation,
} from "./usage.js";

describe("normalizeUsage", () => {
  it("normalizes Anthropic-style snake_case usage", () => {
    const usage = normalizeUsage({
      input_tokens: 1200,
      output_tokens: 340,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 50,
      total_tokens: 1790,
    });
    expect(usage).toEqual({
      input: 1200,
      output: 340,
      cacheRead: 50,
      cacheWrite: 200,
      total: 1790,
    });
  });

  it("normalizes OpenAI-style prompt/completion usage", () => {
    const usage = normalizeUsage({
      prompt_tokens: 987,
      completion_tokens: 123,
      total_tokens: 1110,
    });
    expect(usage).toEqual({
      input: 987,
      output: 123,
      cacheRead: undefined,
      cacheWrite: undefined,
      total: 1110,
    });
  });

  it("returns undefined for empty usage objects", () => {
    expect(normalizeUsage({})).toBeUndefined();
  });

  it("guards against empty/zero usage overwrites", () => {
    expect(hasNonzeroUsage(undefined)).toBe(false);
    expect(hasNonzeroUsage(null)).toBe(false);
    expect(hasNonzeroUsage({})).toBe(false);
    expect(hasNonzeroUsage({ input: 0, output: 0 })).toBe(false);
    expect(hasNonzeroUsage({ input: 1 })).toBe(true);
    expect(hasNonzeroUsage({ total: 1 })).toBe(true);
  });

  it("caps derived session total tokens to the context window", () => {
    expect(
      deriveSessionTotalTokens({
        usage: {
          input: 27,
          cacheRead: 2_400_000,
          cacheWrite: 0,
          total: 2_402_300,
        },
        contextTokens: 200_000,
      }),
    ).toBe(200_000);
  });

  it("uses prompt tokens when within context window", () => {
    expect(
      deriveSessionTotalTokens({
        usage: {
          input: 1_200,
          cacheRead: 300,
          cacheWrite: 50,
          total: 2_000,
        },
        contextTokens: 200_000,
      }),
    ).toBe(1_550);
  });

  it("derives total token count from normalized usage", () => {
    expect(
      getTokenCountFromUsage({
        input: 120,
        output: 30,
        cacheRead: 10,
        cacheWrite: 5,
      }),
    ).toBe(165);
  });

  it("anchors token estimation to the latest assistant response with real usage", () => {
    const messages = [
      {
        role: "user",
        content: "Search for release notes",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: {} }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-test",
        usage: {
          input: 200,
          output: 40,
          cacheRead: 25,
          cacheWrite: 0,
          totalTokens: 265,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "search",
        content: [{ type: "text", text: "release notes" }],
        isError: false,
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "streamed sibling without usage" }],
        timestamp: 4,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "tool-2",
        toolName: "fetch",
        content: [{ type: "text", text: "extra result" }],
        isError: false,
        timestamp: 5,
      },
    ] satisfies AgentMessage[];

    const expected =
      265 + estimateTokens(messages[2]) + estimateTokens(messages[3]) + estimateTokens(messages[4]);

    expect(tokenCountWithEstimation(messages)).toBe(expected);
    expect(finalContextTokensFromLastResponse(messages)).toBe(265);
    expect(messageOutputTokensFromLastResponse(messages)).toBe(40);
  });

  it("falls back to whole-history estimation when no response usage exists", () => {
    const messages = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 } as AgentMessage,
    ] satisfies AgentMessage[];

    expect(tokenCountWithEstimation(messages)).toBe(
      messages.reduce((sum, message) => sum + estimateTokens(message), 0),
    );
    expect(finalContextTokensFromLastResponse(messages)).toBeUndefined();
    expect(messageOutputTokensFromLastResponse(messages)).toBeUndefined();
  });
});
