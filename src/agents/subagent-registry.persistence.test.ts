import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const noop = () => {};
const callGatewayMock = vi.fn(async () => ({
  status: "ok",
  startedAt: 111,
  endedAt: 222,
}));

function makeCleanupResult(
  overrides: Partial<{
    status: "completed" | "blocked" | "failed";
    reason:
      | "announcement_sent"
      | "announcement_queued"
      | "announcement_steered"
      | "active_run_still_processing"
      | "announcement_failed"
      | "session_delete_failed";
    didAnnounce: boolean;
    announcement: "sent" | "queued" | "steered" | "deferred" | "failed";
    childSessionCleanup: "deleted" | "not_requested" | "blocked" | "kept" | "failed";
    error?: string;
  }> = {},
) {
  return {
    status: "completed" as const,
    reason: "announcement_sent" as const,
    didAnnounce: true,
    announcement: "sent" as const,
    childSessionCleanup: "not_requested" as const,
    ...overrides,
  };
}

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../infra/agent-events.js", () => ({
  onAgentEvent: vi.fn(() => noop),
}));

const announceSpy = vi.fn(async () => makeCleanupResult());
vi.mock("./subagent-announce.js", () => ({
  runSubagentAnnounceFlowDetailed: (...args: unknown[]) => announceSpy(...args),
  runSubagentAnnounceFlow: async (...args: unknown[]) => {
    const result = await announceSpy(...args);
    return typeof result === "boolean" ? result : Boolean(result?.didAnnounce);
  },
}));

describe("subagent registry persistence", () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    announceSpy.mockClear();
    callGatewayMock.mockReset();
    callGatewayMock.mockImplementation(async () => ({
      status: "ok",
      startedAt: 111,
      endedAt: 222,
    }));
    vi.resetModules();
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("persists runs to disk and resumes after restart", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    vi.resetModules();
    const mod1 = await import("./subagent-registry.js");

    mod1.registerSubagentRun({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:test",
      requesterSessionKey: "agent:main:main",
      requesterOrigin: { channel: " whatsapp ", accountId: " acct-main " },
      requesterDisplayKey: "main",
      task: "do the thing",
      cleanup: "keep",
    });

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as { runs?: Record<string, unknown> };
    expect(parsed.runs && Object.keys(parsed.runs)).toContain("run-1");
    const run = parsed.runs?.["run-1"] as
      | {
          requesterOrigin?: { channel?: string; accountId?: string };
        }
      | undefined;
    expect(run).toBeDefined();
    if (run) {
      expect("requesterAccountId" in run).toBe(false);
      expect("requesterChannel" in run).toBe(false);
    }
    expect(run?.requesterOrigin?.channel).toBe("whatsapp");
    expect(run?.requesterOrigin?.accountId).toBe("acct-main");

    // Simulate a process restart: module re-import should load persisted runs
    // and trigger the announce flow once the run resolves.
    vi.resetModules();
    const mod2 = await import("./subagent-registry.js");
    mod2.initSubagentRegistry();

    // allow queued async wait/cleanup to execute
    await new Promise((r) => setTimeout(r, 0));

    expect(announceSpy).toHaveBeenCalled();

    type AnnounceParams = {
      childSessionKey: string;
      childRunId: string;
      requesterSessionKey: string;
      requesterOrigin?: { channel?: string; accountId?: string };
      task: string;
      cleanup: string;
      label?: string;
    };
    const first = announceSpy.mock.calls[0]?.[0] as unknown as AnnounceParams;
    expect(first.childSessionKey).toBe("agent:main:subagent:test");
    expect(first.requesterOrigin?.channel).toBe("whatsapp");
    expect(first.requesterOrigin?.accountId).toBe("acct-main");
  });

  it("retries stale cleanup when cleanupHandled was persisted", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const persisted = {
      version: 2,
      runs: {
        "run-2": {
          runId: "run-2",
          childSessionKey: "agent:main:subagent:two",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "do the other thing",
          cleanup: "keep",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
          cleanupHandled: true,
        },
      },
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");

    vi.resetModules();
    const mod = await import("./subagent-registry.js");
    mod.initSubagentRegistry();

    await new Promise((r) => setTimeout(r, 0));

    const calls = announceSpy.mock.calls.map((call) => call[0]);
    const match = calls.find(
      (params) =>
        (params as { childSessionKey?: string }).childSessionKey === "agent:main:subagent:two",
    );
    expect(match).toBeTruthy();
  });

  it("maps legacy announce fields into cleanup state", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const persisted = {
      version: 1,
      runs: {
        "run-legacy": {
          runId: "run-legacy",
          childSessionKey: "agent:main:subagent:legacy",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "legacy announce",
          cleanup: "keep",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
          announceCompletedAt: 9,
          announceHandled: true,
          requesterChannel: "whatsapp",
          requesterAccountId: "legacy-account",
        },
      },
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");

    vi.resetModules();
    const { loadSubagentRegistryFromDisk } = await import("./subagent-registry.store.js");
    const runs = loadSubagentRegistryFromDisk();
    const entry = runs.get("run-legacy");
    expect(entry?.cleanupHandled).toBe(true);
    expect(entry?.cleanupCompletedAt).toBe(9);
    expect(entry?.requesterOrigin?.channel).toBe("whatsapp");
    expect(entry?.requesterOrigin?.accountId).toBe("legacy-account");

    const after = JSON.parse(await fs.readFile(registryPath, "utf8")) as { version?: number };
    expect(after.version).toBe(2);
  });

  it("retries cleanup announce after a failed announce", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const persisted = {
      version: 2,
      runs: {
        "run-3": {
          runId: "run-3",
          childSessionKey: "agent:main:subagent:three",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "retry announce",
          cleanup: "keep",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
        },
      },
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");

    announceSpy.mockResolvedValueOnce(
      makeCleanupResult({
        status: "failed",
        reason: "announcement_failed",
        didAnnounce: false,
        announcement: "failed",
        childSessionCleanup: "kept",
      }),
    );
    vi.resetModules();
    const mod1 = await import("./subagent-registry.js");
    mod1.initSubagentRegistry();
    await new Promise((r) => setTimeout(r, 0));

    expect(announceSpy).toHaveBeenCalledTimes(1);
    const afterFirst = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs: Record<
        string,
        {
          cleanupHandled?: boolean;
          cleanupCompletedAt?: number;
          cleanupState?: string;
          cleanupReason?: string;
        }
      >;
    };
    expect(afterFirst.runs["run-3"].cleanupHandled).toBe(false);
    expect(afterFirst.runs["run-3"].cleanupCompletedAt).toBeUndefined();
    expect(afterFirst.runs["run-3"].cleanupState).toBe("failed");
    expect(afterFirst.runs["run-3"].cleanupReason).toBe("announcement_failed");

    announceSpy.mockResolvedValueOnce(makeCleanupResult());
    vi.resetModules();
    const mod2 = await import("./subagent-registry.js");
    mod2.initSubagentRegistry();
    await new Promise((r) => setTimeout(r, 0));

    expect(announceSpy).toHaveBeenCalledTimes(2);
    const afterSecond = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs: Record<string, { cleanupCompletedAt?: number }>;
    };
    expect(afterSecond.runs["run-3"].cleanupCompletedAt).toBeDefined();
  });

  it("keeps delete-mode runs retryable when announce is deferred", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const persisted = {
      version: 2,
      runs: {
        "run-4": {
          runId: "run-4",
          childSessionKey: "agent:main:subagent:four",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "deferred announce",
          cleanup: "delete",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
        },
      },
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");

    announceSpy.mockResolvedValueOnce(
      makeCleanupResult({
        status: "blocked",
        reason: "active_run_still_processing",
        didAnnounce: false,
        announcement: "deferred",
        childSessionCleanup: "blocked",
      }),
    );
    vi.resetModules();
    const mod1 = await import("./subagent-registry.js");
    mod1.initSubagentRegistry();
    await new Promise((r) => setTimeout(r, 0));

    expect(announceSpy).toHaveBeenCalledTimes(1);
    const afterFirst = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs: Record<
        string,
        { cleanupHandled?: boolean; cleanupState?: string; cleanupReason?: string }
      >;
    };
    expect(afterFirst.runs["run-4"]?.cleanupHandled).toBe(false);
    expect(afterFirst.runs["run-4"]?.cleanupState).toBe("blocked");
    expect(afterFirst.runs["run-4"]?.cleanupReason).toBe("active_run_still_processing");

    announceSpy.mockResolvedValueOnce(
      makeCleanupResult({
        childSessionCleanup: "deleted",
      }),
    );
    vi.resetModules();
    const mod2 = await import("./subagent-registry.js");
    mod2.initSubagentRegistry();
    await new Promise((r) => setTimeout(r, 0));

    expect(announceSpy).toHaveBeenCalledTimes(2);
    const afterSecond = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs?: Record<string, unknown>;
    };
    expect(afterSecond.runs?.["run-4"]).toBeUndefined();
  });

  it("blocks archive cleanup until post-run cleanup completed", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    vi.resetModules();
    const mod = await import("./subagent-registry.js");
    mod.addSubagentRunForTests({
      runId: "run-archive-blocked",
      childSessionKey: "agent:main:subagent:blocked",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "archive blocked",
      cleanup: "keep",
      createdAt: 1,
      startedAt: 1,
      archiveAtMs: 1,
      cleanupHandled: false,
      cleanupState: "pending",
    });

    await mod.sweepSubagentRunsForTests();

    expect(callGatewayMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "sessions.delete" }),
    );
    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const after = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs: Record<string, { cleanupState?: string; cleanupReason?: string }>;
    };
    expect(after.runs["run-archive-blocked"]?.cleanupState).toBe("blocked");
    expect(after.runs["run-archive-blocked"]?.cleanupReason).toBe("archive_waiting_for_cleanup");
  });

  it("keeps archive cleanup retryable when session deletion fails", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    callGatewayMock.mockRejectedValueOnce(new Error("delete failed"));
    vi.resetModules();
    const mod = await import("./subagent-registry.js");
    mod.addSubagentRunForTests({
      runId: "run-archive-retry",
      childSessionKey: "agent:main:subagent:retry",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "archive retry",
      cleanup: "keep",
      createdAt: 1,
      startedAt: 1,
      endedAt: 2,
      archiveAtMs: 1,
      cleanupHandled: true,
      cleanupCompletedAt: 3,
      cleanupState: "completed",
    });

    await mod.sweepSubagentRunsForTests();

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const afterFirst = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs: Record<
        string,
        { cleanupState?: string; cleanupReason?: string; cleanupError?: string }
      >;
    };
    expect(afterFirst.runs["run-archive-retry"]?.cleanupState).toBe("failed");
    expect(afterFirst.runs["run-archive-retry"]?.cleanupReason).toBe("archive_delete_failed");
    expect(afterFirst.runs["run-archive-retry"]?.cleanupError).toContain("delete failed");

    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await mod.sweepSubagentRunsForTests();

    const afterSecond = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      runs?: Record<string, unknown>;
    };
    expect(afterSecond.runs?.["run-archive-retry"]).toBeUndefined();
  });
});
