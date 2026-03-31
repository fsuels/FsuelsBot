import { describe, expect, it } from "vitest";
import { decideWorkerReuse } from "./subagent-reuse-policy.js";

describe("subagent reuse policy", () => {
  it("requires a fresh worker for verification", () => {
    const decision = decideWorkerReuse({
      currentWorkerRunId: "run-impl",
      nextTaskType: "verification",
      currentFilePaths: ["src/auth/retry.ts"],
      nextFilePaths: ["src/auth/retry.ts"],
      relation: "same_slice",
    });

    expect(decision).toMatchObject({
      action: "spawn_fresh",
      reasonCode: "verification_requires_independence",
      overlappingFiles: ["src/auth/retry.ts"],
    });
  });

  it("continues the same worker for same-slice corrections", () => {
    const decision = decideWorkerReuse({
      currentWorkerRunId: "run-impl",
      targetAuthorRunId: "run-impl",
      nextTaskType: "correction",
      currentFilePaths: ["src/auth/retry.ts"],
      nextFilePaths: ["src/auth/retry.ts", "src/auth/retry.test.ts"],
      relation: "same_slice",
    });

    expect(decision).toMatchObject({
      action: "continue_existing",
      reasonCode: "correction_prefers_same_worker",
      overlappingFiles: ["src/auth/retry.ts"],
    });
  });

  it("spawns a fresh worker when the approach changes", () => {
    const decision = decideWorkerReuse({
      currentWorkerRunId: "run-impl",
      nextTaskType: "implementation",
      currentFilePaths: ["src/auth/retry.ts"],
      nextFilePaths: ["src/auth/retry.ts"],
      changeApproach: true,
    });

    expect(decision).toMatchObject({
      action: "spawn_fresh",
      reasonCode: "approach_changed",
    });
  });
});
