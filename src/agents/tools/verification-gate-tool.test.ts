import { describe, expect, it, vi } from "vitest";
import {
  buildPrimaryVerifierTask,
  buildVerificationArtifact,
  createVerificationGateTool,
  normalizeVerificationReport,
} from "./verification-gate-tool.js";

function createPersistArtifactStub() {
  return vi.fn().mockResolvedValue(undefined);
}

describe("verification_gate tool", () => {
  it("skips the verifier path for trivial changes", async () => {
    const spawnTask = vi.fn();
    const waitForTask = vi.fn();
    const ensureVerificationTask = vi.fn();
    const completeVerificationTask = vi.fn();
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask,
      completeVerificationTask,
      persistArtifact,
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
    expect(persistArtifact).not.toHaveBeenCalled();
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
          verified: ["Tests pass", "Adversarial probe: retrying auth flow twice still passes"],
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
          verified: ["Spot-check matched", "Adversarial probe: malformed token stays rejected"],
          unverified: [],
          failure_reasons: [],
        }),
      });
    const ensureVerificationTask = vi.fn().mockResolvedValue({ id: "verify-1" });
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = vi.fn().mockResolvedValue({
      path: "/tmp/verification-pass.json",
      sizeBytes: 123,
      sha256: "deadbeef",
      mimeType: "application/json",
    });
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask,
      completeVerificationTask,
      persistArtifact,
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
      verificationArtifact: {
        verdict_line: "VERDICT: PASS",
      },
      artifact: {
        path: "/tmp/verification-pass.json",
      },
    });
    expect(spawnTask).toHaveBeenCalledTimes(2);
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
    expect(persistArtifact).toHaveBeenCalledTimes(1);
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
          verified: [
            "Migration test passes",
            "Adversarial probe: rerunning the migration leaves state unchanged",
          ],
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
          verified: [
            "Spot-check matched",
            "Adversarial probe: malformed input still fails cleanly",
          ],
          unverified: [],
          failure_reasons: [],
        }),
      });
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-2" }),
      completeVerificationTask,
      persistArtifact,
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
    const persistArtifact = createPersistArtifactStub();
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
      persistArtifact,
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

  it("downgrades low-confidence FAIL reports to PARTIAL", async () => {
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask: vi.fn().mockResolvedValue({ taskId: "primary-low-confidence" }),
      waitForTask: vi.fn().mockResolvedValue({
        finalText: JSON.stringify({
          verdict: "FAIL",
          summary: "A test may have failed for an environment reason.",
          confidence: 0.4,
          commands_executed: [],
          verified: [],
          unverified: [],
          failure_reasons: ["The failure could not be tied directly to the change."],
        }),
      }),
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-4" }),
      completeVerificationTask,
      persistArtifact,
    });

    const result = await tool.execute("verify-low-confidence-fail", {
      changeSummary: "Adjust staging deployment checks",
      editedFilesCount: 3,
      riskLabels: ["infra", "config"],
      checks: ["Confirm staging boot still works"],
    });

    expect(result.details).toMatchObject({
      verdict: "PARTIAL",
      report: {
        confidence: 0.4,
        unverified: expect.arrayContaining([
          "FAIL verdict was downgraded because the evidence or confidence was not strong enough.",
        ]),
      },
    });
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });

  it("downgrades PASS without an adversarial probe to PARTIAL", async () => {
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask: vi.fn().mockResolvedValue({ taskId: "primary-no-probe" }),
      waitForTask: vi.fn().mockResolvedValue({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Tests passed.",
          confidence: 0.95,
          commands_executed: [
            { command: "pnpm test auth", status: "passed", relevant_output: "4 passed" },
          ],
          verified: ["Auth tests pass"],
          unverified: [],
          failure_reasons: [],
        }),
      }),
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-5" }),
      completeVerificationTask,
      persistArtifact,
    });

    const result = await tool.execute("verify-no-probe", {
      changeSummary: "Tighten auth retry handling",
      editedFilesCount: 3,
      riskLabels: ["backend", "auth"],
      commands: ["pnpm test auth"],
    });

    expect(result.details).toMatchObject({
      verdict: "PARTIAL",
      report: {
        unverified: expect.arrayContaining([
          expect.stringContaining("no adversarial probe was recorded"),
        ]),
      },
    });
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });

  it("downgrades PASS without a command output block to PARTIAL", async () => {
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask: vi.fn().mockResolvedValue({ taskId: "primary-no-output" }),
      waitForTask: vi.fn().mockResolvedValue({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Auth tests passed.",
          confidence: 0.95,
          commands_executed: [{ command: "pnpm test auth", status: "passed" }],
          verified: [
            "Auth tests pass",
            "Adversarial probe: repeated token refresh still succeeds once",
          ],
          unverified: [],
          failure_reasons: [],
        }),
      }),
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-6" }),
      completeVerificationTask,
      persistArtifact,
    });

    const result = await tool.execute("verify-no-output", {
      changeSummary: "Tighten auth retry handling",
      editedFilesCount: 3,
      riskLabels: ["backend", "auth"],
      commands: ["pnpm test auth"],
    });

    expect(result.details).toMatchObject({
      verdict: "PARTIAL",
      report: {
        unverified: expect.arrayContaining([
          expect.stringContaining("no successful command included exact observed output evidence"),
        ]),
      },
    });
    expect(completeVerificationTask).toHaveBeenCalledTimes(1);
  });

  it("fails overall when the spot-check catches an idempotency regression", async () => {
    const spawnTask = vi
      .fn()
      .mockResolvedValueOnce({ taskId: "primary-pass" })
      .mockResolvedValueOnce({ taskId: "spot-fail" });
    const waitForTask = vi
      .fn()
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "PASS",
          summary: "Primary verifier passed.",
          commands_executed: [
            { command: "pnpm test billing", status: "passed", relevant_output: "8 passed" },
          ],
          verified: [
            "Billing tests pass",
            "Adversarial probe: a second invoice replay looked safe on the first run",
          ],
          unverified: [],
          failure_reasons: [],
        }),
      })
      .mockResolvedValueOnce({
        finalText: JSON.stringify({
          verdict: "FAIL",
          summary: "Replay created a duplicate invoice on the second run.",
          commands_executed: [
            {
              command: "pnpm test billing -- --runInBand",
              status: "failed",
              relevant_output: "Expected 1 invoice, received 2",
            },
          ],
          verified: [],
          unverified: [],
          failure_reasons: ["Idempotency replay created a duplicate invoice."],
        }),
      });
    const completeVerificationTask = vi.fn().mockResolvedValue(undefined);
    const persistArtifact = createPersistArtifactStub();
    const tool = createVerificationGateTool(undefined, {
      spawnTask,
      waitForTask,
      ensureVerificationTask: vi.fn().mockResolvedValue({ id: "verify-7" }),
      completeVerificationTask,
      persistArtifact,
    });

    const result = await tool.execute("verify-spotcheck-fail", {
      changeSummary: "Refactor invoice idempotency handling",
      editedFilesCount: 4,
      riskLabels: ["backend", "api"],
      commands: ["pnpm test billing"],
    });

    expect(result.details).toMatchObject({
      verdict: "FAIL",
      report: {
        failure_reasons: ["Idempotency replay created a duplicate invoice."],
      },
      spotCheck: {
        taskId: "spot-fail",
      },
    });
    expect(completeVerificationTask).not.toHaveBeenCalled();
  });

  it("builds a verifier prompt that emphasizes adversarial probes and evidence", () => {
    const prompt = buildPrimaryVerifierTask({
      changeSummary: "Refactor auth edge-case handling",
      files: ["src/auth.ts"],
      riskLabels: ["backend", "auth"],
      commands: ["pnpm test auth"],
      checks: ["Review fallback token refresh path"],
    });

    expect(prompt).toContain("Candidate discovery");
    expect(prompt).toContain("Adversarial probe");
    expect(prompt).toContain("Filter: discard anything not backed by decisive evidence");
    expect(prompt).toContain("Prefer PARTIAL over speculative PASS or FAIL.");
    expect(prompt).toContain("Reading code alone is never enough for PASS");
    expect(prompt).toContain(
      "Before FAIL, check whether the observed behavior is already handled elsewhere",
    );
    expect(prompt).toContain("PASS requires at least one successfully executed command");
    expect(prompt).toContain("Capture the exact decisive command output");
    expect(prompt).toContain("Ignore style nits");
    expect(prompt).toContain("Adversarial probe:");
    expect(prompt).toContain('"confidence": 0');
  });

  it("normalizes verifier verdict parsing to PASS/FAIL/PARTIAL", () => {
    expect(
      normalizeVerificationReport({
        verdict: "pass",
        summary: "ok",
      }).verdict,
    ).toBe("PASS");
    expect(
      normalizeVerificationReport({
        verdict: "fail",
        summary: "bad",
      }).verdict,
    ).toBe("FAIL");
    expect(
      normalizeVerificationReport({
        verdict: "maybe",
        summary: "unknown",
      }).verdict,
    ).toBe("PARTIAL");
  });

  it("builds a structured verification artifact with per-check evidence", () => {
    const artifact = buildVerificationArtifact({
      changeSummary: "Refactor auth edge-case handling",
      primaryTaskId: "primary-1",
      primaryReport: normalizeVerificationReport({
        verdict: "PASS",
        summary: "Primary verifier passed.",
        confidence: 0.9,
        commands_executed: [
          {
            command: "pnpm test auth",
            status: "passed",
            relevant_output: "4 passed",
          },
        ],
        verified: ["Adversarial probe: malformed token stays rejected"],
        unverified: [],
        failure_reasons: [],
      }),
      finalReport: normalizeVerificationReport({
        verdict: "PASS",
        summary: "Primary verifier passed.",
        confidence: 0.9,
        commands_executed: [
          {
            command: "pnpm test auth",
            status: "passed",
            relevant_output: "4 passed",
          },
        ],
        verified: ["Adversarial probe: malformed token stays rejected"],
        unverified: [],
        failure_reasons: [],
      }),
    });

    expect(artifact).toMatchObject({
      schema_version: 1,
      verdict: "PASS",
      verdict_line: "VERDICT: PASS",
      primary_task_id: "primary-1",
      checks: expect.arrayContaining([
        expect.objectContaining({
          phase: "primary",
          check_name: "pnpm test auth",
          command_run: "pnpm test auth",
          output_observed: "4 passed",
          result: "passed",
        }),
      ]),
    });
  });
});
