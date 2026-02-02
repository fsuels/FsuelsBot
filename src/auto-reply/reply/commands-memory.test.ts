import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MoltbotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

let workspaceDir = os.tmpdir();

beforeAll(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-commands-memory-"));
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

function buildParams(params: {
  body: string;
  cfg: MoltbotConfig;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
}): Parameters<typeof handleCommands>[0] {
  const ctx = {
    Body: params.body,
    CommandBody: params.body,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "whatsapp",
    Surface: "whatsapp",
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg: params.cfg,
    isGroup: false,
    triggerBodyNormalized: params.body.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg: params.cfg,
    command,
    directives: parseInlineDirectives(params.body),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: params.sessionKey ?? "agent:main:main",
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    workspaceDir,
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "whatsapp",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("memory commands", () => {
  it("adds, lists, and removes typed pins", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s1", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };

    const addResult = await handleCommands(
      buildParams({
        body: "/pin fact alpha policy",
        cfg,
        sessionKey,
        sessionEntry,
        sessionStore,
      }),
    );
    expect(addResult.shouldContinue).toBe(false);
    expect(addResult.reply?.text).toContain("Pinned pin_");

    const pinsStorePath = path.join(workspaceDir, "memory", ".pins.json");
    const parsed = JSON.parse(await fs.readFile(pinsStorePath, "utf-8")) as {
      pins: Array<{ id: string; type: string }>;
    };
    expect(parsed.pins).toHaveLength(1);
    expect(parsed.pins[0]?.type).toBe("fact");

    const listResult = await handleCommands(
      buildParams({
        body: "/pin list",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(listResult.shouldContinue).toBe(false);
    expect(listResult.reply?.text).toContain("Memory pins (1)");
    expect(listResult.reply?.text).toContain("[fact]");

    const pinId = parsed.pins[0]?.id;
    const removeResult = await handleCommands(
      buildParams({
        body: `/pin remove ${pinId}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(removeResult.shouldContinue).toBe(false);
    expect(removeResult.reply?.text).toContain(`Removed pin ${pinId}`);
  });

  it("forgets matching lines and pins", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s2", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };

    await fs.writeFile(
      path.join(workspaceDir, "memory", "global", "notes.md"),
      "# Notes\nAlpha key should be removed\nKeep this line\n",
      "utf-8",
    );
    await handleCommands(
      buildParams({
        body: "/pin fact alpha key",
        cfg,
        sessionKey,
        sessionEntry,
        sessionStore,
      }),
    );

    const forgetResult = await handleCommands(
      buildParams({
        body: "/forget alpha",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(forgetResult.shouldContinue).toBe(false);
    expect(forgetResult.reply?.text).toContain("Forgot memory entries.");
    expect(forgetResult.reply?.text).toContain("pins=1");

    const notes = await fs.readFile(path.join(workspaceDir, "memory", "global", "notes.md"), "utf-8");
    expect(notes.toLowerCase().includes("alpha key")).toBe(false);
    expect(notes).toContain("Keep this line");
  });

  it("updates task lifecycle state and resets active task when completed", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "s3",
      updatedAt: Date.now(),
      activeTaskId: "default",
      taskStateById: {
        default: { updatedAt: Date.now(), status: "active" },
      },
    };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };

    const setResult = await handleCommands(
      buildParams({
        body: "/task set task-a build-api",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(setResult.shouldContinue).toBe(false);
    expect(setResult.reply?.text).toContain("Active task set to task-a");
    expect(sessionStore[sessionKey]?.activeTaskId).toBe("task-a");
    expect(sessionStore[sessionKey]?.taskStateById?.["task-a"]?.status).toBe("active");

    const completeResult = await handleCommands(
      buildParams({
        body: "/task completed",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(completeResult.shouldContinue).toBe(false);
    expect(completeResult.reply?.text).toContain("marked completed");
    expect(sessionStore[sessionKey]?.taskStateById?.["task-a"]?.status).toBe("completed");
    expect(sessionStore[sessionKey]?.activeTaskId).toBe("default");
  });
});
