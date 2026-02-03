import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

let embedBatchCalls = 0;
let failEmbeddings = false;

vi.mock("./embeddings.js", () => {
  const embedText = (text: string) => {
    const lower = text.toLowerCase();
    const alpha = lower.split("alpha").length - 1;
    const beta = lower.split("beta").length - 1;
    return [alpha, beta];
  };
  return {
    createEmbeddingProvider: async (options: { model?: string }) => ({
      requestedProvider: "openai",
      provider: {
        id: "mock",
        model: options.model ?? "mock-embed",
        embedQuery: async (text: string) => embedText(text),
        embedBatch: async (texts: string[]) => {
          embedBatchCalls += 1;
          if (failEmbeddings) {
            throw new Error("mock embeddings failed");
          }
          return texts.map(embedText);
        },
      },
    }),
  };
});

describe("memory index", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    embedBatchCalls = 0;
    failEmbeddings = false;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-mem-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.mkdir(path.join(workspaceDir, "memory", "tasks"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "memory", "global"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-01-12.md"),
      "# Log\nAlpha memory line.\nZebra memory line.\nAnother line.",
    );
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Beta knowledge base entry.");
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("indexes memory files and searches by vector", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await result.manager.sync({ force: true });
    const results = await result.manager.search("alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory/2026-01-12.md");
    const status = result.manager.status();
    expect(status.sourceCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "memory",
          files: status.files,
          chunks: status.chunks,
        }),
      ]),
    );
  });

  it("uses task namespace filters before ranking and does not mix task memories", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "memory", "tasks", "task-a.md"),
      "Task A alpha details.",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "tasks", "task-b.md"),
      "Task B alpha details.",
    );
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await manager.sync({ force: true });

    const scoped = await manager.search("alpha", {
      taskId: "task-a",
      namespace: "task",
      globalFallback: false,
      maxResults: 10,
      minScore: 0,
    });
    expect(scoped.length).toBeGreaterThan(0);
    const paths = scoped.map((entry) => entry.path);
    expect(paths).toContain("memory/tasks/task-a.md");
    expect(paths.some((entry) => entry.includes("memory/tasks/task-b.md"))).toBe(false);
  });

  it("falls back to global namespace when task-scoped retrieval has no matches", async () => {
    await fs.writeFile(path.join(workspaceDir, "memory", "tasks", "task-a.md"), "Alpha task memory.");
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await manager.sync({ force: true });

    const fallback = await manager.search("beta", {
      taskId: "task-missing",
      namespace: "auto",
      maxResults: 10,
      minScore: 0,
    });
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.some((entry) => entry.path.startsWith("memory/tasks/"))).toBe(false);
  });

  it("attaches provenance metadata for task files and pin files", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "memory", "tasks", "task-a.md"),
      "Task A alpha item.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "global", "pins.md"),
      "## Constraints\n- [constraint] Always include tests.",
      "utf-8",
    );
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await manager.sync({ force: true });

    const taskResults = await manager.search("alpha", {
      taskId: "task-a",
      namespace: "task",
      globalFallback: false,
      maxResults: 5,
      minScore: 0,
    });
    const taskHit = taskResults.find((entry) => entry.path === "memory/tasks/task-a.md");
    expect(taskHit?.provenance?.source).toBe("task-file");
    expect(taskHit?.provenance?.taskId).toBe("task-a");
    expect(typeof taskHit?.provenance?.timestampMs).toBe("number");

    const pinResults = await manager.search("constraint", {
      namespace: "global",
      maxResults: 5,
      minScore: 0,
    });
    const pinHit = pinResults.find((entry) => entry.path === "memory/global/pins.md");
    expect(pinHit?.provenance?.source).toBe("pin");
    expect(pinHit?.provenance?.pinType).toBe("constraint");
  });

  it("reindexes when the embedding model changes", async () => {
    const base = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const first = await getMemorySearchManager({
      cfg: {
        ...base,
        agents: {
          ...base.agents,
          defaults: {
            ...base.agents.defaults,
            memorySearch: {
              ...base.agents.defaults.memorySearch,
              model: "mock-embed-v1",
            },
          },
        },
      },
      agentId: "main",
    });
    expect(first.manager).not.toBeNull();
    if (!first.manager) throw new Error("manager missing");
    await first.manager.sync({ force: true });
    await first.manager.close();

    const second = await getMemorySearchManager({
      cfg: {
        ...base,
        agents: {
          ...base.agents,
          defaults: {
            ...base.agents.defaults,
            memorySearch: {
              ...base.agents.defaults.memorySearch,
              model: "mock-embed-v2",
            },
          },
        },
      },
      agentId: "main",
    });
    expect(second.manager).not.toBeNull();
    if (!second.manager) throw new Error("manager missing");
    manager = second.manager;
    await second.manager.sync({ reason: "test" });
    const results = await second.manager.search("alpha");
    expect(results.length).toBeGreaterThan(0);
  });

  it("reuses cached embeddings on forced reindex", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            cache: { enabled: true },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await manager.sync({ force: true });
    const afterFirst = embedBatchCalls;
    expect(afterFirst).toBeGreaterThan(0);

    await manager.sync({ force: true });
    expect(embedBatchCalls).toBe(afterFirst);
  });

  it("preserves existing index when forced reindex fails", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            cache: { enabled: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });
    const before = manager.status();
    expect(before.files).toBeGreaterThan(0);

    failEmbeddings = true;
    await expect(manager.sync({ force: true })).rejects.toThrow(/mock embeddings failed/i);

    const after = manager.status();
    expect(after.files).toBe(before.files);
    expect(after.chunks).toBe(before.chunks);

    const files = await fs.readdir(workspaceDir);
    expect(files.some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("finds keyword matches via hybrid search when query embedding is zero", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const status = manager.status();
    if (!status.fts?.available) return;

    await manager.sync({ force: true });
    const results = await manager.search("zebra");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory/2026-01-12.md");
  });

  it("hybrid weights can favor vector-only matches over keyword-only matches", async () => {
    const manyAlpha = Array.from({ length: 200 }, () => "Alpha").join(" ");
    await fs.writeFile(
      path.join(workspaceDir, "memory", "vector-only.md"),
      "Alpha beta. Alpha beta. Alpha beta. Alpha beta.",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "keyword-only.md"),
      `${manyAlpha} beta id123.`,
    );

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              maxResults: 200,
              hybrid: {
                enabled: true,
                vectorWeight: 0.99,
                textWeight: 0.01,
                candidateMultiplier: 10,
              },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const status = manager.status();
    if (!status.fts?.available) return;

    await manager.sync({ force: true });
    const results = await manager.search("alpha beta id123");
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("memory/vector-only.md");
    expect(paths).toContain("memory/keyword-only.md");
    const vectorOnly = results.find((r) => r.path === "memory/vector-only.md");
    const keywordOnly = results.find((r) => r.path === "memory/keyword-only.md");
    expect((vectorOnly?.score ?? 0) > (keywordOnly?.score ?? 0)).toBe(true);
  });

  it("hybrid weights can favor keyword matches when text weight dominates", async () => {
    const manyAlpha = Array.from({ length: 200 }, () => "Alpha").join(" ");
    await fs.writeFile(
      path.join(workspaceDir, "memory", "vector-only.md"),
      "Alpha beta. Alpha beta. Alpha beta. Alpha beta.",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "keyword-only.md"),
      `${manyAlpha} beta id123.`,
    );

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              maxResults: 200,
              hybrid: {
                enabled: true,
                vectorWeight: 0.01,
                textWeight: 0.99,
                candidateMultiplier: 10,
              },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const status = manager.status();
    if (!status.fts?.available) return;

    await manager.sync({ force: true });
    const results = await manager.search("alpha beta id123");
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("memory/vector-only.md");
    expect(paths).toContain("memory/keyword-only.md");
    const vectorOnly = results.find((r) => r.path === "memory/vector-only.md");
    const keywordOnly = results.find((r) => r.path === "memory/keyword-only.md");
    expect((keywordOnly?.score ?? 0) > (vectorOnly?.score ?? 0)).toBe(true);
  });

  it("reports vector availability after probe", async () => {
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
    const available = await result.manager.probeVectorAvailability();
    const status = result.manager.status();
    expect(status.vector?.enabled).toBe(true);
    expect(typeof status.vector?.available).toBe("boolean");
    expect(status.vector?.available).toBe(available);
  });

  it("rejects reading non-memory paths", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;
    await expect(result.manager.readFile({ relPath: "NOTES.md" })).rejects.toThrow("path required");
  });

  it("rejects memory_get path traversal into sibling workspace-prefixed directories", async () => {
    const siblingDir = path.join(path.dirname(workspaceDir), `${path.basename(workspaceDir)}-sibling`);
    const siblingMemoryDir = path.join(siblingDir, "memory");
    await fs.mkdir(siblingMemoryDir, { recursive: true });
    await fs.writeFile(path.join(siblingMemoryDir, "outside.md"), "outside", "utf-8");

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    const escapePath = `memory/../../${path.basename(siblingDir)}/memory/outside.md`;
    await expect(result.manager.readFile({ relPath: escapePath })).rejects.toThrow(
      "path escapes workspace",
    );
  });
});
