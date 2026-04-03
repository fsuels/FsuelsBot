import { describe, expect, it } from "vitest";
import {
  buildStepContext,
  buildStepScopedPromptInputs,
} from "./step-context-manager.js";
import type { ActiveTaskSummary } from "./task-checkpoint.js";

function makeTask(overrides?: Partial<ActiveTaskSummary>): ActiveTaskSummary {
  return {
    taskId: "task-browser",
    title: "Book a reservation",
    goal: "Complete the website flow",
    totalSteps: 3,
    completedSteps: 1,
    currentStepIndex: 1,
    currentStepText: "Fill the form fields in the browser",
    stepsCompleted: ["[s1] Open the site"],
    stepsRemaining: ["[s2] Fill the form fields in the browser", "[s3] Submit the request"],
    keyOutputs: ["s1: restaurant page opened"],
    blockers: [],
    resolvedBlockers: [],
    canStart: true,
    nextRecommendedAction: "continue_task",
    nextAction: "Enter the date, time, and party size",
    decisions: [],
    constraints: [],
    links: [],
    ...overrides,
  };
}

describe("step-context-manager", () => {
  it("builds a focused prompt with tool guidance for the current step", () => {
    const result = buildStepContext(makeTask(), [
      "browser",
      "memory_search",
      "message",
      "exec",
      "read",
    ]);

    expect(result.domain).toBe("browser");
    expect(result.relevantTools).toEqual(["browser", "exec", "read"]);
    expect(result.suppressibleTools).toEqual(["memory_search", "message"]);
    expect(result.promptSection).toContain(">>> CURRENT STEP (2/3): Fill the form fields in the browser");
    expect(result.promptSection).toContain("Prefer tools now: browser, exec, read");
    expect(result.promptSection).toContain(
      "De-emphasize unless needed: memory_search, message",
    );
  });

  it("filters prompt inputs to the current step and removes duplicate ACTIVE_TASK context", () => {
    const inputs = buildStepScopedPromptInputs({
      task: makeTask(),
      toolNames: ["browser", "memory_search", "message", "exec", "read"],
      contextFiles: [
        { path: "ACTIVE_TASK", content: "old task dump" },
        { path: "AGENTS.md", content: "workspace guidance" },
      ],
    });

    expect(inputs.promptToolNames).toEqual(["browser", "exec", "read"]);
    expect(inputs.stepContext?.domain).toBe("browser");
    expect(inputs.contextFiles).toEqual([{ path: "AGENTS.md", content: "workspace guidance" }]);
  });
});
