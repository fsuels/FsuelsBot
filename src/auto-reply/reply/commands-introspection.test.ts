import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { writeConfigFile } from "../../config/config.js";
import {
  buildDiffText,
  buildDoctorText,
  exportSessionReport,
} from "./commands-introspection.js";

describe("commands introspection", () => {
  let tempDir = "";
  let workspaceDir = "";
  let stateDir = "";
  let previousConfigPath: string | undefined;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-introspection-"));
    workspaceDir = path.join(tempDir, "workspace");
    stateDir = path.join(tempDir, "state");
    await fs.mkdir(workspaceDir, { recursive: true });
    previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_CONFIG_PATH = path.join(tempDir, "openclaw.json");
    process.env.OPENCLAW_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
    }
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reports when the workspace is not a git repository", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const text = await buildDoctorText({
      cfg,
      provider: "openai",
      model: "gpt-5.3-codex",
      sessionKey: "agent:main:main",
      workspaceDir,
    });

    expect(text).toContain("Config: ok");
    expect(text).toContain(`Workspace: writable (${workspaceDir})`);
    expect(text).toContain("Git: workspace is not a git repo");
  });

  it("renders git status for a dirty repository", async () => {
    await runGit(workspaceDir, ["init"]);
    await runGit(workspaceDir, ["config", "user.email", "test@example.com"]);
    await runGit(workspaceDir, ["config", "user.name", "OpenClaw Test"]);
    await runGit(workspaceDir, ["config", "commit.gpgsign", "false"]);
    await fs.writeFile(path.join(workspaceDir, "note.txt"), "hello\n", "utf8");
    await runGit(workspaceDir, ["add", "note.txt"]);
    await runGit(workspaceDir, ["commit", "-m", "init"]);
    await fs.writeFile(path.join(workspaceDir, "note.txt"), "hello\nworld\n", "utf8");

    const text = await buildDiffText(workspaceDir);

    expect(text).toContain("Workspace diff");
    expect(text).toContain("Status");
    expect(text).toContain("note.txt");
    expect(text).toContain("Working tree diff stat");
  });

  it("exports a markdown session report using the first user prompt for the filename", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const sessionFile = path.join(tempDir, "session.jsonl");
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "sess-1", timestamp: "2026-03-31T00:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            timestamp: 1,
            content: [{ type: "text", text: "Plan release checklist" }],
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            timestamp: 2,
            content: [
              { type: "text", text: "Release plan drafted." },
              { type: "tool_use", name: "read" },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const sessionEntry = {
      sessionId: "sess-1",
      sessionFile,
      updatedAt: Date.now(),
    } as SessionEntry;

    const result = await exportSessionReport({
      cfg,
      provider: "openai",
      model: "gpt-5.3-codex",
      sessionEntry,
      sessionKey: "agent:main:main",
      workspaceDir,
    });

    expect(result.basename).toMatch(/plan-release-checklist\.md$/);
    const exported = await fs.readFile(result.path, "utf8");
    expect(exported).toContain("# OpenClaw Session Export");
    expect(exported).toContain("Release plan drafted.");
    expect(exported).toContain("Tool calls: read");
  });

  it("rejects export path traversal attempts", async () => {
    await expect(
      exportSessionReport({
        cfg: {} as OpenClawConfig,
        provider: "openai",
        model: "gpt-5.3-codex",
        sessionKey: "agent:main:main",
        workspaceDir,
        requestedFilename: "../escape.md",
      }),
    ).rejects.toThrow("plain filename");
  });
});

async function runGit(workspaceDir: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("git", ["-C", workspaceDir, ...args], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
