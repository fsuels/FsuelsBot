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

    const result = await runWithAgentContext({ sessionId: "exec-test", cwd }, async () =>
      runCommandWithTimeout([process.execPath, "-e", "process.stdout.write(process.cwd())"], {
        timeoutMs: 5_000,
      }),
    );

    expect(result.code).toBe(0);
    expect(path.resolve(result.stdout)).toBe(path.resolve(cwd));
  });
});
