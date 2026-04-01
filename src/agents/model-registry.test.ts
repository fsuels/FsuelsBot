import { describe, expect, it } from "vitest";
import {
  getDefaultModelAliases,
  normalizeKnownModelId,
  normalizeKnownProviderId,
  resolveKnownModelFamily,
} from "./model-registry.js";

describe("model-registry", () => {
  it("normalizes known provider aliases", () => {
    expect(normalizeKnownProviderId("Anthropic")).toBe("anthropic");
    expect(normalizeKnownProviderId("Z.AI")).toBe("zai");
    expect(normalizeKnownProviderId("z-ai")).toBe("zai");
    expect(normalizeKnownProviderId("OpenCode-Zen")).toBe("opencode");
    expect(normalizeKnownProviderId("qwen")).toBe("qwen-portal");
    expect(normalizeKnownProviderId("kimi-code")).toBe("kimi-coding");
  });

  it("normalizes known provider-specific model aliases", () => {
    expect(normalizeKnownModelId("anthropic", "opus-4.6")).toBe("claude-opus-4-6");
    expect(normalizeKnownModelId("google", "gemini-3-pro")).toBe("gemini-3-pro-preview");
  });

  it("exposes built-in default model aliases", () => {
    expect(getDefaultModelAliases().opus).toBe("anthropic/claude-opus-4-6");
    expect(getDefaultModelAliases()["gpt-mini"]).toBe("openai/gpt-5-mini");
  });

  it("derives known families across provider wrappers and exact versions", () => {
    expect(resolveKnownModelFamily("anthropic", "claude-opus-4-6-20250929")).toBe("anthropic-opus");
    expect(resolveKnownModelFamily("openrouter", "anthropic/claude-opus-4-6")).toBe(
      "anthropic-opus",
    );
    expect(resolveKnownModelFamily("openai", "gpt-5-mini")).toBe("openai-gpt-mini");
    expect(resolveKnownModelFamily("google", "gemini-3-flash-preview")).toBe("google-gemini-flash");
  });
});
