import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import {
  assertAgentContext,
  bindAgentContext,
  getAgentId,
  getAgentName,
  getAgentContext,
  getParentSessionId,
  getTeamName,
  isInProcessAgent,
  isPlanModeRequired,
  resolveAgentRuntimeCwd,
  runWithAgentContext,
} from "./runtime-context.js";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("agent runtime context", () => {
  it("restores nested contexts correctly", async () => {
    await runWithAgentContext({ agentId: "outer", cwd: "/tmp/outer" }, async () => {
      expect(assertAgentContext().agentId).toBe("outer");

      await runWithAgentContext({ agentId: "inner", cwd: "/tmp/inner" }, async () => {
        expect(assertAgentContext().agentId).toBe("inner");
        expect(resolveAgentRuntimeCwd()).toBe("/tmp/inner");
      });

      expect(assertAgentContext().agentId).toBe("outer");
      expect(resolveAgentRuntimeCwd()).toBe("/tmp/outer");
    });

    expect(getAgentContext()).toBeUndefined();
  });

  it("survives await boundaries", async () => {
    const agentId = await runWithAgentContext({ agentId: "await-agent" }, async () => {
      await delay(5);
      return assertAgentContext().agentId;
    });

    expect(agentId).toBe("await-agent");
  });

  it("survives Promise.all without cross-talk", async () => {
    const [first, second] = await Promise.all([
      runWithAgentContext({ agentId: "first" }, async () => {
        await delay(10);
        return assertAgentContext().agentId;
      }),
      runWithAgentContext({ agentId: "second" }, async () => {
        await delay(1);
        return assertAgentContext().agentId;
      }),
    ]);

    expect(first).toBe("first");
    expect(second).toBe("second");
  });

  it("propagates scheduling context to detached callbacks", async () => {
    const inherited = await runWithAgentContext({ agentId: "detached" }, async () => {
      return await new Promise<string | null>((resolve) => {
        setTimeout(
          bindAgentContext(() => {
            resolve(assertAgentContext().agentId);
          }),
          0,
        );
      });
    });

    expect(inherited).toBe("detached");
  });

  it("inherits parent context when called with undefined", async () => {
    await runWithAgentContext({ agentId: "outer", cwd: "/tmp/outer" }, async () => {
      const inherited = await runWithAgentContext(undefined, async () => {
        return assertAgentContext();
      });

      expect(inherited.agentId).toBe("outer");
      expect(inherited.cwd).toBe(path.resolve("/tmp/outer"));
      expect(assertAgentContext().agentId).toBe("outer");
    });
  });

  it("keeps concurrent turns isolated", async () => {
    const results = await Promise.all(
      ["turn-a", "turn-b"].map((turnId, index) =>
        runWithAgentContext({ turnId, agentId: `agent-${index}` }, async () => {
          await delay(index === 0 ? 15 : 5);
          return {
            turnId: assertAgentContext().turnId,
            agentId: assertAgentContext().agentId,
          };
        }),
      ),
    );

    expect(results).toEqual([
      { turnId: "turn-a", agentId: "agent-0" },
      { turnId: "turn-b", agentId: "agent-1" },
    ]);
  });

  it("keeps concurrent in-process agent metadata isolated", async () => {
    const release = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((next) => {
        resolve = next;
      });
      return { promise, resolve };
    })();
    const ready = new Set<string>();

    const runConcurrent = (agentId: string, agentDir: string) =>
      runWithAgentContext(
        {
          sessionId: `session-${agentId}`,
          agentId,
          agentName: `Agent ${agentId.toUpperCase()}`,
          teamName: "runtime-team",
          parentSessionId: `parent-${agentId}`,
          cwd: agentDir,
          agentDir,
          isInProcess: true,
          planModeRequired: agentId === "b",
        },
        async () => {
          ready.add(agentId);
          if (ready.size === 2) {
            release.resolve();
          }
          await release.promise;
          await Promise.resolve();
          return {
            agentId: getAgentId(),
            agentName: getAgentName(),
            teamName: getTeamName(),
            parentSessionId: getParentSessionId(),
            cwd: resolveAgentRuntimeCwd(),
            agentDir: resolveOpenClawAgentDir(),
            isInProcess: isInProcessAgent(),
            planModeRequired: isPlanModeRequired(),
          };
        },
      );

    const [agentA, agentB] = await Promise.all([
      runConcurrent("a", "/tmp/openclaw-agent-a"),
      runConcurrent("b", "/tmp/openclaw-agent-b"),
    ]);

    expect(agentA).toEqual({
      agentId: "a",
      agentName: "Agent A",
      teamName: "runtime-team",
      parentSessionId: "parent-a",
      cwd: path.resolve("/tmp/openclaw-agent-a"),
      agentDir: path.resolve("/tmp/openclaw-agent-a"),
      isInProcess: true,
      planModeRequired: false,
    });
    expect(agentB).toEqual({
      agentId: "b",
      agentName: "Agent B",
      teamName: "runtime-team",
      parentSessionId: "parent-b",
      cwd: path.resolve("/tmp/openclaw-agent-b"),
      agentDir: path.resolve("/tmp/openclaw-agent-b"),
      isInProcess: true,
      planModeRequired: true,
    });
  });
});
