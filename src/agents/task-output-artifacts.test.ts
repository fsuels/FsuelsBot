import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { resolveTaskOutputPath, writeTaskOutputArtifact } from "./task-output-artifacts.js";
import { getTaskOutput } from "./task-output.js";

function isSymlinkUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code =
    "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  return code === "EPERM" || code === "EACCES" || code === "ENOTSUP";
}

describe("task output artifacts", () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-artifacts-"));
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

  it("does not follow symlinked task output artifacts on write", async () => {
    if (!tempStateDir) {
      throw new Error("missing temp state dir");
    }

    const taskId = "shell-symlink-write";
    const outputPath = resolveTaskOutputPath({ taskId, taskType: "shell" });
    const escapedPath = path.join(tempStateDir, "escaped-output.json");
    await fs.writeFile(escapedPath, "outside\n", "utf8");

    try {
      await fs.symlink(escapedPath, outputPath);
    } catch (error) {
      if (isSymlinkUnavailable(error)) {
        return;
      }
      throw error;
    }

    const ok = writeTaskOutputArtifact({
      task_id: taskId,
      task_type: "shell",
      status: "running",
      description: "symlink test",
      output_path: outputPath,
      stdout: "should not overwrite",
    });

    expect(ok).toBe(false);
    expect(await fs.readFile(escapedPath, "utf8")).toBe("outside\n");
    expect((await fs.lstat(outputPath)).isSymbolicLink()).toBe(true);
  });

  it("surfaces a diagnostic task when the persisted artifact is corrupt", async () => {
    const taskId = "shell-corrupt-artifact";
    const outputPath = resolveTaskOutputPath({ taskId, taskType: "shell" });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, "{not-json\n", "utf8");

    const result = await getTaskOutput({ task_id: taskId, block: false });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: taskId,
        task_type: "shell",
        status: "error",
        output_path: outputPath,
        metadata: {
          durable_read_failure: true,
          durable_read_failure_kind: "output",
        },
      },
    });
    expect(result.task?.error).toContain(outputPath);
    expect(result.task?.error).toContain("invalid JSON");
  });

  it("surfaces a diagnostic task instead of following symlinked artifacts on read", async () => {
    if (!tempStateDir) {
      throw new Error("missing temp state dir");
    }

    const taskId = "shell-symlink-read";
    const outputPath = resolveTaskOutputPath({ taskId, taskType: "shell" });
    const escapedPath = path.join(tempStateDir, "escaped-read.json");
    await fs.writeFile(
      escapedPath,
      JSON.stringify({
        task_id: taskId,
        task_type: "shell",
        status: "success",
        description: "outside",
        stdout: "should not leak",
      }),
      "utf8",
    );

    try {
      await fs.symlink(escapedPath, outputPath);
    } catch (error) {
      if (isSymlinkUnavailable(error)) {
        return;
      }
      throw error;
    }

    const result = await getTaskOutput({ task_id: taskId, block: false });

    expect(result).toMatchObject({
      retrieval_status: "success",
      task: {
        task_id: taskId,
        task_type: "shell",
        status: "error",
        output_path: outputPath,
        metadata: {
          durable_read_failure: true,
          durable_read_failure_kind: "output",
        },
      },
    });
    expect(result.task?.stdout).toBeUndefined();
    expect(result.task?.error).toContain("could not be read");
  });
});
