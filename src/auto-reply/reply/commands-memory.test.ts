import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MoltbotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import * as taskMemorySystem from "../../memory/task-memory-system.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

let workspaceDir = os.tmpdir();
const previousMemoryEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of [
    "MEMORY_SECURITY_MODE",
    "MEMORY_WAL_ACTIVE_SIGNING_KEY_ID",
    "MEMORY_WAL_ACTIVE_SIGNING_KEY",
    "MEMORY_WAL_VERIFICATION_KEYS_JSON",
  ]) {
    previousMemoryEnv[key] = process.env[key];
  }
  process.env.MEMORY_SECURITY_MODE = "prod";
  process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID = "test:key:1";
  process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY = "test-secret";
  process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON = JSON.stringify({ "test:key:1": "test-secret" });
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-commands-memory-"));
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previousMemoryEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
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
    const removeIntentResult = await handleCommands(
      buildParams({
        body: `/pin remove ${pinId}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(removeIntentResult.shouldContinue).toBe(false);
    expect(removeIntentResult.reply?.text).toContain("Pin removal requires confirmation");
    const tokenMatch = removeIntentResult.reply?.text.match(/\/pin confirm (\S+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch?.[1];
    if (!token) {
      throw new Error("expected pin confirmation token");
    }

    const removeConfirmResult = await handleCommands(
      buildParams({
        body: `/pin confirm ${token}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(removeConfirmResult.shouldContinue).toBe(false);
    expect(removeConfirmResult.reply?.text).toContain(`Removed pin ${pinId}`);
  });

  it("supports pin remove cancel tokens idempotently", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s1b", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };

    await handleCommands(
      buildParams({
        body: "/pin fact beta policy",
        cfg,
        sessionKey,
        sessionEntry,
        sessionStore,
      }),
    );

    const parsed = JSON.parse(
      await fs.readFile(path.join(workspaceDir, "memory", ".pins.json"), "utf-8"),
    ) as {
      pins: Array<{ id: string }>;
    };
    const pinId = parsed.pins[0]?.id;
    expect(pinId).toBeTruthy();

    const removeIntent = await handleCommands(
      buildParams({
        body: `/pin remove ${pinId}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    const token = removeIntent.reply?.text.match(/\/pin confirm (\S+)/)?.[1];
    expect(token).toBeTruthy();

    const cancelOnce = await handleCommands(
      buildParams({
        body: `/pin cancel ${token}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(cancelOnce.reply?.text).toContain("canceled");

    const cancelTwice = await handleCommands(
      buildParams({
        body: `/pin cancel ${token}`,
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(cancelTwice.reply?.text).toContain("already resolved");
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
    expect(forgetResult.reply?.text).toContain("pins=0");

    const notes = await fs.readFile(
      path.join(workspaceDir, "memory", "global", "notes.md"),
      "utf-8",
    );
    expect(notes.toLowerCase().includes("alpha key")).toBe(false);
    expect(notes).toContain("Keep this line");

    const forgetPinsResult = await handleCommands(
      buildParams({
        body: "/forget alpha --pins true",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(forgetPinsResult.reply?.text).toContain("pins=1");
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

    const aliasList = await handleCommands(
      buildParams({
        body: "/tasks",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(aliasList.reply?.text).toContain("Known tasks");

    const resumeResult = await handleCommands(
      buildParams({
        body: "/resume task-a",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(resumeResult.shouldContinue).toBe(false);
    expect(resumeResult.reply?.text).toContain("Active task set to task-a");
    expect(sessionStore[sessionKey]?.activeTaskId).toBe("task-a");
  });

  it("supports autoswitch and memory mode command toggles", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s4", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };

    const autoswitchOn = await handleCommands(
      buildParams({
        body: "/autoswitch on",
        cfg,
        sessionKey,
        sessionEntry,
        sessionStore,
      }),
    );
    expect(autoswitchOn.reply?.text).toContain("Autoswitch is on");
    expect(sessionStore[sessionKey]?.autoSwitchOptIn).toBe(true);

    const modeMinimal = await handleCommands(
      buildParams({
        body: "/mode minimal",
        cfg,
        sessionKey,
        sessionEntry: sessionStore[sessionKey],
        sessionStore,
      }),
    );
    expect(modeMinimal.reply?.text).toContain("Memory mode is minimal");
    expect(sessionStore[sessionKey]?.memoryGuidanceMode).toBe("minimal");
  });

  it("blocks mutating task commands when durable memory commit fails", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "s5",
      updatedAt: Date.now(),
      activeTaskId: "default",
      taskStateById: {
        default: { updatedAt: Date.now(), status: "active" },
      },
    };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };
    const commitSpy = vi
      .spyOn(taskMemorySystem, "commitMemoryEvents")
      .mockRejectedValueOnce(new Error("forced wal failure"));
    try {
      const result = await handleCommands(
        buildParams({
          body: "/task set task-fail",
          cfg,
          sessionKey,
          sessionEntry,
          sessionStore,
        }),
      );
      expect(result.shouldContinue).toBe(false);
      expect(result.reply?.text).toContain("failed because memory commit did not persist");
      expect(sessionStore[sessionKey]?.activeTaskId).toBe("default");
      expect(sessionStore[sessionKey]?.taskStateById?.["task-fail"]).toBeUndefined();
    } finally {
      commitSpy.mockRestore();
    }
  });

  it("rolls back new pin writes when durable commit fails", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s6", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };
    const pinText = "rollback add sentinel";
    const commitSpy = vi
      .spyOn(taskMemorySystem, "commitMemoryEvents")
      .mockRejectedValueOnce(new Error("forced wal failure"));
    try {
      const result = await handleCommands(
        buildParams({
          body: `/pin fact ${pinText}`,
          cfg,
          sessionKey,
          sessionEntry,
          sessionStore,
        }),
      );
      expect(result.shouldContinue).toBe(false);
      expect(result.reply?.text).toContain("failed because memory commit did not persist");

      const parsed = JSON.parse(
        await fs.readFile(path.join(workspaceDir, "memory", ".pins.json"), "utf-8"),
      ) as {
        pins: Array<{ text: string }>;
      };
      expect(parsed.pins.some((pin) => pin.text.toLowerCase() === pinText)).toBe(false);
    } finally {
      commitSpy.mockRestore();
    }
  });

  it("rolls back pin edits when durable commit fails", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as MoltbotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "s7", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };
    const originalText = "rollback edit before";
    const editedText = "rollback edit after";

    await handleCommands(
      buildParams({
        body: `/pin fact ${originalText}`,
        cfg,
        sessionKey,
        sessionEntry,
        sessionStore,
      }),
    );
    const beforeEdit = JSON.parse(
      await fs.readFile(path.join(workspaceDir, "memory", ".pins.json"), "utf-8"),
    ) as {
      pins: Array<{ id: string; text: string }>;
    };
    const target = beforeEdit.pins.find((pin) => pin.text.toLowerCase() === originalText);
    expect(target?.id).toBeTruthy();
    if (!target?.id) {
      throw new Error("expected pin id for edit rollback test");
    }

    const commitSpy = vi
      .spyOn(taskMemorySystem, "commitMemoryEvents")
      .mockRejectedValueOnce(new Error("forced wal failure"));
    try {
      const result = await handleCommands(
        buildParams({
          body: `/pin edit ${target.id} ${editedText}`,
          cfg,
          sessionKey,
          sessionEntry: sessionStore[sessionKey],
          sessionStore,
        }),
      );
      expect(result.shouldContinue).toBe(false);
      expect(result.reply?.text).toContain("failed because memory commit did not persist");

      const afterEdit = JSON.parse(
        await fs.readFile(path.join(workspaceDir, "memory", ".pins.json"), "utf-8"),
      ) as {
        pins: Array<{ id: string; text: string }>;
      };
      const updated = afterEdit.pins.find((pin) => pin.id === target.id);
      expect(updated?.text.toLowerCase()).toBe(originalText);
    } finally {
      commitSpy.mockRestore();
    }
  });
});
