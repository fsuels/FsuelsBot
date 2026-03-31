import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStorePath, saveSessionStore } from "../config/sessions.js";
import {
  addSession,
  appendOutput,
  getFinishedSession,
  markExited,
  resetProcessRegistryForTests,
  sweepProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";
import {
  addSubagentRunForTests,
  getSubagentRun,
  resetSubagentRegistryForTests,
} from "./subagent-registry.js";
import { resolveTaskOutputPath, resolveTaskTranscriptPath } from "./task-output-artifacts.js";
import { getTaskOutput } from "./task-output.js";
import { createGetTaskOutputTool, createTaskOutputTools } from "./tools/get-task-output-tool.js";

function createBackgroundShellSession(id: string, command = `echo ${id}`): ProcessSession {
  return {
    id,
    command,
    description: command,
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

describe("task output runtime", () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-output-"));
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

  it("stores agent transcript_path separately from final_text", async () => {
    if (!tempStateDir) {
      throw new Error("missing temp state dir");
    }

    const runId = "agent-task-1";
    const transcriptPath = path.join(tempStateDir, "session-logs", "child-session.jsonl");
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({ role: "assistant", text: "thinking..." }),
        JSON.stringify({ role: "tool", name: "exec", args: { command: "echo noisy" } }),
        JSON.stringify({ role: "assistant", text: "Clean final answer" }),
      ].join("\n") + "\n",
      "utf8",
    );

    addSubagentRunForTests({
      runId,
      childSessionKey: "agent:main:subagent:test",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Summarize the transcript",
      cleanup: "keep",
      createdAt: Date.now(),
      startedAt: Date.now(),
      endedAt: Date.now(),
      outcome: { status: "ok" },
      transcriptPath,
      finalText: "Clean final answer",
      notified: false,
    });

    const task = getSubagentRun(runId);
    expect(task?.outputPath).toBeTruthy();
    const outputPath = task?.outputPath;
    if (!outputPath) {
      throw new Error("missing output path");
    }

    const outputArtifact = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
      final_text?: string;
      transcript_path?: string;
    };
    expect(outputArtifact.final_text).toBe("Clean final answer");
    expect(outputArtifact.transcript_path).toBe(transcriptPath);

    const transcript = await fs.readFile(transcriptPath, "utf8");
    expect(transcript).toContain('"name":"exec"');
    expect(transcript).toContain("thinking...");

    const result = await getTaskOutput({ task_id: runId, block: false });
    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: runId,
        task_type: "agent",
        final_text: "Clean final answer",
        transcript_path: transcriptPath,
      },
    });
  });

  it("includes structured subagent metadata and usage in task output", async () => {
    const runId = "agent-task-metadata";
    const childSessionKey = "agent:main:subagent:metadata";
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    await saveSessionStore(storePath, {
      [childSessionKey]: {
        sessionId: "child-session",
        updatedAt: Date.now(),
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      },
    });

    addSubagentRunForTests({
      runId,
      childSessionKey,
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Verify the retry fix independently.",
      taskSummary: "Verify the retry fix independently.",
      taskType: "verification",
      filePaths: ["src/auth/retry.ts"],
      sourceTaskId: "run-impl",
      allowFileChanges: false,
      cleanup: "keep",
      profile: "test-runner",
      requiredTools: ["read", "exec"],
      resolvedTools: ["read", "exec"],
      createdAt: 1_000,
      startedAt: 2_000,
      endedAt: 5_000,
      outcome: { status: "ok" },
      finalText: "Verified the retry fix with regression evidence.",
      notified: false,
    });

    const result = await getTaskOutput({ task_id: runId, block: false });
    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: runId,
        task_type: "agent",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
          duration_ms: 3000,
        },
        metadata: {
          task_type: "verification",
          profile: "test-runner",
          file_paths: ["src/auth/retry.ts"],
          source_task_id: "run-impl",
          allow_file_changes: false,
          required_tools: ["read", "exec"],
          resolved_tools: ["read", "exec"],
        },
      },
    });
  });

  it("returns not_ready for running tasks when block=false", async () => {
    const task = createBackgroundShellSession("shell-running");
    addSession(task);

    const tool = createGetTaskOutputTool();
    const result = await tool.execute("task-output-1", {
      task_id: task.id,
      block: false,
    });

    expect(result.details).toMatchObject({
      retrieval_status: "not_ready",
      task: {
        task_id: task.id,
        task_type: "shell",
        status: "running",
      },
    });
  });

  it("returns success for completed tasks when block=true", async () => {
    const task = createBackgroundShellSession("shell-complete", "printf done");
    addSession(task);
    appendOutput(task, "stdout", "done\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    const tool = createGetTaskOutputTool();
    const result = await tool.execute("task-output-2", {
      task_id: task.id,
      block: true,
    });

    expect(result.details).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        status: "success",
        stdout: "done\n",
      },
    });
  });

  it("replays shell task state from transcript after a crash", async () => {
    const task = createBackgroundShellSession("shell-resume", "printf resume");
    addSession(task);
    appendOutput(task, "stdout", "resume\n");
    appendOutput(task, "stderr", "warn\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    const outputPath = resolveTaskOutputPath({ taskId: task.id, taskType: "shell" });
    await fs.rm(outputPath, { force: true });

    resetProcessRegistryForTests();

    const result = await getTaskOutput({ task_id: task.id, block: false });
    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        task_type: "shell",
        status: "success",
        stdout: "resume\n",
        stderr: "warn\n",
        transcript_path: resolveTaskTranscriptPath({ taskId: task.id, taskType: "shell" }),
      },
    });
  });

  it("returns timeout when a running task does not complete", async () => {
    const task = createBackgroundShellSession("shell-timeout");
    addSession(task);

    const result = await getTaskOutput({
      task_id: task.id,
      block: true,
      timeout_ms: 30,
    });

    expect(result).toMatchObject({
      retrieval_status: "timeout",
      task: {
        task_id: task.id,
        status: "running",
      },
    });
  });

  it("returns not_ready when waiting is aborted", async () => {
    const task = createBackgroundShellSession("shell-abort");
    addSession(task);
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 20);

    const result = await getTaskOutput({
      task_id: task.id,
      block: true,
      timeout_ms: 1_000,
      signal: abortController.signal,
    });

    expect(result).toMatchObject({
      retrieval_status: "not_ready",
      task: {
        task_id: task.id,
        status: "running",
      },
    });
  });

  it("returns not_found for unknown task ids", async () => {
    const result = await getTaskOutput({
      task_id: "missing-task",
      block: false,
    });

    expect(result).toEqual({
      retrieval_status: "not_found",
      task: null,
    });
  });

  it("preserves shell stdout, stderr, and exit_code separately", async () => {
    const task = createBackgroundShellSession("shell-streams", "printf out; printf err >&2");
    addSession(task);
    appendOutput(task, "stdout", "out\n");
    appendOutput(task, "stderr", "err\n");
    markExited(task, 7, null, "failed", {
      terminalReason: "error",
      error: "Process exited with code 7.",
    });

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        status: "error",
        stdout: "out\n",
        stderr: "err\n",
        exit_code: 7,
        error: "Process exited with code 7.",
      },
    });
  });

  it("keeps the deprecated alias wired to the same implementation", async () => {
    const task = createBackgroundShellSession("shell-alias", "printf aliased");
    addSession(task);
    appendOutput(task, "stdout", "aliased\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    const tools = createTaskOutputTools();
    const aliasTool = tools.find((tool) => tool.name === "task_output");
    const canonicalTool = tools.find((tool) => tool.name === "get_task_output");
    if (!aliasTool || !canonicalTool) {
      throw new Error("missing task output tools");
    }

    const aliasResult = await aliasTool.execute("task-output-3", { taskId: task.id });
    const canonicalResult = await canonicalTool.execute("task-output-4", { task_id: task.id });

    expect(aliasResult.details).toMatchObject({
      retrieval_status: "success",
      task: canonicalResult.details.task,
      deprecation: {
        alias: "task_output",
        canonical: "get_task_output",
      },
    });
  });

  it("marks completed retrievals as notified", async () => {
    const task = createBackgroundShellSession("shell-notified", "printf notified");
    addSession(task);
    appendOutput(task, "stdout", "notified\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        notified: true,
      },
    });
    expect(getFinishedSession(task.id)?.notified).toBe(true);
  });

  it("falls back to persisted artifacts when in-memory shell state is gone", async () => {
    const task = createBackgroundShellSession("shell-durable", "printf durable");
    addSession(task);
    appendOutput(task, "stdout", "durable\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    resetProcessRegistryForTests();

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        task_type: "shell",
        status: "success",
        stdout: "durable\n",
      },
    });
  });

  it("marks disk-backed artifact retrievals as notified", async () => {
    const task = createBackgroundShellSession("shell-durable-notified", "printf durable");
    addSession(task);
    appendOutput(task, "stdout", "durable\n");
    markExited(task, 0, null, "completed", { terminalReason: "completed" });

    resetProcessRegistryForTests();

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: task.id,
        notified: true,
      },
    });

    const persisted = JSON.parse(
      await fs.readFile(resolveTaskOutputPath({ taskId: task.id, taskType: "shell" }), "utf8"),
    ) as { notified?: boolean };
    expect(persisted.notified).toBe(true);
  });

  it("returns running partial output from persisted artifacts", async () => {
    const task = createBackgroundShellSession("shell-durable-running", "printf partial");
    addSession(task);
    appendOutput(task, "stdout", "partial\n");

    resetProcessRegistryForTests();

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "not_ready",
      task: {
        task_id: task.id,
        task_type: "shell",
        status: "running",
        stdout: "partial\n",
      },
    });
  });

  it("surfaces awaiting_input when a background shell stalls on an interactive prompt", async () => {
    const task = createBackgroundShellSession("shell-awaiting-input", "npm install");
    addSession(task);
    appendOutput(task, "stdout", "Continue? [y/n]\n");
    task.lastOutputAt = Date.now() - 60_000;
    sweepProcessRegistryForTests();

    const result = await getTaskOutput({
      task_id: task.id,
      block: false,
    });

    expect(result).toMatchObject({
      retrieval_status: "not_ready",
      task: {
        task_id: task.id,
        status: "awaiting_input",
        awaiting_input: {
          reason: "interactive confirmation prompt",
          prompt: "Continue? [y/n]",
        },
      },
    });
  });

  it("emits a waiting_for_task progress update while blocking", async () => {
    const task = createBackgroundShellSession("shell-progress");
    addSession(task);
    const updates: unknown[] = [];

    const tool = createGetTaskOutputTool();
    const result = await tool.execute(
      "task-output-5",
      {
        task_id: task.id,
        block: true,
        timeout_ms: 30,
      },
      undefined,
      (update) => {
        updates.push(update);
      },
    );

    expect(updates[0]).toMatchObject({
      details: {
        type: "waiting_for_task",
        task_id: task.id,
        task_type: "shell",
        description: task.command,
      },
    });
    expect(result.details).toMatchObject({
      retrieval_status: "timeout",
    });
  });
});
