import { describe, expect, it } from "vitest";
import {
  buildSubagentTaskSpec,
  inferTaskTypeFromProfile,
  validateTaskTypeProfileCompatibility,
} from "./subagent-task-spec.js";

describe("subagent task spec", () => {
  it("rejects hidden-context implementation prompts without explicit facts", () => {
    const result = buildSubagentTaskSpec({
      task: "Based on your findings, fix the recent changes.",
      taskType: "implementation",
      doneCriteria: ["Patch the bug and report the root cause."],
    });

    expect(result).toMatchObject({
      ok: false,
    });
    if (result.ok) {
      throw new Error("expected hidden-context validation failure");
    }
    expect(result.error).toContain("Structured worker tasks must restate concrete facts");
  });

  it("builds a self-contained verification prompt with read-only defaults", () => {
    const result = buildSubagentTaskSpec({
      task: "Verify the auth retry fix",
      taskType: "verification",
      facts: [
        "src/auth/retry.ts now short-circuits duplicate retries after a network timeout.",
        "Regression coverage should focus on the login retry path.",
      ],
      doneCriteria: ["Run the auth retry regression test suite."],
      filePaths: ["src/auth/retry.ts", "src/auth/retry.test.ts"],
      commands: ["pnpm vitest src/auth/retry.test.ts"],
      sourceTaskId: "run-123",
    });

    expect(result).toMatchObject({
      ok: true,
    });
    if (!result.ok) {
      throw new Error("expected structured verification prompt");
    }
    expect(result.value.taskText).toContain("# Worker Task Spec");
    expect(result.value.taskText).toContain("Task type: verification");
    expect(result.value.taskText).toContain("Known Facts");
    expect(result.value.taskText).toContain("Done Criteria");
    expect(result.value.taskText).toContain(
      "Allowed: no. Report findings only; do not modify files.",
    );
    expect(result.value.taskText).toContain("Source task: run-123");
    expect(result.value.doneCriteria).toContain(
      "Exercise at least one edge case or error path during verification.",
    );
  });

  it("detects incompatible task type and capability profile combinations", () => {
    expect(inferTaskTypeFromProfile("planner")).toBe("research");
    expect(
      validateTaskTypeProfileCompatibility({
        taskType: "verification",
        profile: "implementation",
      }),
    ).toContain('Task type "verification" is incompatible');
    expect(
      validateTaskTypeProfileCompatibility({
        taskType: "correction",
        profile: "implementation",
      }),
    ).toBeUndefined();
  });
});
