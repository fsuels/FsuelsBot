import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/project"),
}));

vi.mock("../config/sessions.js", () => ({
  resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
  loadSessionStore: vi.fn(() => ({
    "agent:main:main": {
      sessionId: "sess-1",
      thinkingLevel: "low",
      reasoningLevel: "off",
      elevatedLevel: "ask",
      channel: "telegram",
    },
  })),
}));

vi.mock("../agents/model-selection.js", () => ({
  resolveDefaultModelForAgent: vi.fn(() => ({ provider: "openai", model: "gpt-test" })),
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => []),
  findModelInCatalog: vi.fn(() => ({ contextWindow: 128_000 })),
}));

vi.mock("../agents/context-window-guard.js", () => ({
  resolveContextWindowInfo: vi.fn(() => ({ tokens: 128_000, source: "model" })),
}));

vi.mock("../agents/context-report.js", () => ({
  loadProjectedContextReport: vi.fn(async () => makeReport()),
}));

function makeReport(): SessionSystemPromptReport {
  return {
    source: "estimate",
    generatedAt: 0,
    workspaceDir: "/tmp/project",
    systemPrompt: {
      chars: 1_200,
      tokens: 150,
      projectContextChars: 400,
      projectContextTokens: 60,
      nonProjectContextChars: 800,
      nonProjectContextTokens: 90,
    },
    injectedWorkspaceFiles: [
      {
        name: "MEMORY.md",
        path: "/tmp/project/MEMORY.md",
        missing: false,
        rawChars: 300,
        rawTokens: 40,
        injectedChars: 250,
        injectedTokens: 30,
        truncated: false,
        sourceGroup: "project",
      },
    ],
    skills: {
      promptChars: 320,
      promptTokens: 32,
      availableCount: 1,
      loadedCount: 1,
      entries: [
        {
          name: "planner",
          blockChars: 220,
          blockTokens: 20,
          sourceCategory: "workspace",
        },
      ],
    },
    tools: {
      listChars: 180,
      listTokens: 18,
      schemaChars: 900,
      schemaTokens: 90,
      entries: [
        {
          name: "exec",
          summaryChars: 80,
          summaryTokens: 8,
          schemaChars: 900,
          schemaTokens: 90,
          propertiesCount: 4,
        },
      ],
    },
    modelView: {
      branchHistoryMessages: 8,
      branchHistoryTokens: 500,
      scopedHistoryMessages: 4,
      scopedHistoryTokens: 220,
      sanitizedHistoryMessages: 4,
      sanitizedHistoryTokens: 220,
      validatedHistoryMessages: 4,
      validatedHistoryTokens: 220,
      limitedHistoryMessages: 4,
      limitedHistoryTokens: 220,
      projectedHistoryMessages: 3,
      projectedHistoryTokens: 180,
      taskScoped: true,
      truncatedToolResults: 0,
      systemPromptTokens: 150,
      toolSchemaTokens: 90,
      projectedTotalTokens: 420,
      contextWindowTokens: 128_000,
      contextPressure: 420 / 128_000,
      historyStages: [
        {
          key: "branch",
          label: "Branch history",
          messages: 8,
          tokens: 500,
          changed: false,
          savingsTokens: 0,
        },
        {
          key: "scoped",
          label: "Task-scoped history",
          messages: 4,
          tokens: 220,
          changed: true,
          savingsTokens: 280,
        },
        {
          key: "projected",
          label: "Projected model payload",
          messages: 3,
          tokens: 180,
          changed: true,
          savingsTokens: 40,
        },
      ],
    },
  };
}

describe("doctorContextCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes context mode values", async () => {
    const { normalizeDoctorContextMode } = await import("./doctor-context.js");

    expect(normalizeDoctorContextMode(undefined)).toBe("list");
    expect(normalizeDoctorContextMode(true)).toBe("list");
    expect(normalizeDoctorContextMode("detail")).toBe("detail");
    expect(normalizeDoctorContextMode("json")).toBe("json");
    expect(normalizeDoctorContextMode("wat")).toBeNull();
  });

  it("prints a focused list report", async () => {
    const { doctorContextCommand } = await import("./doctor-context.js");
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

    await doctorContextCommand(runtime, {
      cfg: {} as OpenClawConfig,
      mode: "list",
    });

    const output = vi.mocked(runtime.log).mock.calls[0]?.[0];
    expect(output).toContain("Context doctor");
    expect(output).toContain("Agent: main");
    expect(output).toContain("Model: openai/gpt-test");
    expect(output).toContain("Top contributors:");
    expect(output).toContain("Suggestions:");
  });

  it("prints json when requested", async () => {
    const { doctorContextCommand } = await import("./doctor-context.js");
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

    await doctorContextCommand(runtime, {
      cfg: {} as OpenClawConfig,
      mode: "json",
    });

    const output = vi.mocked(runtime.log).mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed.agentId).toBe("main");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-test");
    expect(parsed.inspector.totalTokens).toBe(420);
  });
});
