import { describe, expect, it } from "vitest";
import { buildSystemPromptReport } from "./system-prompt-report.js";

describe("buildSystemPromptReport", () => {
  it("includes synthetic injected context files alongside workspace bootstrap files", () => {
    const report = buildSystemPromptReport({
      source: "estimate",
      generatedAt: 0,
      workspaceDir: "/tmp/project",
      bootstrapMaxChars: 4000,
      systemPrompt: "# Project Context\nAGENTS\n## Runtime\nruntime",
      bootstrapFiles: [
        {
          name: "AGENTS.md",
          path: "/tmp/project/AGENTS.md",
          content: "agents",
          missing: false,
        },
      ],
      injectedFiles: [
        { path: "AGENTS.md", content: "agents" },
        { path: "ACTIVE_TASK", content: "task context" },
      ],
      skillsPrompt: "",
      tools: [],
    });

    expect(report.injectedWorkspaceFiles).toEqual([
      expect.objectContaining({
        name: "AGENTS.md",
        synthetic: false,
        sourceGroup: "project",
      }),
      expect.objectContaining({
        name: "ACTIVE_TASK",
        synthetic: true,
        sourceGroup: "managed",
        injectedChars: "task context".length,
      }),
    ]);
  });

  it("records skill source categories and visible counts", () => {
    const report = buildSystemPromptReport({
      source: "estimate",
      generatedAt: 0,
      workspaceDir: "/tmp/project",
      bootstrapMaxChars: 4000,
      systemPrompt: "# Project Context\n## Runtime\nruntime",
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: "<skill><name>plugin-helper</name><description>x</description></skill>",
      resolvedSkills: [{ name: "plugin-helper", source: "openclaw-plugin" }],
      availableSkillsCount: 3,
      loadedSkillsCount: 1,
      tools: [],
    });

    expect(report.skills.availableCount).toBe(3);
    expect(report.skills.loadedCount).toBe(1);
    expect(report.skills.entries).toEqual([
      expect.objectContaining({
        name: "plugin-helper",
        sourceCategory: "plugin",
      }),
    ]);
  });
});
