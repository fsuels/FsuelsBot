import { describe, expect, it } from "vitest";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { buildContextInspectorData } from "./context-inspector.js";

function makeReport(): SessionSystemPromptReport {
  return {
    source: "estimate",
    generatedAt: 0,
    systemPrompt: {
      chars: 800,
      tokens: 80,
      projectContextChars: 200,
      projectContextTokens: 15,
      nonProjectContextChars: 600,
      nonProjectContextTokens: 65,
    },
    injectedWorkspaceFiles: [
      {
        name: "MEMORY.md",
        path: "/tmp/project/MEMORY.md",
        missing: false,
        rawChars: 600,
        rawTokens: 30,
        injectedChars: 500,
        injectedTokens: 25,
        truncated: false,
        sourceGroup: "project",
      },
    ],
    skills: {
      promptChars: 300,
      promptTokens: 30,
      availableCount: 1,
      loadedCount: 1,
      entries: [
        {
          name: "ship-it",
          blockChars: 120,
          blockTokens: 8,
          sourceCategory: "workspace",
        },
      ],
    },
    tools: {
      listChars: 160,
      listTokens: 10,
      schemaChars: 700,
      schemaTokens: 40,
      entries: [
        {
          name: "exec",
          summaryChars: 80,
          summaryTokens: 6,
          schemaChars: 700,
          schemaTokens: 40,
          propertiesCount: 3,
        },
      ],
    },
  };
}

describe("buildContextInspectorData", () => {
  it("prefers explicit token counts over char-based estimates", () => {
    const report = makeReport();

    const inspector = buildContextInspectorData({
      report,
      session: { contextTokens: 1_000 },
    });

    expect(inspector.totalTokens).toBe(120);
    expect(inspector.files.totalInjectedTokens).toBe(25);
    expect(inspector.skills.promptTokens).toBe(30);
    expect(inspector.tools.listTokens).toBe(10);
    expect(inspector.tools.schemaTokens).toBe(40);
    expect(inspector.categoryBreakdown).toEqual([
      expect.objectContaining({ key: "project_context", tokens: 15 }),
      expect.objectContaining({ key: "non_project_prompt", tokens: 65 }),
      expect.objectContaining({ key: "tool_schemas", tokens: 40 }),
    ]);
    expect(inspector.files.memoryFiles).toEqual([
      expect.objectContaining({ name: "MEMORY.md", tokens: 25 }),
    ]);
  });
});
