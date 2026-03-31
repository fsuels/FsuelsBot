import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { withTempHome as withTempHomeBase } from "../../../test/helpers/temp-home.js";
import { resolveSession } from "./session.js";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "openclaw-session-workspace-" });
}

function buildConfig(store: string): OpenClawConfig {
  return {
    session: {
      store,
      mainKey: "main",
      scope: "per-sender",
    },
  };
}

describe("resolveSession workspace safety", () => {
  it("refuses explicit session resume across different workspaces", async () => {
    await withTempHome(async (home) => {
      const store = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            "agent:main:main": {
              sessionId: "session-123",
              updatedAt: Date.now(),
              workspaceFingerprint: {
                workspaceDir: "/tmp/other-workspace",
                repoRoot: "/tmp/other-workspace",
              },
            },
          },
          null,
          2,
        ),
      );

      expect(() =>
        resolveSession({
          cfg: buildConfig(store),
          sessionId: "session-123",
          workspaceFingerprint: {
            workspaceDir: "/tmp/current-workspace",
            repoRoot: "/tmp/current-workspace",
          },
        }),
      ).toThrow(/Refusing to resume session "session-123" from a different workspace/);
    });
  });

  it("starts a fresh session when an implicit route points at a different workspace", async () => {
    await withTempHome(async (home) => {
      const store = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            "agent:main:main": {
              sessionId: "session-old",
              updatedAt: Date.now(),
              thinkingLevel: "high",
              workspaceFingerprint: {
                workspaceDir: "/tmp/other-workspace",
                repoRoot: "/tmp/other-workspace",
              },
            },
          },
          null,
          2,
        ),
      );

      const result = resolveSession({
        cfg: buildConfig(store),
        agentId: "main",
        workspaceFingerprint: {
          workspaceDir: "/tmp/current-workspace",
          repoRoot: "/tmp/current-workspace",
        },
      });

      expect(result.sessionId).not.toBe("session-old");
      expect(result.sessionEntry).toBeUndefined();
      expect(result.isNewSession).toBe(true);
      expect(result.persistedThinking).toBeUndefined();
      expect(result.workspaceRelation).toBe("different");
      expect(result.resumeNotice).toContain("Starting a fresh session");
    });
  });

  it("allows resume from the same repo in a different worktree with a notice", async () => {
    await withTempHome(async (home) => {
      const store = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            main: {
              sessionId: "session-456",
              updatedAt: Date.now(),
              thinkingLevel: "high",
              workspaceFingerprint: {
                workspaceDir: "/tmp/worktrees/a",
                repoRoot: "/tmp/worktrees/a",
                gitCommonDir: "/tmp/repo/.git",
              },
            },
          },
          null,
          2,
        ),
      );

      const result = resolveSession({
        cfg: buildConfig(store),
        sessionId: "session-456",
        workspaceFingerprint: {
          workspaceDir: "/tmp/worktrees/b",
          repoRoot: "/tmp/worktrees/b",
          gitCommonDir: "/tmp/repo/.git",
        },
      });

      expect(result.sessionId).toBe("session-456");
      expect(result.sessionEntry?.sessionId).toBe("session-456");
      expect(result.isNewSession).toBe(false);
      expect(result.persistedThinking).toBe("high");
      expect(result.workspaceRelation).toBe("same_repo");
      expect(result.resumeNotice).toContain("same repository");
    });
  });

  it("keeps legacy or malformed workspace metadata resumable as unverified", async () => {
    await withTempHome(async (home) => {
      const store = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            main: {
              sessionId: "session-legacy",
              updatedAt: Date.now(),
              workspaceFingerprint: {
                workspaceDir: 42,
              },
            },
          },
          null,
          2,
        ),
      );

      const result = resolveSession({
        cfg: buildConfig(store),
        sessionId: "session-legacy",
        workspaceFingerprint: {
          workspaceDir: "/tmp/current-workspace",
        },
      });

      expect(result.sessionId).toBe("session-legacy");
      expect(result.workspaceRelation).toBe("unverified");
      expect(result.resumeNotice).toBeUndefined();
    });
  });
});
