import { loadBootstrapConfig } from "../config/bootstrap.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { getAgentRunContext, registerAgentRunContext } from "../infra/agent-events.js";
import { toAgentRequestSessionKey } from "../routing/session-key.js";
import { resolveSessionTaskId } from "../sessions/task-context.js";

export function resolveSessionKeyForRun(runId: string) {
  const cached = getAgentRunContext(runId)?.sessionKey;
  if (cached) {
    return cached;
  }
  const cfg = loadBootstrapConfig();
  const storePath = resolveStorePath(cfg.session?.store);
  const store = loadSessionStore(storePath);
  const found = Object.entries(store).find(([, entry]) => entry?.sessionId === runId);
  const storeKey = found?.[0];
  const entry = found?.[1];
  if (storeKey) {
    const sessionKey = toAgentRequestSessionKey(storeKey) ?? storeKey;
    registerAgentRunContext(runId, {
      sessionKey,
      taskId: resolveSessionTaskId({ entry }),
    });
    return sessionKey;
  }
  return undefined;
}
