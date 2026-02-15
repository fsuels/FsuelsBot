import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryPinRemoveIntent,
  executeMemoryPinRemoveIntent,
  forgetMemoryPins,
  listConstraintPinsForInjection,
  listMemoryPins,
  removeMemoryPin,
  upsertMemoryPin,
  validateMemoryPinRemoveIntent,
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

  it("removes stale task pin markdown after deleting the last task pin", async () => {
    const created = await upsertMemoryPin({
      workspaceDir,
      type: "constraint",
      text: "Task-only guardrail",
      scope: "task",
      taskId: "task-a",
    });
    const taskPinsPath = path.join(workspaceDir, "memory/tasks/task-a/pins.md");
    const beforeText = await fs.readFile(taskPinsPath, "utf-8");
    expect(beforeText).toContain("Task-only guardrail");

    const removed = await removeMemoryPin({
      workspaceDir,
      id: created.id,
    });
    expect(removed).toBe(true);
    await expect(fs.access(taskPinsPath)).rejects.toThrow();
  });

  it("serializes concurrent pin writes without losing updates", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        upsertMemoryPin({
          workspaceDir,
          type: "fact",
          text: `Concurrent fact ${index}`,
          scope: "global",
        }),
      ),
    );

    const pins = await listMemoryPins({ workspaceDir, scope: "global" });
    const texts = new Set(pins.map((pin) => pin.text));
    expect(texts.size).toBeGreaterThanOrEqual(8);
    for (let index = 0; index < 8; index += 1) {
      expect(texts.has(`Concurrent fact ${index}`)).toBe(true);
    }
  });

  it("fails closed when pins store JSON is corrupted", async () => {
    await fs.writeFile(path.join(workspaceDir, "memory/.pins.json"), "{not-valid-json", "utf-8");
    await expect(listMemoryPins({ workspaceDir })).rejects.toThrow(/pins store read failed/i);
  });

  describe("WAL-first pin removal (validate → commit → execute)", () => {
    it("validates token without deleting the pin", async () => {
      const pin = await upsertMemoryPin({
        workspaceDir,
        type: "fact",
        text: "WAL-first test",
        scope: "global",
      });
      const intent = await createMemoryPinRemoveIntent({
        workspaceDir,
        id: pin.id,
      });
      expect(intent).not.toBeNull();

      const validation = await validateMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
      });
      expect(validation.valid).toBe(true);
      expect(validation.pinId).toBe(pin.id);
      expect(validation.scope).toBe("global");

      // Pin should still exist after validation
      const pins = await listMemoryPins({ workspaceDir });
      expect(pins.some((p) => p.id === pin.id)).toBe(true);
    });

    it("returns invalid for expired token", async () => {
      const now = Date.now();
      const pin = await upsertMemoryPin({
        workspaceDir,
        type: "fact",
        text: "Expire test",
        scope: "global",
        now,
      });
      const intent = await createMemoryPinRemoveIntent({
        workspaceDir,
        id: pin.id,
        ttlMs: 10,
        now,
      });
      expect(intent).not.toBeNull();

      const validation = await validateMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
        now: now + 20,
      });
      expect(validation.valid).toBe(false);
      expect(validation.expired).toBe(true);
      expect(validation.pinId).toBe(pin.id);
    });

    it("returns invalid for unknown token", async () => {
      const validation = await validateMemoryPinRemoveIntent({
        workspaceDir,
        token: "pdel_nonexistent",
      });
      expect(validation.valid).toBe(false);
      expect(validation.pinId).toBeUndefined();
    });

    it("executes removal after validate succeeds", async () => {
      const pin = await upsertMemoryPin({
        workspaceDir,
        type: "fact",
        text: "Execute after validate",
        scope: "global",
      });
      const intent = await createMemoryPinRemoveIntent({
        workspaceDir,
        id: pin.id,
      });
      expect(intent).not.toBeNull();

      // Step 1: validate
      const validation = await validateMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
      });
      expect(validation.valid).toBe(true);

      // Step 2: (WAL commit would happen here in production)

      // Step 3: execute
      const result = await executeMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
      });
      expect(result.removed).toBe(true);
      expect(result.pinId).toBe(pin.id);

      // Pin should be gone
      const pins = await listMemoryPins({ workspaceDir });
      expect(pins.some((p) => p.id === pin.id)).toBe(false);
    });

    it("returns not-removed when pin was already deleted between validate and execute", async () => {
      const pin = await upsertMemoryPin({
        workspaceDir,
        type: "fact",
        text: "Race condition test",
        scope: "global",
      });
      const intent = await createMemoryPinRemoveIntent({
        workspaceDir,
        id: pin.id,
      });
      expect(intent).not.toBeNull();

      // Validate succeeds
      const validation = await validateMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
      });
      expect(validation.valid).toBe(true);

      // Someone else deletes the pin directly
      await removeMemoryPin({ workspaceDir, id: pin.id });

      // Execute still works (intent consumed) but reports the pin state
      const result = await executeMemoryPinRemoveIntent({
        workspaceDir,
        token: intent!.token,
      });
      expect(result.removed).toBe(false);
      expect(result.pinId).toBe(pin.id);
    });
  });
});
