import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { MsgContext } from "../templating.js";
import { saveSessionPlanArtifact } from "../../infra/session-plan.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

let testWorkspaceDir = os.tmpdir();

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-plan-command-"));
});

afterAll(async () => {
  await fs.rm(testWorkspaceDir, { recursive: true, force: true });
});

function buildParams(
  commandBody: string,
  cfg: OpenClawConfig,
  stateOverrides?: {
    sessionEntry?: SessionEntry;
    sessionStore?: Record<string, SessionEntry>;
    storePath?: string;
    sessionKey?: string;
    provider?: string;
    model?: string;
  },
) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "whatsapp",
    Surface: "whatsapp",
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionEntry: stateOverrides?.sessionEntry,
    sessionStore: stateOverrides?.sessionStore,
    sessionKey: stateOverrides?.sessionKey ?? "agent:main:main",
    storePath: stateOverrides?.storePath,
    workspaceDir: testWorkspaceDir,
    defaultGroupActivation: () => "mention" as const,
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: stateOverrides?.provider ?? "openai",
    model: stateOverrides?.model ?? "gpt-5.2",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("handleCommands /plan", () => {
  it("shows the saved session plan and artifact path when already in plan mode", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const sessionFile = path.join(testWorkspaceDir, "plan-show.jsonl");
    const sessionEntry = {
      sessionId: "plan-show",
      sessionFile,
      updatedAt: 1,
      collaborationMode: "plan",
      planProfile: "conservative",
    } as SessionEntry;
    await saveSessionPlanArtifact({
      sessionId: sessionEntry.sessionId,
      sessionEntry,
      sessionKey: "agent:main:main",
      plan: "# Plan\n- inspect runtime\n- verify tests",
      updatedAt: Date.parse("2026-03-31T12:00:00.000Z"),
    });

    const result = await handleCommands(
      buildParams("/plan", cfg, {
        sessionEntry,
        sessionStore: { "agent:main:main": sessionEntry },
      }),
    );

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Mode: planning (conservative, read-only)");
    expect(result.reply?.text).toContain(
      `Artifact: ${path.join(testWorkspaceDir, "plan-show.plan.md")}`,
    );
    expect(result.reply?.text).toContain("inspect runtime");
    expect(result.reply?.text).toContain("2026-03-31T12:00:00.000Z");
  });

  it("shows a clear empty-plan message when no saved plan exists yet", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const sessionEntry = {
      sessionId: "plan-empty",
      sessionFile: path.join(testWorkspaceDir, "plan-empty.jsonl"),
      updatedAt: 1,
      collaborationMode: "plan",
      planProfile: "conservative",
    } as SessionEntry;

    const result = await handleCommands(
      buildParams("/plan", cfg, {
        sessionEntry,
        sessionStore: { "agent:main:main": sessionEntry },
      }),
    );

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("No saved plan yet");
    expect(result.reply?.text).toContain(
      `Artifact: ${path.join(testWorkspaceDir, "plan-empty.plan.md")}`,
    );
  });

  it("continues the same turn with a planning prompt for /plan <description>", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const sessionEntry = {
      sessionId: "plan-refine",
      sessionFile: path.join(testWorkspaceDir, "plan-refine.jsonl"),
      updatedAt: 1,
    } as SessionEntry;
    const sessionStore: Record<string, SessionEntry> = {
      "agent:main:main": sessionEntry,
    };
    await saveSessionPlanArtifact({
      sessionId: sessionEntry.sessionId,
      sessionEntry,
      sessionKey: "agent:main:main",
      plan: "# Current Plan\n- inspect current flow",
    });

    const result = await handleCommands(
      buildParams("/plan proactive tighten the retry flow", cfg, {
        sessionEntry,
        sessionStore,
      }),
    );

    expect(result.shouldContinue).toBe(true);
    expect(result.reply).toBeUndefined();
    expect(result.continueWithBody).toContain("Refine the current session plan");
    expect(result.continueWithBody).toContain("# Current Plan");
    expect(result.continueWithBody).toContain("tighten the retry flow");
    expect(sessionEntry.collaborationMode).toBe("plan");
    expect(sessionEntry.planProfile).toBe("proactive");
  });

  it("returns the fallback artifact path for /plan open", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const sessionEntry = {
      sessionId: "plan-open",
      sessionFile: path.join(testWorkspaceDir, "plan-open.jsonl"),
      updatedAt: 1,
      collaborationMode: "plan",
      planProfile: "conservative",
    } as SessionEntry;

    const result = await handleCommands(
      buildParams("/plan open", cfg, {
        sessionEntry,
        sessionStore: { "agent:main:main": sessionEntry },
      }),
    );

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("External editor integration is not configured");
    expect(result.reply?.text).toContain(
      `Artifact: ${path.join(testWorkspaceDir, "plan-open.plan.md")}`,
    );
  });

  it("does not create session state when CLI providers block /plan", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const sessionStore: Record<string, SessionEntry> = {};
    const storePath = path.join(testWorkspaceDir, "plan-cli-store.json");
    await fs.writeFile(storePath, JSON.stringify(sessionStore), "utf-8");

    const result = await handleCommands(
      buildParams("/plan", cfg, {
        sessionStore,
        storePath,
        provider: "claude-cli",
        model: "default",
      }),
    );

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("not available with CLI providers yet");
    expect(sessionStore).toEqual({});
    expect(JSON.parse(await fs.readFile(storePath, "utf-8"))).toEqual({});
  });
});
