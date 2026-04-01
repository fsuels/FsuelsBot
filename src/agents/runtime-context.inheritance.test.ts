import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAgentContext,
  resolveAgentContextPath,
  resolveAgentRuntimeCwd,
  runWithAgentContext,
} from "./runtime-context.js";

describe("runWithAgentContext inheritance", () => {
  it("inherits parent values across async boundaries and restores after nested errors", async () => {
    const parentCwd = path.resolve("/tmp/openclaw-parent-worktree");
    const childCwd = path.resolve(parentCwd, "sandbox");
    const repoRoot = path.resolve("/tmp/openclaw-repo");

    expect(getAgentContext()).toBeUndefined();

    await runWithAgentContext(
      {
        sessionId: "session-parent",
        agentId: "agent-parent",
        cwd: parentCwd,
        repoRoot,
      },
      async () => {
        expect(resolveAgentRuntimeCwd()).toBe(parentCwd);
        expect(resolveAgentContextPath("notes/todo.md")).toBe(
          path.join(parentCwd, "notes/todo.md"),
        );

        await Promise.resolve();
        expect(getAgentContext()).toMatchObject({
          sessionId: "session-parent",
          agentId: "agent-parent",
          cwd: parentCwd,
          repoRoot,
        });

        await new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            try {
              expect(getAgentContext()).toMatchObject({
                sessionId: "session-parent",
                agentId: "agent-parent",
                cwd: parentCwd,
              });
              resolve();
            } catch (error) {
              reject(error);
            }
          }, 0);
        });

        await expect(
          runWithAgentContext(
            {
              agentId: "agent-child",
              cwd: childCwd,
            },
            async () => {
              expect(getAgentContext()).toMatchObject({
                sessionId: "session-parent",
                agentId: "agent-child",
                cwd: childCwd,
                repoRoot,
              });
              await Promise.resolve();
              throw new Error("nested failure");
            },
          ),
        ).rejects.toThrow("nested failure");

        expect(getAgentContext()).toMatchObject({
          sessionId: "session-parent",
          agentId: "agent-parent",
          cwd: parentCwd,
          repoRoot,
        });
      },
    );

    expect(getAgentContext()).toBeUndefined();
  });
});
