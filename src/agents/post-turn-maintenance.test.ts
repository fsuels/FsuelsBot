import { describe, expect, it } from "vitest";
import {
  createPostTurnMaintenanceManager,
  shouldSchedulePostTurnMaintenance,
  type PostTurnMaintenanceContext,
} from "./post-turn-maintenance.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeContext(
  sessionKey: string,
  overrides: Partial<PostTurnMaintenanceContext> = {},
): PostTurnMaintenanceContext {
  return {
    sessionId: `${sessionKey}-id`,
    sessionKey,
    sessionFile: `/tmp/${sessionKey}.jsonl`,
    workspaceDir: "/tmp/workspace",
    provider: "openai",
    model: "gpt-test",
    messagesSnapshot: [],
    ...overrides,
  };
}

describe("shouldSchedulePostTurnMaintenance", () => {
  it("only schedules completed primary turns on main sessions", () => {
    expect(
      shouldSchedulePostTurnMaintenance({
        runPurpose: "primary_user",
        sessionKey: "agent:main:test",
        resultMeta: { durationMs: 1 },
      }),
    ).toBe(true);

    expect(
      shouldSchedulePostTurnMaintenance({
        runPurpose: "background",
        sessionKey: "agent:main:test",
        resultMeta: { durationMs: 1 },
      }),
    ).toBe(false);

    expect(
      shouldSchedulePostTurnMaintenance({
        runPurpose: "primary_user",
        sessionKey: "agent:main:subagent:worker",
        resultMeta: { durationMs: 1 },
      }),
    ).toBe(false);

    expect(
      shouldSchedulePostTurnMaintenance({
        runPurpose: "primary_user",
        sessionKey: "agent:main:test",
        resultMeta: { durationMs: 1, stopReason: "tool_calls" },
      }),
    ).toBe(false);

    expect(
      shouldSchedulePostTurnMaintenance({
        runPurpose: "primary_user",
        sessionKey: "agent:main:test",
        resultMeta: {
          durationMs: 1,
          pendingToolCalls: [{ id: "call_1", name: "read", arguments: "{}" }],
        },
      }),
    ).toBe(false);
  });
});

describe("createPostTurnMaintenanceManager", () => {
  it("coalesces overlapping schedules and keeps only the latest trailing context", async () => {
    const firstStarted = deferred<void>();
    const allowFirstToFinish = deferred<void>();
    const seenTaskIds: string[] = [];
    const manager = createPostTurnMaintenanceManager([
      {
        name: "test-job",
        run: async (context) => {
          seenTaskIds.push(context.taskId ?? "none");
          if (context.taskId === "first") {
            firstStarted.resolve();
            await allowFirstToFinish.promise;
          }
        },
      },
    ]);

    manager.schedule(makeContext("agent:main:test", { taskId: "first" }));
    await firstStarted.promise;
    manager.schedule(makeContext("agent:main:test", { taskId: "second" }));
    manager.schedule(makeContext("agent:main:test", { taskId: "third" }));

    allowFirstToFinish.resolve();

    await expect(manager.drainPendingMaintenance(1_000, "agent:main:test")).resolves.toBe(true);
    expect(seenTaskIds).toEqual(["first", "third"]);
  });

  it("drains one queue without waiting for unrelated queues", async () => {
    const queueABlocked = deferred<void>();
    const queueBBlocked = deferred<void>();
    const queueAStarted = deferred<void>();
    const queueBStarted = deferred<void>();
    let queueBReleased = false;

    const manager = createPostTurnMaintenanceManager([
      {
        name: "test-job",
        run: async (context) => {
          if (context.sessionKey === "agent:main:a") {
            queueAStarted.resolve();
            await queueABlocked.promise;
            return;
          }
          queueBStarted.resolve();
          await queueBBlocked.promise;
          queueBReleased = true;
        },
      },
    ]);

    manager.schedule(makeContext("agent:main:a"));
    manager.schedule(makeContext("agent:main:b"));

    await Promise.all([queueAStarted.promise, queueBStarted.promise]);

    const drainA = manager.drainPendingMaintenance(1_000, "agent:main:a");
    queueABlocked.resolve();

    await expect(drainA).resolves.toBe(true);
    expect(queueBReleased).toBe(false);

    queueBBlocked.resolve();
    await expect(manager.drainPendingMaintenance(1_000, "agent:main:b")).resolves.toBe(true);
  });

  it("creates fresh isolated state for each manager instance", async () => {
    const blocker = deferred<void>();
    const started = deferred<void>();
    const managerA = createPostTurnMaintenanceManager([
      {
        name: "test-job",
        run: async () => {
          started.resolve();
          await blocker.promise;
        },
      },
    ]);
    const managerB = createPostTurnMaintenanceManager([]);

    managerA.schedule(makeContext("agent:main:a"));
    await started.promise;

    await expect(managerB.drainPendingMaintenance(10)).resolves.toBe(true);

    blocker.resolve();
    await expect(managerA.drainPendingMaintenance(1_000, "agent:main:a")).resolves.toBe(true);
  });
});
