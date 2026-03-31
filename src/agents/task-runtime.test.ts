import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSession,
  appendOutput,
  markExited,
  resetProcessRegistryForTests,
  sweepProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";
import { addSubagentRunForTests, resetSubagentRegistryForTests } from "./subagent-registry.js";
import { resolveTaskOutputPath, resolveTaskTranscriptPath } from "./task-output-artifacts.js";
import { listActionableRuntimeTaskIds, stopRuntimeTask, type RuntimeTask } from "./task-runtime.js";

function createBackgroundShellSession(id: string, command = `echo ${id}`): ProcessSession {
  return {
    id,
    command,
    description: command,
    sessionKey: "agent:main:main",
    startedAt: Date.now(),
    maxOutputChars: 8_000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    stdout: "",
    stderr: "",
    aggregated: "",
    tail: "",
    outputPath: resolveTaskOutputPath({ taskId: id, taskType: "shell" }),
    transcriptPath: resolveTaskTranscriptPath({ taskId: id, taskType: "shell" }),
    exited: false,
    truncated: false,
    backgrounded: true,
  };
}

describe("task runtime", () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-runtime-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
    resetProcessRegistryForTests();
    resetSubagentRegistryForTests();
  });

  afterEach(async () => {
    resetProcessRegistryForTests();
    resetSubagentRegistryForTests();
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("returns typed not_found errors for unknown tasks", () => {
    expect(stopRuntimeTask("missing-task")).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("returns typed not_running errors for finished shell tasks", () => {
    const task = createBackgroundShellSession("shell-finished");
    addSession(task);
    appendOutput(task, "stdout", "done\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    expect(stopRuntimeTask(task.id)).toMatchObject({
      ok: false,
      code: "not_running",
      task: {
        task_id: task.id,
        status: "success",
      } satisfies Partial<RuntimeTask>,
    });
  });

  it("returns typed unsupported_type errors for live subagent tasks", () => {
    addSubagentRunForTests({
      runId: "agent-running",
      childSessionKey: "agent:main:subagent:running",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Check the migration plan.",
      cleanup: "keep",
      createdAt: Date.now(),
      startedAt: Date.now(),
      notified: false,
    });

    expect(stopRuntimeTask("agent-running")).toMatchObject({
      ok: false,
      code: "unsupported_type",
      task: {
        task_id: "agent-running",
        task_type: "agent",
        status: "running",
      } satisfies Partial<RuntimeTask>,
    });
  });

  it("lists awaiting_input tasks as actionable for sleep wakeups", () => {
    const task = createBackgroundShellSession("shell-awaiting");
    addSession(task);
    appendOutput(task, "stdout", "Overwrite existing file? (y/n)\n");
    task.lastOutputAt = Date.now() - 60_000;
    sweepProcessRegistryForTests();

    expect(listActionableRuntimeTaskIds({ requesterSessionKey: "agent:main:main" })).toContain(
      task.id,
    );
  });
});
