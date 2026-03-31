import { describe, expect, it, vi } from "vitest";
import type { AgentsFilesGetResult, AgentsFilesListResult } from "../types.ts";
import {
  agentFileCacheKey,
  loadAgentFileContent,
  loadAgentFiles,
  type AgentFilesState,
} from "./agent-files.ts";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createState(
  request: (method: string, params: unknown) => Promise<unknown>,
): AgentFilesState {
  return {
    client: { request } as unknown as AgentFilesState["client"],
    connected: true,
    agentFilesLoading: false,
    agentFilesError: null,
    agentFilesList: null,
    agentFileContents: {},
    agentFileDrafts: {},
    agentFileActive: null,
    agentFileSaving: false,
  };
}

describe("agent files controller", () => {
  it("stores same-named files separately per agent", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method !== "agents.files.get") {
        return null;
      }
      const payload = params as { agentId: string; name: string };
      const content = payload.agentId === "agent-a" ? "agent-a content" : "agent-b content";
      return {
        agentId: payload.agentId,
        workspace: `/workspace/${payload.agentId}`,
        file: {
          name: payload.name,
          path: `${payload.agentId}/${payload.name}`,
          missing: false,
          content,
        },
      } satisfies AgentsFilesGetResult;
    });
    const state = createState(request);

    await loadAgentFileContent(state, "agent-a", "instructions.md");
    await loadAgentFileContent(state, "agent-b", "instructions.md");

    expect(state.agentFileContents[agentFileCacheKey("agent-a", "instructions.md")]).toBe(
      "agent-a content",
    );
    expect(state.agentFileContents[agentFileCacheKey("agent-b", "instructions.md")]).toBe(
      "agent-b content",
    );
  });

  it("drops stale file list responses when switching agents quickly", async () => {
    const first = createDeferred<AgentsFilesListResult>();
    const second = createDeferred<AgentsFilesListResult>();
    const request = vi.fn((method: string, params: unknown) => {
      const payload = params as { agentId?: string };
      if (method === "agents.files.list" && payload.agentId === "agent-a") {
        return first.promise;
      }
      if (method === "agents.files.list" && payload.agentId === "agent-b") {
        return second.promise;
      }
      return Promise.resolve(null);
    });
    const state = createState(request);

    const agentA = loadAgentFiles(state, "agent-a");
    const agentB = loadAgentFiles(state, "agent-b");

    second.resolve({
      agentId: "agent-b",
      workspace: "/workspace/agent-b",
      files: [{ name: "instructions.md", path: "agent-b/instructions.md", missing: false }],
    });
    await agentB;
    expect(state.agentFilesList?.agentId).toBe("agent-b");

    first.resolve({
      agentId: "agent-a",
      workspace: "/workspace/agent-a",
      files: [{ name: "instructions.md", path: "agent-a/instructions.md", missing: false }],
    });
    await agentA;

    expect(state.agentFilesList?.agentId).toBe("agent-b");
    expect(state.agentFilesLoading).toBe(false);
  });
});
