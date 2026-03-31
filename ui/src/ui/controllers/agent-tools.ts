import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsToolsCatalogResult } from "../types.ts";

export type AgentToolsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentToolsCatalogLoading: boolean;
  agentToolsCatalogError: string | null;
  agentToolsCatalog: AgentsToolsCatalogResult | null;
};

export async function loadAgentToolsCatalog(state: AgentToolsState, agentId: string) {
  if (!state.client || !state.connected || state.agentToolsCatalogLoading) {
    return;
  }
  if (state.agentToolsCatalog?.agentId === agentId) {
    return;
  }
  state.agentToolsCatalogLoading = true;
  state.agentToolsCatalogError = null;
  try {
    const res = await state.client.request<AgentsToolsCatalogResult>("agents.tools.catalog", {
      agentId,
    });
    if (res) {
      state.agentToolsCatalog = res;
    }
  } catch (err) {
    state.agentToolsCatalogError = String(err);
  } finally {
    state.agentToolsCatalogLoading = false;
  }
}
