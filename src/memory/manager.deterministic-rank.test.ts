import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "mock",
      model: "mock-embed",
      embedQuery: async () => [1, 0, 0],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    },
  }),
}));

describe("memory manager deterministic ranking", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-mem-rank-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "memory", "global", "notes.md"), "alpha", "utf-8");
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("prefers durable memory over transcript results at equal scores", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const ranked = (manager as any).rankDeterministic([
      {
        path: "sessions/a.jsonl",
        startLine: 1,
        endLine: 1,
        score: 0.9,
        snippet: "decision: use v2",
        source: "sessions",
        provenance: {
          source: "transcript",
          sourcePath: "sessions/a.jsonl",
          explicit: true,
          inferred: false,
        },
      },
      {
        path: "memory/tasks/task-a.md",
        startLine: 1,
        endLine: 1,
        score: 0.9,
        snippet: "decision: use v2",
        source: "memory",
        provenance: {
          source: "task-file",
          sourcePath: "memory/tasks/task-a.md",
          explicit: true,
          inferred: false,
        },
      },
    ]);
    expect(ranked[0]?.provenance?.source).toBe("task-file");
    expect(ranked[1]?.provenance?.source).toBe("transcript");
  });

  it("filters out-of-scope task candidates before deterministic ranking", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            query: {
              hybrid: { enabled: false },
            },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const rankSpy = vi.spyOn(manager as any, "rankDeterministic");
    vi.spyOn(manager as any, "searchVector").mockResolvedValue([
      {
        id: "task-a",
        path: "memory/tasks/task-a.md",
        startLine: 1,
        endLine: 1,
        score: 0.9,
        snippet: "task-a decision",
        source: "memory",
      },
      {
        id: "task-b",
        path: "memory/tasks/task-b.md",
        startLine: 1,
        endLine: 1,
        score: 0.99,
        snippet: "task-b decision",
        source: "memory",
      },
    ]);

    const scoped = await (manager as any).searchScoped(
      "alpha",
      [1, 0, 0],
      { scope: "task", taskId: "task-a" },
      5,
      0,
    );

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.path).toBe("memory/tasks/task-a.md");
    expect(scoped.some((entry: { path: string }) => entry.path.includes("task-b"))).toBe(false);

    const rankedInput = rankSpy.mock.calls[0]?.[0] as Array<{ path: string }> | undefined;
    expect(rankedInput).toBeDefined();
    expect(rankedInput?.some((entry) => entry.path.includes("task-b"))).toBe(false);
  });

  it("filters out-of-scope candidates before hybrid merge scoring inputs", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            query: {
              hybrid: { enabled: true, vectorWeight: 0.7, textWeight: 0.3, candidateMultiplier: 2 },
            },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const mergeOriginal = (manager as any).mergeHybridResults.bind(manager);
    const mergeSpy = vi
      .spyOn(manager as any, "mergeHybridResults")
      .mockImplementation((params: unknown) => mergeOriginal(params));

    vi.spyOn(manager as any, "searchVector").mockResolvedValue([
      {
        id: "v-task-a",
        path: "memory/tasks/task-a.md",
        startLine: 1,
        endLine: 1,
        score: 0.91,
        snippet: "vector task-a",
        source: "memory",
      },
      {
        id: "v-task-b",
        path: "memory/tasks/task-b.md",
        startLine: 1,
        endLine: 1,
        score: 0.95,
        snippet: "vector task-b",
        source: "memory",
      },
    ]);
    vi.spyOn(manager as any, "searchKeyword").mockResolvedValue([
      {
        id: "k-task-a",
        path: "memory/tasks/task-a.md",
        startLine: 2,
        endLine: 2,
        score: 0.8,
        textScore: 0.8,
        snippet: "keyword task-a",
        source: "memory",
      },
      {
        id: "k-task-b",
        path: "memory/tasks/task-b.md",
        startLine: 2,
        endLine: 2,
        score: 0.99,
        textScore: 0.99,
        snippet: "keyword task-b",
        source: "memory",
      },
    ]);

    await (manager as any).searchScoped(
      "alpha",
      [1, 0, 0],
      { scope: "task", taskId: "task-a" },
      5,
      0,
    );

    const mergeInput = mergeSpy.mock.calls[0]?.[0] as
      | {
          vector: Array<{ path: string }>;
          keyword: Array<{ path: string }>;
        }
      | undefined;
    expect(mergeInput).toBeDefined();
    expect(mergeInput?.vector).toHaveLength(1);
    expect(mergeInput?.keyword).toHaveLength(1);
    expect(mergeInput?.vector[0]?.path).toBe("memory/tasks/task-a.md");
    expect(mergeInput?.keyword[0]?.path).toBe("memory/tasks/task-a.md");
  });

  it("allows semantic dominance to outrank higher-priority classes", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            query: {
              deterministic: {
                minSimilarity: 0.35,
                overrideDelta: 0.12,
                nearTieRelativeEpsilon: 0.0001,
                nearTieAbsoluteEpsilon: 0.000001,
              },
            },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const ranked = (manager as any).rankDeterministic([
      {
        path: "memory/global/pins.md",
        startLine: 1,
        endLine: 1,
        score: 0.36,
        snippet: "[constraint] stay on old stack",
        source: "memory",
        provenance: {
          source: "pin",
          sourcePath: "memory/global/pins.md",
          explicit: true,
          inferred: false,
        },
      },
      {
        path: "memory/tasks/task-a.md",
        startLine: 1,
        endLine: 1,
        score: 0.88,
        snippet: "implementation details for new stack",
        source: "memory",
        provenance: {
          source: "task-file",
          sourcePath: "memory/tasks/task-a.md",
          explicit: true,
          inferred: false,
        },
      },
    ]);
    expect(ranked[0]?.path).toBe("memory/tasks/task-a.md");
    expect(ranked[0]?.ranking?.overrideApplied).toBe(true);
  });

  it("keeps durable-over-transcript behavior under near-tie relative epsilon policy", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            query: {
              deterministic: {
                nearTieRelativeEpsilon: 0.0002,
                nearTieAbsoluteEpsilon: 0.000001,
              },
            },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const ranked = (manager as any).rankDeterministic([
      {
        path: "sessions/a.jsonl",
        startLine: 1,
        endLine: 1,
        score: 0.9,
        snippet: "decision: use v2",
        source: "sessions",
        provenance: {
          source: "transcript",
          sourcePath: "sessions/a.jsonl",
          explicit: true,
          inferred: false,
        },
      },
      {
        path: "memory/tasks/task-a.md",
        startLine: 1,
        endLine: 1,
        score: 0.90001,
        snippet: "decision: use v2",
        source: "memory",
        provenance: {
          source: "task-file",
          sourcePath: "memory/tasks/task-a.md",
          explicit: true,
          inferred: false,
        },
      },
    ]);
    expect(ranked[0]?.provenance?.source).toBe("task-file");
  });
});
