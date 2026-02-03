import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetMemoryPins,
  listConstraintPinsForInjection,
  listMemoryPins,
  upsertMemoryPin,
} from "./pins.js";

describe("memory pins", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-pins-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("injects global + task constraints for the active task", async () => {
    await upsertMemoryPin({
      workspaceDir,
      type: "constraint",
      text: "Never leak secrets",
      scope: "global",
    });
    await upsertMemoryPin({
      workspaceDir,
      type: "constraint",
      text: "Use schema v2",
      scope: "task",
      taskId: "task-a",
    });
    await upsertMemoryPin({
      workspaceDir,
      type: "constraint",
      text: "Ignore this other task constraint",
      scope: "task",
      taskId: "task-b",
    });
    await upsertMemoryPin({
      workspaceDir,
      type: "fact",
      text: "Facts are not constraints",
      scope: "global",
    });

    const injected = await listConstraintPinsForInjection({ workspaceDir, taskId: "task-a" });
    expect(injected.map((pin) => pin.text)).toEqual(
      expect.arrayContaining(["Never leak secrets", "Use schema v2"]),
    );
    expect(injected.some((pin) => pin.text.includes("other task"))).toBe(false);
    expect(injected.some((pin) => pin.type !== "constraint")).toBe(false);
  });

  it("expires temporary pins and supports forgetting", async () => {
    const now = Date.now();
    await upsertMemoryPin({
      workspaceDir,
      type: "temporary",
      text: "Short-lived",
      scope: "global",
      ttlMs: 10,
      now,
    });
    await upsertMemoryPin({
      workspaceDir,
      type: "fact",
      text: "Stable",
      scope: "global",
      now,
    });

    const active = await listMemoryPins({ workspaceDir, now: now + 20 });
    expect(active.some((pin) => pin.text === "Short-lived")).toBe(false);
    expect(active.some((pin) => pin.text === "Stable")).toBe(true);

    const removed = await forgetMemoryPins({
      workspaceDir,
      text: "stable",
      now: now + 20,
    });
    expect(removed).toBe(1);
  });

  it("keeps pins immutable on duplicate upsert", async () => {
    const now = Date.now();
    const first = await upsertMemoryPin({
      workspaceDir,
      type: "fact",
      text: "API base is stable",
      scope: "global",
      now,
    });
    const second = await upsertMemoryPin({
      workspaceDir,
      type: "fact",
      text: "API base is stable",
      scope: "global",
      now: now + 1_000,
    });
    expect(second.id).toBe(first.id);
    expect(second.updatedAt).toBe(first.updatedAt);
  });
});
