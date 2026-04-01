import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runWithAgentContext } from "../agents/runtime-context.js";
import { runCommandWithTimeout } from "./exec.js";

describe("runCommandWithTimeout", () => {
  it("passes env overrides to child", async () => {
    const result = await runCommandWithTimeout(
      [process.execPath, "-e", 'process.stdout.write(process.env.OPENCLAW_TEST_ENV ?? "")'],
      {
        timeoutMs: 5_000,
        env: { OPENCLAW_TEST_ENV: "ok" },
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("merges custom env with process.env", async () => {
    const previous = process.env.OPENCLAW_BASE_ENV;
    process.env.OPENCLAW_BASE_ENV = "base";
    try {
      const result = await runCommandWithTimeout(
        [
          process.execPath,
          "-e",
          'process.stdout.write((process.env.OPENCLAW_BASE_ENV ?? "") + "|" + (process.env.OPENCLAW_TEST_ENV ?? ""))',
        ],
        {
          timeoutMs: 5_000,
          env: { OPENCLAW_TEST_ENV: "ok" },
        },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("base|ok");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_BASE_ENV;
      } else {
        process.env.OPENCLAW_BASE_ENV = previous;
      }
    }
  });

  it("uses the active agent runtime cwd when no explicit cwd is provided", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-exec-cwd-"));

    try {
      const result = await runWithAgentContext({ sessionId: "exec-test", cwd }, async () =>
        runCommandWithTimeout([process.execPath, "-e", "process.stdout.write(process.cwd())"], {
          timeoutMs: 5_000,
        }),
      );

      expect(result.code).toBe(0);
      expect(await fs.realpath(result.stdout)).toBe(await fs.realpath(cwd));
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it(
    "resolves after child exit even when a grandchild keeps stdio open",
    { timeout: 15_000 },
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-exec-test-"));
      const pidFile = path.join(tmpDir, "grandchild.pid");
      let outputDir: string | null = null;

      try {
        const startedAt = Date.now();
        const result = await runCommandWithTimeout(
          [
            process.execPath,
            "-e",
            [
              "const { spawn } = require('node:child_process');",
              "const { writeFileSync } = require('node:fs');",
              `const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { stdio: 'inherit' });`,
              `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
              "process.exit(0);",
            ].join(" "),
          ],
          { timeoutMs: 5_000, postExitDrainMs: 10 },
        );

        outputDir = result.outputFilePath ? path.dirname(result.outputFilePath) : null;
        expect(result.code).toBe(0);
        expect(Date.now() - startedAt).toBeLessThan(1_000);

        const grandchildPid = Number((await fs.readFile(pidFile, "utf8")).trim());
        expect(Number.isFinite(grandchildPid)).toBe(true);
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // Already exited.
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
        if (outputDir) {
          await fs.rm(outputDir, { recursive: true, force: true });
        }
      }
    },
  );

  it("falls back to the startup cwd when the current cwd was deleted", async () => {
    const originalCwd = process.cwd();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-exec-cwd-"));
    let outputDir: string | null = null;
    process.chdir(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });

    try {
      const result = await runCommandWithTimeout(
        [process.execPath, "-e", "process.stdout.write(process.cwd())"],
        { timeoutMs: 5_000 },
      );

      outputDir = result.outputFilePath ? path.dirname(result.outputFilePath) : null;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(originalCwd);
      expect(result.cwd).toBe(originalCwd);
    } finally {
      process.chdir(originalCwd);
      if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  });

  it("spills large output to disk when inline capture is capped", async () => {
    let outputDir: string | null = null;
    try {
      const result = await runCommandWithTimeout(
        [process.execPath, "-e", 'process.stdout.write("x".repeat(300000))'],
        { timeoutMs: 5_000, inlineOutputLimitBytes: 4_096 },
      );

      outputDir = result.outputFilePath ? path.dirname(result.outputFilePath) : null;
      expect(result.code).toBe(0);
      expect(result.stdout.length).toBe(4_096);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.outputFilePath).toBeTruthy();
      expect(result.stdoutFilePath).toBeTruthy();
      expect(result.outputFileSize).toBeGreaterThanOrEqual(300_000);

      const captured = await fs.readFile(result.stdoutFilePath as string, "utf8");
      expect(captured.length).toBe(300_000);
    } finally {
      if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  });

  it("kills the full process tree on timeout", { timeout: 15_000 }, async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-exec-timeout-"));
    const pidFile = path.join(tmpDir, "worker.pid");
    let outputDir: string | null = null;

    try {
      const result = await runCommandWithTimeout(
        [
          process.execPath,
          "-e",
          [
            "const { spawn } = require('node:child_process');",
            "const { writeFileSync } = require('node:fs');",
            `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
            `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
            "setInterval(() => {}, 1000);",
          ].join(" "),
        ],
        { timeoutMs: 150, postExitDrainMs: 10 },
      );

      outputDir = result.outputFilePath ? path.dirname(result.outputFilePath) : null;
      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);

      const workerPid = Number((await fs.readFile(pidFile, "utf8")).trim());
      expect(Number.isFinite(workerPid)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));
      let alive = true;
      try {
        process.kill(workerPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  });
});
