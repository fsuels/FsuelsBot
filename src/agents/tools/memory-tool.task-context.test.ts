import { describe, expect, it, vi } from "vitest";

const search = vi.fn(async () => []);

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
        }),
      },
    }),
  };
});

import { createMemorySearchTool } from "./memory-tool.js";

describe("memory_search task context", () => {
  it("passes task-aware deterministic search options to memory manager", async () => {
    search.mockClear();
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg, agentSessionKey: "agent:main:main", taskId: "task-a" });
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
});
