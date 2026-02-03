import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn(async () => []);
const getTaskRegistryTask = vi.fn(async () => null);

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => ({
      manager: {
        search,
        readFile: async () => ({ path: "memory/global/test.md", text: "ok" }),
        status: () => ({
          files: 0,
          chunks: 0,
          dirty: false,
          workspaceDir: "/tmp",
          dbPath: "/tmp/index.sqlite",
          provider: "mock",
          model: "mock-embed",
          requestedProvider: "mock",
          retrievalVersion: {
            configHash: "test",
            embeddingModel: "mock-embed",
            bm25ConfigVersion: "bm25-v1",
          },
        }),
      },
    }),
  };
});

vi.mock("../../memory/task-memory-system.js", () => ({
  getTaskRegistryTask: (...args: unknown[]) => getTaskRegistryTask(...args),
}));

import { createMemorySearchTool } from "./memory-tool.js";

describe("memory_search task context", () => {
  beforeEach(() => {
    search.mockReset();
    search.mockImplementation(async () => []);
    getTaskRegistryTask.mockReset();
    getTaskRegistryTask.mockResolvedValue(null);
  });

  it("passes task-aware deterministic search options to memory manager", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:main",
      taskId: "task-a",
    });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("tool missing");

    await tool.execute("call_1", {
      query: "alpha",
      namespace: "task",
      taskId: "task-b",
      maxResults: 3,
      minScore: 0.1,
    });

    expect(search).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        taskId: "task-b",
        namespace: "task",
        maxResults: 3,
        minScore: 0.1,
        sessionKey: "agent:main:main",
      }),
    );
  });

  it("caps linked-task retrieval and labels linked snippets", async () => {
    search.mockImplementation(async (_query, opts) => {
      const taskId = (opts as { taskId?: string }).taskId;
      if (taskId === "task-a") {
        return [
          {
            path: "memory/tasks/task-a.md",
            startLine: 1,
            endLine: 2,
            score: 0.9,
            snippet: "primary result",
            source: "memory",
          },
        ];
      }
      return [
        {
          path: `memory/tasks/${taskId}.md`,
          startLine: 1,
          endLine: 2,
          score: 0.8,
          snippet: `linked from ${taskId}`,
          source: "memory",
        },
        {
          path: `memory/tasks/${taskId}/notes.md`,
          startLine: 3,
          endLine: 4,
          score: 0.7,
          snippet: `linked extra ${taskId}`,
          source: "memory",
        },
      ];
    });
    getTaskRegistryTask.mockResolvedValue({
      taskId: "task-a",
      links: ["task-b", "task-c", "task-d", "task-e"],
    });
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:main",
      taskId: "task-a",
    });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("tool missing");

    const result = await tool.execute("call_2", {
      query: "alpha",
      namespace: "task",
      maxResults: 4,
    });
    const payload = result.details as { results?: Array<{ snippet: string }> };
    const results = payload.results ?? [];
    expect(results.length).toBeLessThanOrEqual(4);
    const linked = results.filter((entry) => entry.snippet.startsWith("[related task:"));
    expect(linked.length).toBeLessThanOrEqual(3);
    if (linked.length > 0) {
      expect(linked[0]?.snippet).toContain("[related task:");
    }
  });

  it("respects configured linked-task snippet cap", async () => {
    search.mockImplementation(async (_query, opts) => {
      const taskId = (opts as { taskId?: string }).taskId;
      if (taskId === "task-a") {
        return [];
      }
      return [
        {
          path: `memory/tasks/${taskId}.md`,
          startLine: 1,
          endLine: 2,
          score: 0.8,
          snippet: `linked from ${taskId}`,
          source: "memory",
        },
      ];
    });
    getTaskRegistryTask.mockResolvedValue({
      taskId: "task-a",
      links: ["task-b", "task-c"],
    });
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            query: {
              linkedTaskSnippetCap: 1,
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };
    const tool = createMemorySearchTool({
      config: cfg as any,
      agentSessionKey: "agent:main:main",
      taskId: "task-a",
    });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("tool missing");

    const result = await tool.execute("call_3", {
      query: "alpha",
      namespace: "task",
      maxResults: 5,
    });
    const payload = result.details as { results?: Array<{ snippet: string }> };
    const linked = (payload.results ?? []).filter((entry) =>
      entry.snippet.startsWith("[related task:"),
    );
    expect(linked).toHaveLength(1);
  });
});
