import { describe, expect, it, vi } from "vitest";
import { createVerificationGateTool } from "./verification-gate-tool.js";

describe("verification_gate tool", () => {
  it("skips the verifier path for trivial changes", async () => {
    const spawnTask = vi.fn();
    const waitForTask = vi.fn();
    const ensureVerificationTask = vi.fn();
    const completeVerificationTask = vi.fn();
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask,
      completeVerificationTask,
    });

    const result = await tool.execute("verify-trivial", {
      changeSummary: "Rename a local variable",
      editedFilesCount: 1,
      files: ["src/a.ts"],
    });

    expect(result.details).toMatchObject({
      status: "not_required",
      nonTrivial: false,
    });
    expect(spawnTask).not.toHaveBeenCalled();
    expect(waitForTask).not.toHaveBeenCalled();
    expect(ensureVerificationTask).not.toHaveBeenCalled();
    expect(completeVerificationTask).not.toHaveBeenCalled();
  });

  it("returns PASS for non-trivial work when the primary and spot-check verifiers agree", async () => {
    const spawnTask = vi
      .fn()
      .mockResolvedValueOnce({ taskId: "primary-1" })
      .mockResolvedValueOnce({ taskId: "spot-1" });
    const waitForTask = vi
      .fn()
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Primary verifier passed.",
          commands_executed: [
            { command: "pnpm test", status: "passed", relevant_output: "12 passed" },
          ],
          verified: ["Tests pass"],
          unverified: [],
          failure_reasons: [],
        }),
      })
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Spot-check matched.",
          commands_executed: [
            { command: "pnpm test", status: "passed", relevant_output: "12 passed" },
          ],
          verified: ["Spot-check matched"],
          unverified: [],
          failure_reasons: [],
        }),
      });
    const ensureVerificationTask = vi.fn().mockResolvedValue({ id: "verify-1" });
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask,
      completeVerificationTask,
    });

    const result = await tool.execute("verify-pass", {
      changeSummary: "Refactor backend auth flow",
      editedFilesCount: 4,
      riskLabels: ["backend", "auth"],
      commands: ["pnpm test"],
    });

    expect(result.details).toMatchObject({
      status: "verified",
      verdict: "PASS",
      verificationTaskId: "verify-1",
      report: {
        summary: "Primary verifier passed.",
      },
    });
    expect(spawnTask).toHaveBeenCalledTimes(2);
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });

  it("surfaces FAIL first, then completes verification after a passing retry", async () => {
    const spawnTask = vi
      .fn()
      .mockResolvedValueOnce({ taskId: "primary-fail" })
      .mockResolvedValueOnce({ taskId: "primary-pass" })
      .mockResolvedValueOnce({ taskId: "spot-pass" });
    const waitForTask = vi
      .fn()
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "FAIL",
          summary: "Migration test failed.",
          commands_executed: [
            { command: "pnpm test migration", status: "failed", relevant_output: "1 failed" },
          ],
          verified: [],
          unverified: [],
          failure_reasons: ["Migration test failed."],
        }),
      })
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Primary verifier passed after the fix.",
          commands_executed: [
            { command: "pnpm test migration", status: "passed", relevant_output: "1 passed" },
          ],
          verified: ["Migration test passes"],
          unverified: [],
          failure_reasons: [],
        }),
      })
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Spot-check matched after the fix.",
          commands_executed: [
            { command: "pnpm test migration", status: "passed", relevant_output: "1 passed" },
          ],
          verified: ["Spot-check matched"],
          unverified: [],
          failure_reasons: [],
        }),
      });
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-2" }),
      completeVerificationTask,
    });

    const first = await tool.execute("verify-fail", {
      changeSummary: "Change migration ordering",
      editedFilesCount: 3,
      riskLabels: ["schema", "migration"],
      commands: ["pnpm test migration"],
    });
    const second = await tool.execute("verify-retry", {
      changeSummary: "Change migration ordering",
      editedFilesCount: 3,
      riskLabels: ["schema", "migration"],
      commands: ["pnpm test migration"],
    });

    expect(first.details).toMatchObject({
      verdict: "FAIL",
      report: {
        failure_reasons: ["Migration test failed."],
      },
    });
    expect(second.details).toMatchObject({
      verdict: "PASS",
    });
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });

  it("returns PARTIAL when the verifier cannot fully verify the change", async () => {
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const tool = createVerificationGateTool(undefined, {
      spawnTask: vi.fn().mockResolvedValue({ taskId: "primary-partial" }),
      waitForTask: vi.fn().mockResolvedValue({
        finalText: JSON.stringify({
          verdict: "PARTIAL",
          summary: "Could not run the deployment-only check in this environment.",
          commands_executed: [],
          verified: ["Static config shape looks correct"],
          unverified: ["Deployment smoke test"],
          failure_reasons: [],
        }),
      }),
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-3" }),
      completeVerificationTask,
    });

    const result = await tool.execute("verify-partial", {
      changeSummary: "Update infra config for staging",
      editedFilesCount: 3,
      riskLabels: ["infra", "config"],
      checks: ["Confirm the staging deploy still boots"],
    });

    expect(result.details).toMatchObject({
      verdict: "PARTIAL",
      report: {
        unverified: ["Deployment smoke test"],
      },
    });
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });
});
