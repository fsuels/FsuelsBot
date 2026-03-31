import type { GatewayBrowserClient } from "../gateway.ts";
import { normalizeAssistantIdentity } from "../assistant-identity.ts";
import {
  beginAsyncGeneration,
  isCurrentAsyncGeneration,
  logDroppedAsyncGeneration,
} from "../async-generation.ts";

export type AssistantIdentityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
};

export async function loadAssistantIdentity(
  state: AssistantIdentityState,
  opts?: { sessionKey?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const sessionKey = opts?.sessionKey?.trim() || state.sessionKey.trim();
  const params = sessionKey ? { sessionKey } : {};
  const generation = beginAsyncGeneration(state, "assistant.identity");
  try {
    const res = await state.client.request("agent.identity.get", params);
    if (!res) {
      return;
    }
    if (!isCurrentAsyncGeneration(state, "assistant.identity", generation)) {
      logDroppedAsyncGeneration("assistant.identity", { sessionKey });
      return;
    }
    const normalized = normalizeAssistantIdentity(res);
    state.assistantName = normalized.name;
    state.assistantAvatar = normalized.avatar;
    state.assistantAgentId = normalized.agentId ?? null;
  } catch {
    if (!isCurrentAsyncGeneration(state, "assistant.identity", generation)) {
      logDroppedAsyncGeneration("assistant.identity", { sessionKey, phase: "error" });
    }
    // Ignore errors; keep last known identity.
  }
}
