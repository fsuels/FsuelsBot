import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sleep } from "../utils.js";
import { addSession, resetProcessRegistryForTests, type ProcessSession } from "./bash-process-registry.js";
import { createExecTool, createProcessTool } from "./bash-tools.js";

const longDelayCmd = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
  "setTimeout(() => {}, 2000)",
)}`;

function createManualBackgroundSession(id: string): ProcessSession {
  return {
    id,
    command: "manual-session",
    description: "manual-session",
    startedAt: Date.now(),
    maxOutputChars: 10_000,
    pendingMaxOutputChars: 10_000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    stdout: "",
    stderr: "",
    aggregated: "",
    tail: "",
    exited: false,
    truncated: false,
    backgrounded: true,
  };
}

describe("process tool ownership + destructive safety", () => {
  let tempStateDir: string;
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-owned-process-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
    resetProcessRegistryForTests();
  });

  afterEach(async () => {
    resetProcessRegistryForTests();
    await fs.rm(tempStateDir, { recursive: true, force: true });
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("returns a structured no-op for manual sessions outside the owned-resource registry", async () => {
    addSession(createManualBackgroundSession("manual-shell"));
    const processTool = createProcessTool({ sessionKey: "agent:main:main" });

    const result = await processTool.execute("call-manual-noop", {
      action: "remove",
      sessionId: "manual-shell",
    });

    expect(result.details).toMatchObject({
      status: "completed",
      result: "noop",
      code: "NO_ACTIVE_OWNED_RESOURCE",
      errorCode: "NO_ACTIVE_OWNED_RESOURCE",
      sessionId: "manual-shell",
    });
  });

  it("returns a structured no-op for resources owned by a different session", async () => {
    const ownerExec = createExecTool({
      allowBackground: true,
      sessionKey: "agent:main:owner",
    });
    const ownerProcess = createProcessTool({ sessionKey: "agent:main:owner" });
    const otherProcess = createProcessTool({ sessionKey: "agent:main:other" });

    const spawned = await ownerExec.execute("call-owner-spawn", {
      command: longDelayCmd,
      background: true,
    });
    const sessionId = (spawned.details as { sessionId: string }).sessionId;

    const denied = await otherProcess.execute("call-other-remove", {
      action: "remove",
      sessionId,
    });

    expect(denied.details).toMatchObject({
      status: "completed",
      result: "noop",
      code: "NO_ACTIVE_OWNED_RESOURCE",
      sessionId,
    });

    await ownerProcess.execute("call-owner-cleanup", {
      action: "remove",
      sessionId,
      discard: true,
    });
  });

  it("filters process list to resources owned by the current session", async () => {
    const execA = createExecTool({
      allowBackground: true,
      sessionKey: "agent:main:a",
    });
    const execB = createExecTool({
      allowBackground: true,
      sessionKey: "agent:main:b",
    });
    const processA = createProcessTool({ sessionKey: "agent:main:a" });
    const processB = createProcessTool({ sessionKey: "agent:main:b" });

    const spawnedA = await execA.execute("call-list-a", {
      command: longDelayCmd,
      background: true,
    });
    const spawnedB = await execB.execute("call-list-b", {
      command: longDelayCmd,
      background: true,
    });
    const sessionA = (spawnedA.details as { sessionId: string }).sessionId;
    const sessionB = (spawnedB.details as { sessionId: string }).sessionId;

    const listA = await processA.execute("call-list-owned-a", { action: "list" });
    const sessionsA = (listA.details as { sessions: Array<{ sessionId: string }> }).sessions;
    expect(sessionsA.some((session) => session.sessionId === sessionA)).toBe(true);
    expect(sessionsA.some((session) => session.sessionId === sessionB)).toBe(false);

    await processA.execute("call-list-cleanup-a", {
      action: "remove",
      sessionId: sessionA,
      discard: true,
    });
    await processB.execute("call-list-cleanup-b", {
      action: "remove",
      sessionId: sessionB,
      discard: true,
    });
  });

  it("refuses to kill a running owned session without discard=true, then allows explicit discard", async () => {
    const execTool = createExecTool({
      allowBackground: true,
      sessionKey: "agent:main:main",
    });
    const processTool = createProcessTool({ sessionKey: "agent:main:main" });

    const spawned = await execTool.execute("call-kill-spawn", {
      command: longDelayCmd,
      background: true,
    });
    const sessionId = (spawned.details as { sessionId: string }).sessionId;

    const refused = await processTool.execute("call-kill-refuse", {
      action: "kill",
      sessionId,
    });
    expect(refused.details).toMatchObject({
      status: "failed",
      errorCode: "destructive_action_blocked",
      verificationStatus: "unsafe",
      discardRequired: true,
      sessionId,
    });

    const log = await processTool.execute("call-kill-still-running", {
      action: "log",
      sessionId,
    });
    expect((log.details as { status: string }).status).toBe("running");

    const killed = await processTool.execute("call-kill-discard", {
      action: "kill",
      sessionId,
      discard: true,
    });
    expect(killed.details).toMatchObject({
      status: "completed",
      result: "killed",
      sessionId,
    });

    await sleep(20);
  });
});
