import type { AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore, saveSessionStore } from "../config/sessions.js";
import {
  createDurableMemoryMaintenanceJob,
  createDurableMemoryWorkerTools,
} from "./durable-memory-maintenance.js";
import {
  createPostTurnMaintenanceManager,
  type PostTurnMaintenanceContext,
} from "./post-turn-maintenance.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tempDirs = new Set<string>();

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function textMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function assistantWriteCall(pathValue: string, toolCallId = "call_1"): AgentMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: toolCallId,
        name: "write",
        arguments: { path: pathValue, content: "remembered" },
      },
    ],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResult(toolCallId: string, toolName = "write"): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "ok" }],
    timestamp: Date.now(),
  } as AgentMessage;
}

async function setupSessionState() {
  const workspaceDir = await makeTempDir("openclaw-durable-memory-workspace-");
  const sessionFile = path.join(workspaceDir, "session.jsonl");
  const storePath = path.join(workspaceDir, "sessions.json");
  const sessionKey = "agent:main:memory-test";
  const config = {
    session: {
      store: storePath,
    },
  } as OpenClawConfig;

  await fs.writeFile(sessionFile, "main-session\n", "utf-8");
  await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Durable Memory\n", "utf-8");
  await saveSessionStore(storePath, {
    [sessionKey]: {
      sessionId: "session-1",
      sessionFile,
      updatedAt: Date.now(),
    },
  });

  const makeContext = (messagesSnapshot: AgentMessage[]): PostTurnMaintenanceContext => ({
    sessionId: "session-1",
    sessionKey,
    sessionFile,
    workspaceDir,
    agentId: "main",
    config,
    provider: "openai",
    model: "gpt-test",
    messagesSnapshot,
  });

  return { workspaceDir, sessionFile, storePath, sessionKey, config, makeContext };
}

describe("createDurableMemoryMaintenanceJob", () => {
  it("skips extraction when the main agent already wrote memory files", async () => {
    const { storePath, sessionKey, makeContext } = await setupSessionState();
    const runExtractor = vi.fn(async () => {});
    const job = createDurableMemoryMaintenanceJob({ runExtractor });

    await job.run(
      makeContext([
        textMessage("user", "Remember that we prefer short deploy windows."),
        assistantWriteCall("memory/global/preferences.md"),
        toolResult("call_1"),
      ]),
    );

    expect(runExtractor).not.toHaveBeenCalled();
    expect(loadSessionStore(storePath)[sessionKey]?.maintenance?.durableMemory).toMatchObject({
      cursorVisibleMessageCount: 2,
      eligibleTurns: 0,
      lastSkipReason: "main_memory_write",
    });
  });

  it("writes back memory changes, advances the cursor, and leaves the main transcript untouched", async () => {
    const { workspaceDir, sessionFile, storePath, sessionKey, makeContext } =
      await setupSessionState();
    const runExtractor = vi.fn(async (params: { workspaceDir: string; prompt: string }) => {
      expect(params.prompt).toContain("Current durable memory manifest:");
      expect(params.prompt).toContain("Recent conversation slice:");
      expect(params.prompt).toContain("Remember that deploys should stay small");
      await fs.mkdir(path.join(params.workspaceDir, "memory", "global"), { recursive: true });
      await fs.writeFile(
        path.join(params.workspaceDir, "memory", "global", "preferences.md"),
        "# Preferences\n- Keep deploys small.\n",
        "utf-8",
      );
    });
    const job = createDurableMemoryMaintenanceJob({ runExtractor });

    await job.run(
      makeContext([
        textMessage("user", "Remember that deploys should stay small."),
        textMessage("assistant", "I will keep that in durable memory."),
      ]),
    );

    await expect(
      fs.readFile(path.join(workspaceDir, "memory", "global", "preferences.md"), "utf-8"),
    ).resolves.toContain("Keep deploys small");
    await expect(fs.readFile(sessionFile, "utf-8")).resolves.toBe("main-session\n");
    expect(loadSessionStore(storePath)[sessionKey]?.maintenance?.durableMemory).toEqual(
      expect.objectContaining({
        cursorVisibleMessageCount: 2,
        eligibleTurns: 0,
      }),
    );
  });

  it("accumulates eligible turns until the throttle threshold is reached", async () => {
    const { storePath, sessionKey, makeContext } = await setupSessionState();
    const runExtractor = vi.fn(async () => {});
    const job = createDurableMemoryMaintenanceJob({
      turnThrottle: 2,
      runExtractor,
    });

    await job.run(
      makeContext([
        textMessage("user", "First durable detail."),
        textMessage("assistant", "Noted."),
      ]),
    );

    expect(runExtractor).not.toHaveBeenCalled();
    expect(loadSessionStore(storePath)[sessionKey]?.maintenance?.durableMemory).toMatchObject({
      eligibleTurns: 1,
    });

    await job.run(
      makeContext([
        textMessage("user", "First durable detail."),
        textMessage("assistant", "Noted."),
        textMessage("user", "Second durable detail."),
        textMessage("assistant", "Also noted."),
      ]),
    );

    expect(runExtractor).toHaveBeenCalledTimes(1);
    expect(loadSessionStore(storePath)[sessionKey]?.maintenance?.durableMemory).toMatchObject({
      cursorVisibleMessageCount: 4,
      eligibleTurns: 0,
    });
  });

  it("runs a trailing coalesced pass against the latest context", async () => {
    const { storePath, sessionKey, makeContext } = await setupSessionState();
    const allowFirstToFinish = deferred();
    const firstStarted = deferred();
    const prompts: string[] = [];
    const runExtractor = vi.fn(async (params: { prompt: string }) => {
      prompts.push(params.prompt);
      if (prompts.length === 1) {
        firstStarted.resolve();
        await allowFirstToFinish.promise;
      }
    });
    const job = createDurableMemoryMaintenanceJob({ runExtractor });
    const manager = createPostTurnMaintenanceManager([job]);

    manager.schedule(
      makeContext([
        textMessage("user", "First durable detail."),
        textMessage("assistant", "Noted."),
      ]),
    );
    await firstStarted.promise;

    manager.schedule(
      makeContext([
        textMessage("user", "First durable detail."),
        textMessage("assistant", "Noted."),
        textMessage("user", "Second durable detail."),
        textMessage("assistant", "Also noted."),
      ]),
    );

    allowFirstToFinish.resolve();

    await expect(manager.drainPendingMaintenance(1_000, sessionKey)).resolves.toBe(true);
    expect(runExtractor).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("Second durable detail.");
    expect(loadSessionStore(storePath)[sessionKey]?.maintenance?.durableMemory).toMatchObject({
      cursorVisibleMessageCount: 4,
      eligibleTurns: 0,
    });
  });
});

describe("createDurableMemoryWorkerTools", () => {
  it("blocks writes outside the durable memory paths", async () => {
    const workspaceDir = await makeTempDir("openclaw-durable-memory-tools-");
    await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
    const tools = createDurableMemoryWorkerTools(workspaceDir);
    const writeTool = tools.find((tool) => tool.name === "write");

    expect(writeTool).toBeDefined();

    const denied = await writeTool!.execute("call-denied", {
      path: "notes.md",
      content: "nope",
    });
    const deniedText =
      denied.content.find((block) => block.type === "text" && "text" in block)?.text ?? "";
    expect(deniedText).toContain("may only access MEMORY.md or files under memory/");

    await writeTool!.execute("call-allowed", {
      path: "memory/global/allowed.md",
      content: "ok",
    });
    await expect(
      fs.readFile(path.join(workspaceDir, "memory", "global", "allowed.md"), "utf-8"),
    ).resolves.toBe("ok");
  });
});
