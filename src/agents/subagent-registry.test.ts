import { describe, expect, it } from "vitest";
import {
  addSubagentRunForTests,
  buildTaskOutputFromSubagentRun,
  getSubagentRun,
  resetSubagentRegistryForTests,
  resolveSubagentLifecycleStatus,
  setSubagentRunCancelled,
} from "./subagent-registry.js";

describe("subagent registry lifecycle", () => {
  it("reports newly registered runs as queued until a start timestamp exists", () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-queued",
      childSessionKey: "agent:main:subagent:queued",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "inspect queue behavior",
      cleanup: "keep",
      createdAt: 1_000,
    });

    const entry = getSubagentRun("run-queued");
    expect(entry).toBeDefined();
    expect(resolveSubagentLifecycleStatus(entry!)).toBe("queued");
    expect(buildTaskOutputFromSubagentRun(entry!)).toMatchObject({
      status: "pending",
      metadata: expect.objectContaining({
        lifecycle_status: "queued",
      }),
    });
  });

  it("marks cancelled runs as terminal and keeps the cancellation reason inspectable", () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-cancelled",
      childSessionKey: "agent:main:subagent:cancelled",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "verify cancelled status",
      cleanup: "delete",
      createdAt: 1_000,
      startedAt: 1_100,
    });

    expect(setSubagentRunCancelled("run-cancelled", "Stopped by requester.")).toBe(true);

    const entry = getSubagentRun("run-cancelled");
    expect(entry).toBeDefined();
    expect(resolveSubagentLifecycleStatus(entry!)).toBe("cancelled");
    expect(entry).toMatchObject({
      cleanupState: "completed",
      cleanupReason: "Stopped by requester.",
      outcome: {
        status: "cancelled",
        error: "Stopped by requester.",
      },
    });
    expect(entry?.cleanupCompletedAt).toBeDefined();
    expect(buildTaskOutputFromSubagentRun(entry!)).toMatchObject({
      status: "cancelled",
      error: "Stopped by requester.",
      metadata: expect.objectContaining({
        lifecycle_status: "cancelled",
      }),
    });
  });
});
