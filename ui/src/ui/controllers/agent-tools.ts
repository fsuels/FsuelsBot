import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsToolsCatalogResult } from "../types.ts";
import {
  beginAsyncGeneration,
  isCurrentAsyncGeneration,
  logDroppedAsyncGeneration,
} from "../async-generation.ts";

export type AgentToolsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentToolsCatalogLoading: boolean;
  agentToolsCatalogError: string | null;
  agentToolsCatalog: AgentsToolsCatalogResult | null;
};

export async function loadAgentToolsCatalog(state: AgentToolsState, agentId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentToolsCatalog?.agentId === agentId) {
    return;
  }
  const generation = beginAsyncGeneration(state, "agents.tools.catalog");
  state.agentToolsCatalogLoading = true;
  state.agentToolsCatalogError = null;
  try {
    const res = await state.client.request<AgentsToolsCatalogResult>("agents.tools.catalog", {
      agentId,
    });
    if (!isCurrentAsyncGeneration(state, "agents.tools.catalog", generation)) {
      logDroppedAsyncGeneration("agents.tools.catalog", { agentId });
      return;
    }
    if (res) {
      state.agentToolsCatalog = res;
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "agents.tools.catalog", generation)) {
      logDroppedAsyncGeneration("agents.tools.catalog", { agentId, phase: "error" });
      return;
    }
    state.agentToolsCatalogError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "agents.tools.catalog", generation)) {
      state.agentToolsCatalogLoading = false;
    }
  }
}
