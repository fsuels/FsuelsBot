import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitMemoryEvents,
  getTaskRegistryTask,
  linkTaskRegistryTasks,
  listTaskRegistry,
  listTransientBufferItems,
  listWalEvents,
  applyWalRetentionPolicy,
  pruneExpiredTransientBufferItems,
  readWalDiagnostics,
  repairWalCorruptTail,
  rebuildSnapshotFromWal,
  readSnapshot,
  setTaskRegistryStatus,
  upsertTaskRegistryTask,
  upsertTransientBufferItem,
  validateSnapshotAgainstWal,
} from "./task-memory-system.js";

function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeJson(entry)}`)
      .join(",")}}`;
  }
  return "null";
}

function resignWalRecord(
  event: Record<string, unknown>,
  options: { secret: string; prevSignature?: string },
): Record<string, unknown> {
  const envelope = {
    envelopeVersion: 1,
    eventId: event.eventId,
    scope: event.scope,
    taskId: typeof event.taskId === "string" ? event.taskId : null,
    type: event.type,
    payload: event.payload,
    timestamp: new Date(Math.floor(Number(event.timestamp))).toISOString(),
    actor: event.actor,
    prevSignature: options.prevSignature ?? null,
  };
  const signature = crypto
    .createHmac("sha256", options.secret)
    .update(canonicalizeJson(envelope))
    .digest("hex");
  const integrityHash = crypto
    .createHash("sha256")
    .update(canonicalizeJson(envelope))
    .digest("hex");
  return {
    ...event,
    signatureVersion: 1,
    ...(options.prevSignature ? { prevSignature: options.prevSignature } : {}),
    signature,
    integrityHash,
  };
}

describe("task-memory-system", () => {
  let workspaceDir = "";
  const securityEnvKeys = [
    "MEMORY_SECURITY_MODE",
    "MEMORY_ALLOW_UNSIGNED_REPLAY",
    "MEMORY_WAL_ACTIVE_SIGNING_KEY_ID",
    "MEMORY_WAL_ACTIVE_SIGNING_KEY",
    "MEMORY_WAL_VERIFICATION_KEYS_JSON",
    "MEMORY_WAL_KEY_PROVIDER",
    "MEMORY_WAL_KEYRING_JSON",
    "MEMORY_WAL_KEY_PROVIDER_COMMAND",
    "MEMORY_WAL_KEY_PROVIDER_COMMAND_TIMEOUT_MS",
    "MEMORY_WAL_KEY_ROTATION_DEPRECATION_DAYS",
    "MEMORY_WAL_KEY_ROTATION_STARTED_AT",
    "MEMORY_WAL_ALLOWED_LEGACY_KEY_IDS",
    "MEMORY_WAL_AWS_SECRET_COMMAND",
    "MEMORY_WAL_AWS_SECRET_ID",
    "MEMORY_WAL_AWS_CLI",
    "MEMORY_WAL_GCP_SECRET_COMMAND",
    "MEMORY_WAL_GCP_SECRET_NAME",
    "MEMORY_WAL_GCP_SECRET_VERSION",
    "MEMORY_WAL_GCP_CLI",
    "MEMORY_WAL_AZURE_SECRET_COMMAND",
    "MEMORY_WAL_AZURE_VAULT_NAME",
    "MEMORY_WAL_AZURE_SECRET_NAME",
    "MEMORY_WAL_AZURE_CLI",
    "MEMORY_WAL_VAULT_SECRET_COMMAND",
    "MEMORY_WAL_VAULT_SECRET_PATH",
    "MEMORY_WAL_VAULT_CLI",
    "MEMORY_WAL_VAULT_KV_VERSION",
    "MEMORY_WAL_SEGMENT_MAX_BYTES",
    "MEMORY_WAL_SEGMENT_MAX_AGE_DAYS",
    "MEMORY_WAL_RETENTION_DAYS",
  ] as const;
  let previousSecurityEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-task-memory-system-"));
    previousSecurityEnv = {};
    for (const key of securityEnvKeys) {
      previousSecurityEnv[key] = process.env[key];
    }
    process.env.MEMORY_SECURITY_MODE = "prod";
    process.env.MEMORY_ALLOW_UNSIGNED_REPLAY = "false";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:memory-wal:test:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "unit-test-secret";
    process.env.MEMORY_WAL_KEY_PROVIDER = "env";
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;
    delete process.env.MEMORY_WAL_KEYRING_JSON;
    delete process.env.MEMORY_WAL_SEGMENT_MAX_BYTES;
    delete process.env.MEMORY_WAL_SEGMENT_MAX_AGE_DAYS;
    delete process.env.MEMORY_WAL_RETENTION_DAYS;
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    for (const key of securityEnvKeys) {
      const prev = previousSecurityEnv[key];
      if (prev == null) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  });

  it("enforces single write scope per turn", async () => {
    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "global",
        actor: "agent",
        events: [{ type: "GOAL_SET", scope: "task", taskId: "task-a", payload: { goal: "x" } }],
      }),
    ).rejects.toThrow(/single write scope invariant/i);
  });

  it("treats writeScope=none as a strict storage no-op", async () => {
    const task = await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
      now: 1_000,
    });

    const result = await commitMemoryEvents({
      workspaceDir,
      writeScope: "none",
      taskId: "task-a",
      actor: "agent",
      events: [],
      now: 2_000,
    });

    expect(result.committed).toEqual([]);

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    await expect(fs.stat(walPath)).rejects.toThrow();

    const taskSnapshotPath = path.join(workspaceDir, "memory/system/snapshots/tasks/task-a.json");
    await expect(fs.stat(taskSnapshotPath)).rejects.toThrow();

    const globalSnapshotPath = path.join(workspaceDir, "memory/system/snapshots/global.json");
    await expect(fs.stat(globalSnapshotPath)).rejects.toThrow();

    const taskAfter = await getTaskRegistryTask({ workspaceDir, taskId: "task-a" });
    expect(taskAfter?.lastTouchedAt).toBe(task.lastTouchedAt);
  });

  it("commits task events to WAL and snapshot", async () => {
    const task = await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    expect(task.taskId).toBe("task-a");

    const committed = await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [
        { type: "GOAL_SET", payload: { goal: "Ship auth fix" } },
        { type: "DECISION_MADE", payload: { decision: "Use token rotation" } },
        { type: "NEXT_ACTION_SET", payload: { action: "Write migration plan" } },
      ],
    });
    expect(committed.committed).toHaveLength(3);

    const snapshot = await readSnapshot({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(snapshot.eventOffset).toBe(3);
    expect(snapshot.state.goal).toBe("Ship auth fix");
    expect(snapshot.state.decisions).toContain("Use token rotation");
    expect(snapshot.state.nextAction).toBe("Write migration plan");
  });

  it("rejects commits with invalid per-event payload schemas", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "GOAL_SET", payload: {} }],
      }),
    ).rejects.toThrow(/payload schema violation/i);
  });

  it("maintains task registry links + lifecycle state", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-a", title: "Task A" });
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-b", title: "Task B" });

    const linked = await linkTaskRegistryTasks({
      workspaceDir,
      taskId: "task-a",
      relatedTaskId: "task-b",
    });
    expect(linked.updated).toBe(true);
    expect(linked.task?.links).toContain("task-b");
    expect(linked.related?.links).toContain("task-a");

    const status = await setTaskRegistryStatus({
      workspaceDir,
      taskId: "task-b",
      status: "archived",
    });
    expect(status?.status).toBe("archived");

    const taskB = await getTaskRegistryTask({ workspaceDir, taskId: "task-b" });
    expect(taskB?.status).toBe("archived");

    const tasks = await listTaskRegistry(workspaceDir);
    expect(tasks.map((entry) => entry.taskId)).toEqual(
      expect.arrayContaining(["task-a", "task-b"]),
    );
  });

  it("fails closed when task registry JSON is corrupted", async () => {
    const registryPath = path.join(workspaceDir, "memory/system/task-registry.json");
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, "{bad-json", "utf-8");
    await expect(listTaskRegistry(workspaceDir)).rejects.toThrow(/task registry read failed/i);
  });

  it("stores and prunes transient ttl buffer items", async () => {
    const now = Date.now();
    await upsertTransientBufferItem({
      workspaceDir,
      content: "one-off otp",
      ttlMs: 10,
      relatedTaskId: "task-a",
      now,
    });
    await upsertTransientBufferItem({
      workspaceDir,
      content: "scratch note",
      ttlMs: 2000,
      now,
    });

    const before = await listTransientBufferItems({ workspaceDir, now: now + 5 });
    expect(before).toHaveLength(2);

    const removed = await pruneExpiredTransientBufferItems({
      workspaceDir,
      now: now + 20,
    });
    expect(removed).toBe(1);

    const after = await listTransientBufferItems({ workspaceDir, now: now + 20 });
    expect(after).toHaveLength(1);
    expect(after[0]?.content).toBe("scratch note");
  });

  it("rebuilds and validates snapshots from WAL replay", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const first = await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [
        { type: "GOAL_SET", payload: { goal: "Goal 1" } },
        { type: "DECISION_MADE", payload: { decision: "Use v1" } },
      ],
    });
    const second = await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "DECISION_MADE", payload: { decision: "Use v2" } }],
    });
    expect(second.committed).toHaveLength(1);

    const cutoffId = first.committed[1]?.eventId;
    if (!cutoffId) {
      throw new Error("missing cutoff event id");
    }
    const rebuilt = await rebuildSnapshotFromWal({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
      untilEventId: cutoffId,
      write: true,
    });
    expect(rebuilt.eventOffset).toBe(2);
    expect(rebuilt.state.decisions).toEqual(["Use v1"]);

    const validation = await validateSnapshotAgainstWal({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(validation.ok).toBe(false);
    expect(validation.mismatches.length).toBeGreaterThan(0);

    await rebuildSnapshotFromWal({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
      write: true,
    });
    const validAfter = await validateSnapshotAgainstWal({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(validAfter.ok).toBe(true);
  });

  it("recovers stale snapshot offsets before applying new commits", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [
        { type: "GOAL_SET", payload: { goal: "Existing goal" } },
        { type: "DECISION_MADE", payload: { decision: "Keep snapshot replay" } },
      ],
    });

    const snapshotPath = path.join(workspaceDir, "memory/system/snapshots/tasks/task-a.json");
    await fs.writeFile(
      snapshotPath,
      `${JSON.stringify(
        {
          snapshotId: "snapshot:task:task-a",
          scope: "task",
          taskId: "task-a",
          eventOffset: 0,
          state: {
            decisions: [],
            constraints: [],
            openQuestions: [],
            artifacts: [],
            pins: [],
            links: [],
          },
          updatedAt: Date.now(),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "NEXT_ACTION_SET", payload: { action: "Ship it" } }],
    });

    const snapshot = await readSnapshot({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(snapshot.eventOffset).toBe(3);
    expect(snapshot.state.goal).toBe("Existing goal");
    expect(snapshot.state.decisions).toContain("Keep snapshot replay");
    expect(snapshot.state.nextAction).toBe("Ship it");
  });

  it("rejects commits when snapshot offset is ahead of WAL", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "One" } }],
    });

    const snapshotPath = path.join(workspaceDir, "memory/system/snapshots/tasks/task-a.json");
    await fs.writeFile(
      snapshotPath,
      `${JSON.stringify(
        {
          snapshotId: "snapshot:task:task-a",
          scope: "task",
          taskId: "task-a",
          eventOffset: 99,
          state: {
            decisions: [],
            constraints: [],
            openQuestions: [],
            artifacts: [],
            pins: [],
            links: [],
          },
          updatedAt: Date.now(),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "NEXT_ACTION_SET", payload: { action: "Two" } }],
      }),
    ).rejects.toThrow(/snapshot eventOffset ahead of WAL/i);
  });

  it("rotates WAL into segment files and replays across manifest + active stream", async () => {
    process.env.MEMORY_WAL_SEGMENT_MAX_BYTES = "65536";
    process.env.MEMORY_WAL_SEGMENT_MAX_AGE_DAYS = "365";
    process.env.MEMORY_WAL_RETENTION_DAYS = "365";
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });

    const largeChunk = "x".repeat(20_000);
    for (let i = 0; i < 6; i += 1) {
      await commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [
          {
            type: "DECISION_MADE",
            payload: { decision: `decision-${i}-${largeChunk}` },
          },
        ],
      });
    }

    const segmentDir = path.join(workspaceDir, "memory/system/wal/segments");
    const segmentFiles = await fs.readdir(segmentDir);
    expect(segmentFiles.length).toBeGreaterThan(0);

    const replayed = await listWalEvents(workspaceDir);
    expect(replayed.length).toBe(6);

    const snapshot = await readSnapshot({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(snapshot.state.decisions).toEqual(
      expect.arrayContaining([`decision-0-${largeChunk}`, `decision-5-${largeChunk}`]),
    );
  });

  it("applies retention policy to prune eligible WAL segments", async () => {
    const baseNow = Date.now();
    process.env.MEMORY_WAL_SEGMENT_MAX_BYTES = "65536";
    process.env.MEMORY_WAL_SEGMENT_MAX_AGE_DAYS = "365";
    process.env.MEMORY_WAL_RETENTION_DAYS = "1";
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const largeChunk = "y".repeat(20_000);
    for (let i = 0; i < 6; i += 1) {
      await commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [
          {
            type: "DECISION_MADE",
            payload: { decision: `retention-${i}-${largeChunk}` },
          },
        ],
      });
    }
    const pruned = await applyWalRetentionPolicy({
      workspaceDir,
      now: baseNow + 10 * 24 * 60 * 60 * 1000,
    });
    expect(pruned.prunedSegments).toBeGreaterThan(0);
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "NEXT_ACTION_SET", payload: { action: "post-retention-check" } }],
    });
    const replayed = await listWalEvents(workspaceDir);
    expect(replayed.length).toBeGreaterThan(0);
  });

  it("fails closed when compacted baseline artifact signature is tampered", async () => {
    const baseNow = Date.now();
    process.env.MEMORY_WAL_SEGMENT_MAX_BYTES = "65536";
    process.env.MEMORY_WAL_SEGMENT_MAX_AGE_DAYS = "365";
    process.env.MEMORY_WAL_RETENTION_DAYS = "1";
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const largeChunk = "z".repeat(20_000);
    for (let i = 0; i < 6; i += 1) {
      await commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "DECISION_MADE", payload: { decision: `baseline-${i}-${largeChunk}` } }],
      });
    }
    const pruned = await applyWalRetentionPolicy({
      workspaceDir,
      now: baseNow + 10 * 24 * 60 * 60 * 1000,
    });
    expect(pruned.prunedSegments).toBeGreaterThan(0);

    const baselinePath = path.join(workspaceDir, "memory/system/wal/baseline.json");
    const baseline = JSON.parse(await fs.readFile(baselinePath, "utf-8")) as Record<
      string,
      unknown
    >;
    baseline.signature = "tampered";
    await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf-8");

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(
      /baseline signature mismatch|baseline missing signature/i,
    );
  });

  it("repairs corrupt WAL tails by truncating to the last valid entry", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "One" } }],
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    await fs.appendFile(walPath, '{"broken":\n', "utf-8");
    await fs.appendFile(
      walPath,
      `${JSON.stringify({
        eventId: "evt_after_corrupt",
        scope: "task",
        taskId: "task-a",
        type: "GOAL_SET",
        payload: { goal: "Two" },
        timestamp: Date.now(),
        actor: "agent",
        integrityHash: "not-real",
      })}\n`,
      "utf-8",
    );

    const before = await readWalDiagnostics(workspaceDir);
    expect(before.truncatedTail).toBe(true);
    expect(before.stopReason).toBe("invalid-json");
    expect(before.droppedLineCount).toBe(2);

    const repaired = await repairWalCorruptTail({ workspaceDir });
    expect(repaired.truncatedTail).toBe(true);

    const eventsAfterRepair = await listWalEvents(workspaceDir);
    expect(eventsAfterRepair).toHaveLength(1);

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "NEXT_ACTION_SET", payload: { action: "Continue" } }],
    });
    const finalEvents = await listWalEvents(workspaceDir);
    expect(finalEvents).toHaveLength(2);
  });

  it("fails closed in prod when signing key is missing", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;

    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "GOAL_SET", payload: { goal: "blocked" } }],
      }),
    ).rejects.toThrow(/signing key unavailable/i);
  });

  it("fails startup-level replay reads in prod when signing key is missing", async () => {
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    await expect(listWalEvents(workspaceDir)).rejects.toThrow(/signing key unavailable/i);
  });

  it("coerces invalid MEMORY_SECURITY_MODE to prod fail-closed behavior", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    process.env.MEMORY_SECURITY_MODE = "invalid-mode";
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;

    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "GOAL_SET", payload: { goal: "blocked" } }],
      }),
    ).rejects.toThrow(/prod mode/i);
  });

  it("supports json key provider with dual-read/single-write behavior", async () => {
    process.env.MEMORY_WAL_KEY_PROVIDER = "json";
    process.env.MEMORY_WAL_KEYRING_JSON = JSON.stringify({
      activeSigningKeyId: "json:memory-wal:2",
      activeSigningKey: "json-secret-2",
      verificationKeys: {
        "json:memory-wal:1": "json-secret-1",
      },
    });
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "json keys" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events[0]?.keyId).toBe("json:memory-wal:2");
  });

  it("supports command key provider as a pluggable secret-manager adapter", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const scriptPath = path.join(workspaceDir, "memory-key-provider.js");
    const providerPayload = JSON.stringify({
      activeSigningKeyId: "cmd:memory-wal:test:1",
      activeSigningKey: "cmd-provider-secret",
      verificationKeys: {
        "cmd:memory-wal:test:1": "cmd-provider-secret",
      },
    });
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(${JSON.stringify(providerPayload)});\n`,
      "utf-8",
    );

    process.env.MEMORY_WAL_KEY_PROVIDER = "command";
    process.env.MEMORY_WAL_KEY_PROVIDER_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "command-provider-signed" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.keyId).toBe("cmd:memory-wal:test:1");
    expect(events[0]?.payload).toEqual({ goal: "command-provider-signed" });
  });

  it("supports aws-sm key provider via provider command hook", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const scriptPath = path.join(workspaceDir, "aws-key-provider.js");
    const providerPayload = JSON.stringify({
      activeSigningKeyId: "aws-sm:memory-wal:test:1",
      activeSigningKey: "aws-sm-provider-secret",
      verificationKeys: {
        "aws-sm:memory-wal:test:1": "aws-sm-provider-secret",
      },
    });
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(${JSON.stringify(providerPayload)});\n`,
      "utf-8",
    );

    process.env.MEMORY_WAL_KEY_PROVIDER = "aws-sm";
    process.env.MEMORY_WAL_AWS_SECRET_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "aws-sm-provider-signed" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.keyId).toBe("aws-sm:memory-wal:test:1");
  });

  it("supports gcp-sm key provider via provider command hook", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const scriptPath = path.join(workspaceDir, "gcp-key-provider.js");
    const providerPayload = JSON.stringify({
      activeSigningKeyId: "gcp-sm:memory-wal:test:1",
      activeSigningKey: "gcp-sm-provider-secret",
      verificationKeys: {
        "gcp-sm:memory-wal:test:1": "gcp-sm-provider-secret",
      },
    });
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(${JSON.stringify(providerPayload)});\n`,
      "utf-8",
    );

    process.env.MEMORY_WAL_KEY_PROVIDER = "gcp-sm";
    process.env.MEMORY_WAL_GCP_SECRET_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "gcp-sm-provider-signed" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.keyId).toBe("gcp-sm:memory-wal:test:1");
  });

  it("supports azure-kv key provider via provider command hook", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const scriptPath = path.join(workspaceDir, "azure-key-provider.js");
    const providerPayload = JSON.stringify({
      activeSigningKeyId: "azure-kv:memory-wal:test:1",
      activeSigningKey: "azure-kv-provider-secret",
      verificationKeys: {
        "azure-kv:memory-wal:test:1": "azure-kv-provider-secret",
      },
    });
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(${JSON.stringify(providerPayload)});\n`,
      "utf-8",
    );

    process.env.MEMORY_WAL_KEY_PROVIDER = "azure-kv";
    process.env.MEMORY_WAL_AZURE_SECRET_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "azure-kv-provider-signed" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.keyId).toBe("azure-kv:memory-wal:test:1");
  });

  it("supports vault key provider via provider command hook", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const scriptPath = path.join(workspaceDir, "vault-key-provider.js");
    const providerPayload = JSON.stringify({
      activeSigningKeyId: "vault:memory-wal:test:1",
      activeSigningKey: "vault-provider-secret",
      verificationKeys: {
        "vault:memory-wal:test:1": "vault-provider-secret",
      },
    });
    await fs.writeFile(
      scriptPath,
      `process.stdout.write(${JSON.stringify(providerPayload)});\n`,
      "utf-8",
    );

    process.env.MEMORY_WAL_KEY_PROVIDER = "vault";
    process.env.MEMORY_WAL_VAULT_SECRET_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID;
    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "vault-provider-signed" } }],
    });
    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.keyId).toBe("vault:memory-wal:test:1");
  });

  it("fails closed when key rotation deprecation expires and legacy keys are still required", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-a:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-a";
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed-by-a" } }],
    });

    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-b:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-b";
    process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON = JSON.stringify({
      "env:key-a:1": "secret-a",
      "env:key-b:1": "secret-b",
    });
    process.env.MEMORY_WAL_KEY_ROTATION_DEPRECATION_DAYS = "30";
    process.env.MEMORY_WAL_KEY_ROTATION_STARTED_AT = String(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(
      /key rotation deprecation expired|legacy keys/i,
    );
    process.env.MEMORY_WAL_ALLOWED_LEGACY_KEY_IDS = "env:key-a:1";
    await expect(listWalEvents(workspaceDir)).resolves.toHaveLength(1);
  });

  it("enforces startup fail-closed sequence for rotation expiry and missing signing key", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-a:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-a";
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "boot-seq" } }],
    });

    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-b:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-b";
    process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON = JSON.stringify({
      "env:key-a:1": "secret-a",
      "env:key-b:1": "secret-b",
    });
    process.env.MEMORY_WAL_KEY_ROTATION_DEPRECATION_DAYS = "30";
    process.env.MEMORY_WAL_KEY_ROTATION_STARTED_AT = String(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(
      /key rotation deprecation expired|legacy keys/i,
    );

    delete process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY;
    await expect(listWalEvents(workspaceDir)).rejects.toThrow(/signing key unavailable/i);
  });

  it("fails closed on unknown envelopeVersion in prod without snapshot mutation", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "v1" } }],
    });

    const snapshotBefore = await readSnapshot({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    const lines = (await fs.readFile(walPath, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    first.envelopeVersion = 999;
    lines[0] = JSON.stringify(first);
    await fs.writeFile(walPath, `${lines.join("\n")}\n`, "utf-8");

    await expect(
      rebuildSnapshotFromWal({
        workspaceDir,
        scope: "task",
        taskId: "task-a",
      }),
    ).rejects.toThrow(/unsupported-envelope-version|verification failed/i);

    const snapshotAfter = await readSnapshot({
      workspaceDir,
      scope: "task",
      taskId: "task-a",
    });
    expect(snapshotAfter.eventOffset).toBe(snapshotBefore.eventOffset);
    expect(snapshotAfter.state.goal).toBe(snapshotBefore.state.goal);
  });

  it("allows unsigned replay bypass only in dev and enforces read-only degraded writes", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed" } }],
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    const lines = (await fs.readFile(walPath, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    first.signature = "tampered";
    lines[0] = JSON.stringify(first);
    await fs.writeFile(walPath, `${lines.join("\n")}\n`, "utf-8");

    process.env.MEMORY_SECURITY_MODE = "dev";
    process.env.MEMORY_ALLOW_UNSIGNED_REPLAY = "true";

    const events = await listWalEvents(workspaceDir);
    expect(events).toHaveLength(1);

    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "NEXT_ACTION_SET", payload: { action: "blocked" } }],
      }),
    ).rejects.toThrow(/read-only|writes are disabled|bypass/i);
  });

  it("does not allow dev unsigned bypass for unknown envelope versions", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed" } }],
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    const lines = (await fs.readFile(walPath, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    first.envelopeVersion = 999;
    lines[0] = JSON.stringify(first);
    await fs.writeFile(walPath, `${lines.join("\n")}\n`, "utf-8");

    process.env.MEMORY_SECURITY_MODE = "dev";
    process.env.MEMORY_ALLOW_UNSIGNED_REPLAY = "true";

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(/unsupported-envelope-version/i);
  });

  it("does not allow dev unsigned bypass for schema validation failures", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed" } }],
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    const lines = (await fs.readFile(walPath, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    first.payload = {};
    lines[0] = JSON.stringify(
      resignWalRecord(first, {
        secret: process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY ?? "unit-test-secret",
      }),
    );
    await fs.writeFile(walPath, `${lines.join("\n")}\n`, "utf-8");

    process.env.MEMORY_SECURITY_MODE = "dev";
    process.env.MEMORY_ALLOW_UNSIGNED_REPLAY = "true";

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(/schema-validation-failure/i);
  });

  it("fails closed in prod when replay references an unavailable verification key", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-a:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-a";
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed-by-a" } }],
    });

    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "env:key-b:1";
    process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "secret-b";
    delete process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON;
    process.env.MEMORY_SECURITY_MODE = "prod";
    process.env.MEMORY_ALLOW_UNSIGNED_REPLAY = "false";

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(
      /missing-key|verification failed|verification key unavailable/i,
    );
  });

  it("fails closed on replay payload schema validation failures", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-a",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "signed" } }],
    });

    const walPath = path.join(workspaceDir, "memory/system/events.wal.jsonl");
    const lines = (await fs.readFile(walPath, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    first.payload = {};
    lines[0] = JSON.stringify(
      resignWalRecord(first, {
        secret: process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY ?? "unit-test-secret",
      }),
    );
    await fs.writeFile(walPath, `${lines.join("\n")}\n`, "utf-8");

    await expect(listWalEvents(workspaceDir)).rejects.toThrow(
      /schema-validation-failure|verification failed/i,
    );
  });

  it("fails fast when the WAL writer lock cannot be acquired", async () => {
    await upsertTaskRegistryTask({
      workspaceDir,
      taskId: "task-a",
      title: "Task A",
    });
    const lockPath = path.join(workspaceDir, "memory/system/events.wal.lock");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "held", "utf-8");

    await expect(
      commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: "task-a",
        actor: "agent",
        events: [{ type: "GOAL_SET", payload: { goal: "blocked" } }],
        lockOptions: {
          timeoutMs: 40,
          pollIntervalMs: 5,
          staleMs: 60_000,
        },
      }),
    ).rejects.toThrow(/timeout acquiring memory wal lock/i);
  });

  // --- Phase 4: Goal Stack + Blocker + Progress events ---

  it("GOAL_PUSHED pushes current goal to stack and sets new goal", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-gs", title: "Goal Stack" });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gs",
      actor: "agent",
      events: [{ type: "GOAL_SET", payload: { goal: "Original goal" } }],
    });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gs",
      actor: "agent",
      events: [{ type: "GOAL_PUSHED", payload: { goal: "Sub-goal A" } }],
    });
    const snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-gs" });
    expect(snapshot.state.goal).toBe("Sub-goal A");
    expect(snapshot.state.goalStack).toEqual(["Original goal"]);
  });

  it("GOAL_POPPED restores previous goal from stack", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-gp", title: "Goal Pop" });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gp",
      actor: "agent",
      events: [
        { type: "GOAL_SET", payload: { goal: "Root goal" } },
        { type: "GOAL_PUSHED", payload: { goal: "Sub-goal 1" } },
        { type: "GOAL_PUSHED", payload: { goal: "Sub-goal 2" } },
      ],
    });
    let snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-gp" });
    expect(snapshot.state.goal).toBe("Sub-goal 2");
    expect(snapshot.state.goalStack).toEqual(["Root goal", "Sub-goal 1"]);

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gp",
      actor: "agent",
      events: [{ type: "GOAL_POPPED", payload: {} }],
    });
    snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-gp" });
    expect(snapshot.state.goal).toBe("Sub-goal 1");
    expect(snapshot.state.goalStack).toEqual(["Root goal"]);
  });

  it("GOAL_POPPED on empty stack clears goal", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-gpe", title: "Goal Pop Empty" });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gpe",
      actor: "agent",
      events: [
        { type: "GOAL_SET", payload: { goal: "Only goal" } },
        { type: "GOAL_POPPED", payload: {} },
      ],
    });
    const snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-gpe" });
    expect(snapshot.state.goal).toBeUndefined();
    expect(snapshot.state.goalStack ?? []).toEqual([]);
  });

  it("BLOCKER_ADDED appends and deduplicates blockers", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-ba", title: "Blockers" });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-ba",
      actor: "agent",
      events: [
        { type: "BLOCKER_ADDED", payload: { blocker: "Waiting for API keys" } },
        { type: "BLOCKER_ADDED", payload: { blocker: "CI pipeline broken" } },
        { type: "BLOCKER_ADDED", payload: { blocker: "Waiting for API keys" } }, // duplicate
      ],
    });
    const snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-ba" });
    expect(snapshot.state.blockers).toEqual(["Waiting for API keys", "CI pipeline broken"]);
  });

  it("BLOCKER_RESOLVED removes matching blocker", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-br", title: "Resolve Blocker" });
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-br",
      actor: "agent",
      events: [
        { type: "BLOCKER_ADDED", payload: { blocker: "API keys missing" } },
        { type: "BLOCKER_ADDED", payload: { blocker: "Build broken" } },
        { type: "BLOCKER_RESOLVED", payload: { blocker: "API keys missing" } },
      ],
    });
    const snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-br" });
    expect(snapshot.state.blockers).toEqual(["Build broken"]);
  });

  it("GOAL_PROGRESS_MARKED sets goalLastProgressAt timestamp", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-gpm", title: "Progress" });
    const now = Date.now();
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-gpm",
      actor: "agent",
      events: [{ type: "GOAL_PROGRESS_MARKED", payload: {}, timestamp: now }],
    });
    const snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-gpm" });
    expect(snapshot.state.goalLastProgressAt).toBe(now);
  });

  it("NEXT_ACTION_COMPLETED and USER_CONFIRMED update goalLastProgressAt", async () => {
    await upsertTaskRegistryTask({ workspaceDir, taskId: "task-pup", title: "Progress Update" });
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_060_000;
    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-pup",
      actor: "agent",
      events: [
        { type: "NEXT_ACTION_SET", payload: { action: "Write tests" }, timestamp: t1 - 1000 },
        { type: "NEXT_ACTION_COMPLETED", payload: { action: "Write tests" }, timestamp: t1 },
      ],
    });
    let snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-pup" });
    expect(snapshot.state.goalLastProgressAt).toBe(t1);

    await commitMemoryEvents({
      workspaceDir,
      writeScope: "task",
      taskId: "task-pup",
      actor: "user",
      events: [{ type: "USER_CONFIRMED", payload: {}, timestamp: t2 }],
    });
    snapshot = await readSnapshot({ workspaceDir, scope: "task", taskId: "task-pup" });
    expect(snapshot.state.goalLastProgressAt).toBe(t2);
  });
});
