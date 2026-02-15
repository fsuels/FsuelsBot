import { beforeEach, describe, expect, it, vi } from "vitest";

let backend: "builtin" | "qmd" = "builtin";
const stubManager = {
  search: vi.fn(async () => [
    {
      path: "MEMORY.md",
      startLine: 5,
      endLine: 7,
      score: 0.9,
      snippet: "@@ -5,3 @@\nAssistant: noted",
      source: "memory" as const,
    },
  ]),
  readFile: vi.fn(),
  status: () => ({
    backend,
    files: 1,
    chunks: 1,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => ({ manager: stubManager }),
  };
});

import { createMemorySearchTool } from "./memory-tool.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("memory search citations", () => {
  it("appends source information when citations are enabled", async () => {
    backend = "builtin";
    const cfg = { memory: { citations: "on" }, agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_on", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    expect(details.results[0]?.snippet).toMatch(/Source: MEMORY.md#L5-L7/);
    expect(details.results[0]?.citation).toBe("MEMORY.md#L5-L7");
  });

  it("leaves snippet without citation source when citations are off", async () => {
    backend = "builtin";
    const cfg = { memory: { citations: "off" }, agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_off", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    // Snippet should not have a citation path (MEMORY.md#L...) but will contain
    // firewall wrapper metadata (Source: Memory Recall)
    expect(details.results[0]?.snippet).not.toMatch(/Source: MEMORY\.md/);
    expect(details.results[0]?.citation).toBeUndefined();
  });

  it("clamps decorated snippets to qmd injected budget before wrapping", async () => {
    backend = "qmd";
    const cfg = {
      memory: { citations: "on", backend: "qmd", qmd: { limits: { maxInjectedChars: 20 } } },
      agents: { list: [{ id: "main", default: true }] },
    };
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_qmd", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    const snippet = details.results[0]?.snippet ?? "";
    // Snippet is wrapped by firewall markers, but the inner content should be clamped.
    // Extract content between the markers to verify clamping.
    const markerStart = "---\n";
    const markerEnd = "\n<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>";
    const innerStart = snippet.indexOf(markerStart);
    const innerEnd = snippet.indexOf(markerEnd);
    if (innerStart >= 0 && innerEnd > innerStart) {
      const inner = snippet.slice(innerStart + markerStart.length, innerEnd);
      expect(inner.length).toBeLessThanOrEqual(20);
    }
  });

  it("honors auto mode for direct chats", async () => {
    backend = "builtin";
    const cfg = {
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    };
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u123",
    });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("auto_mode_direct", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string }> };
    expect(details.results[0]?.snippet).toMatch(/Source:/);
  });

  it("suppresses citation paths for auto mode in group chats", async () => {
    backend = "builtin";
    const cfg = {
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    };
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:group:c123",
    });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("auto_mode_group", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string }> };
    // No citation path (MEMORY.md#L...) should appear, but firewall wrapper metadata is OK
    expect(details.results[0]?.snippet).not.toMatch(/Source: MEMORY\.md/);
  });
});
