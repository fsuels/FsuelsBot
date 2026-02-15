import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitMemoryEvents,
  pruneExpiredTransientBufferItems,
  upsertTaskRegistryTask,
  upsertTransientBufferItem,
} from "./task-memory-system.js";
import { upsertMemoryPin, listMemoryPins } from "./pins.js";
import {
  resetRetentionCooldowns,
  runRetentionPolicies,
} from "./retention.js";

describe("retention policies", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "retention-test-"));
    await fs.mkdir(path.join(workspaceDir, "memory/system"), { recursive: true });
    resetRetentionCooldowns();
    process.env.MEMORY_SECURITY_MODE = "dev";
  });

  afterEach(async () => {
    delete process.env.MEMORY_SECURITY_MODE;
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("prunes expired transient buffer items", async () => {
    const now = Date.now();
    // Add items with short TTL
    await upsertTransientBufferItem({
      workspaceDir,
      content: "short-lived",
      ttlMs: 10,
      now,
    });
    await upsertTransientBufferItem({
      workspaceDir,
      content: "long-lived",
      ttlMs: 100_000,
      now,
    });

    const result = await runRetentionPolicies({
      workspaceDir,
      now: now + 50,
      force: true,
      config: {
        walCompaction: false,
        expiredPinPrune: false,
      },
    });

    expect(result.ran).toBe(true);
    expect(result.transientBufferPruned).toBe(1);
  });

  it("prunes expired temporary pins", async () => {
    const now = Date.now();
    await upsertMemoryPin({
      workspaceDir,
      type: "temporary",
      text: "expires-soon",
      scope: "global",
      ttlMs: 10,
      now,
    });
    await upsertMemoryPin({
      workspaceDir,
      type: "fact",
      text: "permanent-fact",
      scope: "global",
      now,
    });

    const result = await runRetentionPolicies({
      workspaceDir,
      now: now + 50,
      force: true,
      config: {
        walCompaction: false,
        transientBufferPrune: false,
      },
    });

    expect(result.ran).toBe(true);
    expect(result.expiredPinsPruned).toBe(1);

    // Verify permanent pin survives
    const pins = await listMemoryPins({ workspaceDir, now: now + 50 });
    expect(pins.some((p) => p.text === "permanent-fact")).toBe(true);
    expect(pins.some((p) => p.text === "expires-soon")).toBe(false);
  });

  it("respects cooldown between runs", async () => {
    const now = Date.now();
    const first = await runRetentionPolicies({
      workspaceDir,
      now,
      config: { cooldownMs: 60_000 },
    });
    expect(first.ran).toBe(true);

    const second = await runRetentionPolicies({
      workspaceDir,
      now: now + 1000,
      config: { cooldownMs: 60_000 },
    });
    expect(second.ran).toBe(false);
    expect(second.skippedReason).toBe("cooldown");
  });

  it("allows forced runs ignoring cooldown", async () => {
    const now = Date.now();
    await runRetentionPolicies({ workspaceDir, now });
    const forced = await runRetentionPolicies({
      workspaceDir,
      now: now + 100,
      force: true,
    });
    expect(forced.ran).toBe(true);
  });

  it("collects errors without throwing", async () => {
    // Spy on pruneExpiredTransientBufferItems to make it throw,
    // verifying the orchestrator catches and collects the error.
    const tms = await import("./task-memory-system.js");
    const spy = vi
      .spyOn(tms, "pruneExpiredTransientBufferItems")
      .mockRejectedValueOnce(new Error("simulated prune failure"));

    const result = await runRetentionPolicies({
      workspaceDir,
      force: true,
      config: {
        walCompaction: false,
        transientBufferPrune: true,
        expiredPinPrune: false,
      },
    });

    spy.mockRestore();

    expect(result.ran).toBe(true);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBe(1);
    expect(result.errors![0]).toContain("simulated prune failure");
  });

  it("returns zero counts when nothing to prune", async () => {
    const result = await runRetentionPolicies({
      workspaceDir,
      force: true,
      config: {
        walCompaction: false, // Skip WAL to avoid signature issues in dev
      },
    });
    expect(result.ran).toBe(true);
    expect(result.transientBufferPruned).toBe(0);
    expect(result.expiredPinsPruned).toBe(0);
  });

  it("respects per-policy toggles", async () => {
    const now = Date.now();
    await upsertMemoryPin({
      workspaceDir,
      type: "temporary",
      text: "should-survive",
      scope: "global",
      ttlMs: 10,
      now,
    });

    const result = await runRetentionPolicies({
      workspaceDir,
      now: now + 50,
      force: true,
      config: {
        walCompaction: false,
        transientBufferPrune: false,
        expiredPinPrune: false, // Disabled
      },
    });
    expect(result.ran).toBe(true);
    expect(result.expiredPinsPruned).toBe(0);
  });
});
