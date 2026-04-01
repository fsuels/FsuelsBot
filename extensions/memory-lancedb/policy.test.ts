import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildRecallView,
  classifyMemoryType,
  normalizeRelativeDates,
  prepareMemoryForStorage,
  shouldIgnoreMemory,
} from "./policy.js";

describe("memory-lancedb policy", () => {
  const now = Date.parse("2026-03-31T12:00:00.000Z");
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  test("classifies the four durable memory types", () => {
    expect(classifyMemoryType("I prefer dark mode for all tools.")).toBe("user");
    expect(
      classifyMemoryType("That was the right call because the dry run kept production safe."),
    ).toBe("feedback");
    expect(classifyMemoryType("We use task cards as the source of truth in this project.")).toBe(
      "project",
    );
    expect(classifyMemoryType("Deployment runbook: https://example.com/runbook")).toBe("reference");
  });

  test("captures positive confirmations as reusable feedback and skips generic praise", () => {
    const captured = prepareMemoryForStorage({
      text: "Using a dry run first was the right call because it avoided a risky deploy.",
      sourceRole: "user",
      now,
    });
    expect(captured).not.toBeNull();
    expect(captured?.type).toBe("feedback");
    expect(captured?.text).toContain("Why:");
    expect(captured?.text).toContain("How to apply:");

    expect(prepareMemoryForStorage({ text: "Great job!", sourceRole: "user", now })).toBeNull();
  });

  test("normalizes relative dates before saving", () => {
    const normalized = normalizeRelativeDates(
      "Ship tomorrow, review next Monday, and note that yesterday failed.",
      now,
    );
    expect(normalized).toContain("2026-04-01");
    expect(normalized).toContain("2026-04-06");
    expect(normalized).toContain("2026-03-30");
  });

  test("rejects re-derivable repo facts", () => {
    const prepared = prepareMemoryForStorage({
      text: "The function `memoryAge` exists in src/memory/freshness.ts.",
      sourceRole: "user",
      now,
    });
    expect(prepared).toBeNull();
  });

  test("marks stale memories with a verification note", async () => {
    const recall = await buildRecallView({
      candidate: {
        id: "memory-1",
        text: "We use task cards as the source of truth in this project.",
        type: "project",
        importance: 0.8,
        savedAt: now - 2 * 24 * 60 * 60 * 1000,
      },
      now,
    });
    expect(recall.stale).toBe(true);
    expect(recall.stalenessNote).toContain("Historical memory");
  });

  test("treats ignore-memory instructions as a hard stop for recall", () => {
    expect(
      shouldIgnoreMemory({
        prompt: "Please ignore memory for this turn.",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreMemory({
        prompt: "Regular prompt.",
        messages: [{ role: "user", content: "Do not use memory right now." }],
      }),
    ).toBe(true);
  });

  test("flags conflicting repo references for review and trusts current workspace state", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-policy-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "present.ts"), "export const present = true;\n");

    const ok = await buildRecallView({
      candidate: {
        id: "memory-ok",
        text: "Check `src/present.ts` before editing related logic.",
        type: "project",
        importance: 0.8,
        savedAt: now,
      },
      workspaceDir: tmpDir,
      now,
    });
    expect(ok.verification.status).toBe("clear");

    const conflict = await buildRecallView({
      candidate: {
        id: "memory-conflict",
        text: "Check `src/missing.ts` before editing related logic.",
        type: "project",
        importance: 0.8,
        savedAt: now,
      },
      workspaceDir: tmpDir,
      now,
    });
    expect(conflict.verification.status).toBe("conflict");
    expect(conflict.verification.needsReview).toBe(true);
    expect(conflict.verification.note).toContain("no longer matches");
  });
});
