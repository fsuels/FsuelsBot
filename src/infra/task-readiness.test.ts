import { describe, expect, it } from "vitest";
import { decorateTaskWithReadiness, normalizeTaskReadiness } from "./task-readiness.js";

describe("task readiness", () => {
  it("filters resolved blockers before determining canStart", () => {
    const readiness = normalizeTaskReadiness({
      status: "active",
      blockers: ["resolved: Waiting for review", "Waiting for review", "Need final approval"],
    });

    expect(readiness).toEqual({
      unresolvedBlockers: ["Need final approval"],
      resolvedBlockers: ["Waiting for review"],
      canStart: false,
      nextRecommendedAction: "inspect_blockers",
    });
  });

  it("allows start when status is workable and blockers are cleared", () => {
    const readiness = normalizeTaskReadiness({
      status: "in_progress",
      blockers: ["resolved: Need final approval", "Need final approval"],
    });

    expect(readiness).toEqual({
      unresolvedBlockers: [],
      resolvedBlockers: ["Need final approval"],
      canStart: true,
      nextRecommendedAction: "start_task",
    });
  });

  it("decorates API payloads with normalized readiness fields", () => {
    const task = decorateTaskWithReadiness({
      title: "Task A",
      status: "waiting_human",
      blockers: [],
    });

    expect(task).toMatchObject({
      can_start: false,
      next_recommended_action: "wait_for_blockers",
      unresolved_blockers: [],
      resolved_blockers: [],
    });
  });
});
