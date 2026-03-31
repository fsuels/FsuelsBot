import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadSessionPlanArtifact,
  resolveSessionPlanArtifactPath,
  saveSessionPlanArtifact,
} from "./session-plan.js";

describe("session-plan", () => {
  it("saves and reloads a session plan artifact next to the transcript", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-plan-"));
    try {
      const sessionEntry = {
        sessionFile: path.join(workspaceDir, "sessions", "alpha.jsonl"),
      };

      const saved = await saveSessionPlanArtifact({
        sessionId: "alpha",
        sessionEntry,
        sessionKey: "agent:main:main",
        plan: "# Plan\r\n- inspect runtime\r\n- run tests\r\n",
        updatedAt: Date.parse("2026-03-31T14:00:00.000Z"),
      });

      expect(saved).toMatchObject({
        sessionId: "alpha",
        sessionKey: "agent:main:main",
        exists: true,
        filePath: path.join(workspaceDir, "sessions", "alpha.plan.md"),
        updatedAt: "2026-03-31T14:00:00.000Z",
      });
      expect(saved.plan).toBe("# Plan\n- inspect runtime\n- run tests");

      const loaded = await loadSessionPlanArtifact({
        sessionId: "alpha",
        sessionEntry,
        sessionKey: "agent:main:main",
      });

      expect(loaded).toMatchObject({
        sessionId: "alpha",
        sessionKey: "agent:main:main",
        exists: true,
        filePath: path.join(workspaceDir, "sessions", "alpha.plan.md"),
        updatedAt: "2026-03-31T14:00:00.000Z",
      });
      expect(loaded.plan).toBe("# Plan\n- inspect runtime\n- run tests");
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns a missing artifact result without creating a file", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-plan-"));
    try {
      const sessionEntry = {
        sessionFile: path.join(workspaceDir, "sessions", "missing.jsonl"),
      };

      const loaded = await loadSessionPlanArtifact({
        sessionId: "missing",
        sessionEntry,
        sessionKey: "agent:main:main",
      });

      expect(loaded).toMatchObject({
        sessionId: "missing",
        sessionKey: "agent:main:main",
        exists: false,
        plan: "",
        filePath: path.join(workspaceDir, "sessions", "missing.plan.md"),
      });
      await expect(
        fs.access(resolveSessionPlanArtifactPath({ sessionId: "missing", sessionEntry })),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
