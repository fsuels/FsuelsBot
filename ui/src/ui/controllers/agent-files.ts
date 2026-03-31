import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AgentFileEntry,
  AgentsFilesGetResult,
  AgentsFilesListResult,
  AgentsFilesSetResult,
} from "../types.ts";
import {
  beginAsyncGeneration,
  isCurrentAsyncGeneration,
  logDroppedAsyncGeneration,
} from "../async-generation.ts";

export type AgentFilesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
};

export function agentFileCacheKey(agentId: string, name: string): string {
  return `${agentId}\u0000${name}`;
}

function mergeFileEntry(
  list: AgentsFilesListResult | null,
  entry: AgentFileEntry,
): AgentsFilesListResult | null {
  if (!list) {
    return list;
  }
  const hasEntry = list.files.some((file) => file.name === entry.name);
  const nextFiles = hasEntry
    ? list.files.map((file) => (file.name === entry.name ? entry : file))
    : [...list.files, entry];
  return { ...list, files: nextFiles };
}

export async function loadAgentFiles(state: AgentFilesState, agentId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const generation = beginAsyncGeneration(state, "agents.files.list");
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesListResult | null>("agents.files.list", {
      agentId,
    });
    if (!isCurrentAsyncGeneration(state, "agents.files.list", generation)) {
      logDroppedAsyncGeneration("agents.files.list", { agentId });
      return;
    }
    if (res) {
      state.agentFilesList = res;
      if (state.agentFileActive && !res.files.some((file) => file.name === state.agentFileActive)) {
        state.agentFileActive = null;
      }
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "agents.files.list", generation)) {
      logDroppedAsyncGeneration("agents.files.list", { agentId, phase: "error" });
      return;
    }
    state.agentFilesError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "agents.files.list", generation)) {
      state.agentFilesLoading = false;
    }
  }
}

export async function loadAgentFileContent(
  state: AgentFilesState,
  agentId: string,
  name: string,
  opts?: { force?: boolean; preserveDraft?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const cacheKey = agentFileCacheKey(agentId, name);
  if (!opts?.force && Object.hasOwn(state.agentFileContents, cacheKey)) {
    return;
  }
  const generation = beginAsyncGeneration(state, "agents.files.get");
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesGetResult | null>("agents.files.get", {
      agentId,
      name,
    });
    if (!isCurrentAsyncGeneration(state, "agents.files.get", generation)) {
      logDroppedAsyncGeneration("agents.files.get", { agentId, name });
      return;
    }
    if (res?.file) {
      const content = res.file.content ?? "";
      const previousBase = state.agentFileContents[cacheKey] ?? "";
      const currentDraft = state.agentFileDrafts[cacheKey];
      const preserveDraft = opts?.preserveDraft ?? true;
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [cacheKey]: content };
      if (
        !preserveDraft ||
        !Object.hasOwn(state.agentFileDrafts, cacheKey) ||
        currentDraft === previousBase
      ) {
        state.agentFileDrafts = { ...state.agentFileDrafts, [cacheKey]: content };
      }
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "agents.files.get", generation)) {
      logDroppedAsyncGeneration("agents.files.get", { agentId, name, phase: "error" });
      return;
    }
    state.agentFilesError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "agents.files.get", generation)) {
      state.agentFilesLoading = false;
    }
  }
}

export async function saveAgentFile(
  state: AgentFilesState,
  agentId: string,
  name: string,
  content: string,
) {
  if (!state.client || !state.connected || state.agentFileSaving) {
    return;
  }
  const cacheKey = agentFileCacheKey(agentId, name);
  const generation = beginAsyncGeneration(state, "agents.files.save");
  state.agentFileSaving = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesSetResult | null>("agents.files.set", {
      agentId,
      name,
      content,
    });
    if (!isCurrentAsyncGeneration(state, "agents.files.save", generation)) {
      logDroppedAsyncGeneration("agents.files.save", { agentId, name });
      return;
    }
    if (res?.file) {
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [cacheKey]: content };
      state.agentFileDrafts = { ...state.agentFileDrafts, [cacheKey]: content };
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "agents.files.save", generation)) {
      logDroppedAsyncGeneration("agents.files.save", { agentId, name, phase: "error" });
      return;
    }
    state.agentFilesError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "agents.files.save", generation)) {
      state.agentFileSaving = false;
    }
  }
}
