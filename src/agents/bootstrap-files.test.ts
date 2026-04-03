import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun, resolveBootstrapFilesForRun } from "./bootstrap-files.js";

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("applies bootstrap hook overrides", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "EXTRA.md",
          path: path.join(context.workspaceDir, "EXTRA.md"),
          content: "extra",
          missing: false,
        },
      ];
    });

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    expect(files.some((file) => file.name === "EXTRA.md")).toBe(true);
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("returns context files for hook-adjusted bootstrap files", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "EXTRA.md",
          path: path.join(context.workspaceDir, "EXTRA.md"),
          content: "extra",
          missing: false,
        },
      ];
    });

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const extra = result.contextFiles.find((file) => file.path === "EXTRA.md");

    expect(extra?.content).toBe("extra");
  });

  it("injects the active task using the focused step context view", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const boardPath = path.join(workspaceDir, "memory", "tasks.json");
    await fs.mkdir(path.dirname(boardPath), { recursive: true });
    await fs.writeFile(
      boardPath,
      `${JSON.stringify(
        {
          lanes: { bot_current: ["task-a"] },
          tasks: {
            "task-a": {
              title: "Book a reservation",
              goal: "Complete the reservation flow",
              current_step: 1,
              next_action: "Enter the form fields",
              steps: [
                { id: "s1", text: "Open the site", status: "done", checked: true },
                {
                  id: "s2",
                  text: "Fill the form fields in the browser",
                  status: "in_progress",
                  checked: false,
                },
                { id: "s3", text: "Submit the request", status: "todo", checked: false },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const activeTask = result.contextFiles.find((file) => file.path === "ACTIVE_TASK");

    expect(activeTask?.content).toContain(">>> CURRENT STEP (2/3): Fill the form fields in the browser");
    expect(activeTask?.content).toContain("Previous step done: Open the site");
    expect(activeTask?.content).not.toContain("## Completed Steps");
  });
});
