import type { GatewayBrowserClient } from "../gateway.ts";
import type { SkillStatusReport } from "../types.ts";
import {
  beginAsyncGeneration,
  isCurrentAsyncGeneration,
  logDroppedAsyncGeneration,
} from "../async-generation.ts";

export type AgentSkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
};

export async function loadAgentSkills(state: AgentSkillsState, agentId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const generation = beginAsyncGeneration(state, "agents.skills");
  state.agentSkillsLoading = true;
  state.agentSkillsError = null;
  try {
    const res = await state.client.request("skills.status", { agentId });
    if (!isCurrentAsyncGeneration(state, "agents.skills", generation)) {
      logDroppedAsyncGeneration("agents.skills", { agentId });
      return;
    }
    if (res) {
      state.agentSkillsReport = res as SkillStatusReport;
      state.agentSkillsAgentId = agentId;
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "agents.skills", generation)) {
      logDroppedAsyncGeneration("agents.skills", { agentId, phase: "error" });
      return;
    }
    state.agentSkillsError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "agents.skills", generation)) {
      state.agentSkillsLoading = false;
    }
  }
}
