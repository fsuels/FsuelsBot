import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSession,
  appendOutput,
  buildTaskOutputFromProcessSession,
  getFinishedSession,
  resetProcessRegistryForTests,
  stopOwnedProcessSessions,
  sweepProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";
import { resolveTaskOutputPath, resolveTaskTranscriptPath } from "./task-output-artifacts.js";

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

describe("bash process runtime maintenance", () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-process-runtime-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
    resetProcessRegistryForTests();
  });

  afterEach(async () => {
    resetProcessRegistryForTests();
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

  it("marks stalled interactive shells as awaiting_input", () => {
    const session = createBackgroundShellSession("shell-prompt");
    addSession(session);
    appendOutput(session, "stdout", "Continue? [y/n]\n");
    session.lastOutputAt = Date.now() - 60_000;

    sweepProcessRegistryForTests();

    expect(buildTaskOutputFromProcessSession(session)).toMatchObject({
      task_id: session.id,
      status: "awaiting_input",
      awaiting_input: {
        reason: "interactive confirmation prompt",
        prompt: "Continue? [y/n]",
      },
    });
  });

  it("does not false-trigger on slow non-interactive shells", () => {
    const session = createBackgroundShellSession("shell-slow");
    addSession(session);
    appendOutput(session, "stdout", "Downloading package metadata...\n42% complete\n");
    session.lastOutputAt = Date.now() - 60_000;

    sweepProcessRegistryForTests();

    expect(buildTaskOutputFromProcessSession(session)).toMatchObject({
      task_id: session.id,
      status: "running",
      awaiting_input: undefined,
    });
  });

  it("stops owned child shell sessions when the parent session exits", () => {
    const session = createBackgroundShellSession("shell-owned");
    addSession(session);

    expect(
      stopOwnedProcessSessions({
        sessionKey: "agent:main:main",
        reason: "Process stopped because the parent session was deleted.",
      }),
    ).toEqual({ stopped: 1 });

    expect(getFinishedSession(session.id)).toMatchObject({
      id: session.id,
      status: "failed",
      terminalReason: "cancelled",
      error: "Process stopped because the parent session was deleted.",
    });
  });
});
