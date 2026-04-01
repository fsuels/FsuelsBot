import { describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { buildToolOperatorManualMap, buildToolSummaryMap } from "./tool-summaries.js";

describe("tool summaries", () => {
  it("renders invocation contracts as operator manuals", () => {
    const manuals = buildToolOperatorManualMap([
      {
        name: "sessions_spawn",
        label: "Sessions",
        description: "spawn tool",
        parameters: {},
        execute: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
        invocationContract: {
          usagePolicy: "explicit_only",
          sideEffectLevel: "high",
          whenToUse: ["The user explicitly asks for a worker."],
          whenNotToUse: ["Do not use for local work."],
          preconditions: ["A concrete task is ready."],
          behaviorSummary: "Starts a background worker session.",
          parametersSummary: ["task: worker instruction."],
        },
      },
    ]);

    expect(manuals.sessions_spawn).toContain("Usage policy: explicit_only");
    expect(manuals.sessions_spawn).toContain("When to use:");
    expect(manuals.sessions_spawn).toContain("When not to use:");
    expect(manuals.sessions_spawn).toContain("Requirements:");
    expect(manuals.sessions_spawn).toContain("Behavior: Starts a background worker session.");
    expect(manuals.sessions_spawn).toContain("Parameters:");
    expect(manuals.sessions_spawn).toContain("Side effects: high");
  });

  it("appends invocation contracts after custom operator manuals", () => {
    const manuals = buildToolOperatorManualMap([
      {
        name: "cron",
        label: "Cron",
        description: "cron tool",
        parameters: {},
        execute: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
        operatorManual: () => "Purpose: manage reminders.",
        invocationContract: {
          usagePolicy: "explicit_only",
          sideEffectLevel: "high",
          whenToUse: ["The user explicitly asks for scheduling."],
          behaviorSummary: "Creates durable scheduler jobs.",
          parametersSummary: ["action: scheduler operation."],
        },
      },
    ]);

    expect(manuals.cron).toContain("Purpose: manage reminders.");
    expect(manuals.cron).toContain("Usage policy: explicit_only");
    expect(manuals.cron).toContain("Behavior: Creates durable scheduler jobs.");
  });

  it("includes invocation contracts for real high-side-effect tools", () => {
    const tool = createOpenClawTools({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    }).find((candidate) => candidate.name === "sessions_spawn");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing sessions_spawn");
    }

    const manuals = buildToolOperatorManualMap([tool]);
    expect(manuals.sessions_spawn).toContain("Usage policy: explicit_only");
    expect(manuals.sessions_spawn).toContain(
      "Do not use for local work you can do in the current session.",
    );
    expect(manuals.sessions_spawn).toContain("task: required worker instruction.");
  });

  it("prefers searchSummary over description when building summaries", () => {
    const summaries = buildToolSummaryMap([
      {
        name: "tool_discovery",
        label: "Tool Discovery",
        description: "generic description",
        searchSummary: "Find and activate deferred tools.",
        parameters: {},
        execute: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
      },
    ]);

    expect(summaries.tool_discovery).toBe("Find and activate deferred tools.");
  });

  it("builds runtime-aware browser operator manuals only for active browser runtime flags", async () => {
    const { createBrowserTool } =
      await vi.importActual<typeof import("./tools/browser-tool.js")>("./tools/browser-tool.js");
    const defaultManuals = buildToolOperatorManualMap([createBrowserTool()]);
    const sandboxedManuals = buildToolOperatorManualMap([
      createBrowserTool({
        sandboxBridgeUrl: "http://127.0.0.1:9999",
        allowHostControl: false,
      }),
    ]);

    expect(defaultManuals.browser).toContain(
      "Prefer `web_search`/`web_fetch` for public docs, search, or read-only web research.",
    );
    expect(defaultManuals.browser).toContain("Default target: host.");
    expect(defaultManuals.browser).not.toContain("Sandbox target is available in this session.");
    expect(defaultManuals.browser).not.toContain("Host target is blocked in this session.");

    expect(sandboxedManuals.browser).toContain("Default target: sandbox.");
    expect(sandboxedManuals.browser).toContain("Sandbox target is available in this session.");
    expect(sandboxedManuals.browser).toContain("Host target is blocked in this session.");
    expect(sandboxedManuals.browser).toContain(
      "After 2 consecutive failures in the same browser action family",
    );
  });
});
