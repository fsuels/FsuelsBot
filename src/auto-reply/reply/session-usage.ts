import { setCliSessionId } from "../../agents/cli-session.js";
import { hasNonzeroUsage, type NormalizedUsage } from "../../agents/usage.js";
import {
  type SessionSystemPromptReport,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { applySessionTaskUpdate, resolveSessionTaskId } from "../../sessions/task-context.js";

export async function persistSessionUsageUpdate(params: {
  storePath?: string;
  sessionKey?: string;
  usage?: NormalizedUsage;
  modelUsed?: string;
  providerUsed?: string;
  contextTokensUsed?: number;
  systemPromptReport?: SessionSystemPromptReport;
  cliSessionId?: string;
  logLabel?: string;
}): Promise<void> {
  const { storePath, sessionKey } = params;
  if (!storePath || !sessionKey) return;

  const label = params.logLabel ? `${params.logLabel} ` : "";
  if (hasNonzeroUsage(params.usage)) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          const input = params.usage?.input ?? 0;
          const output = params.usage?.output ?? 0;
          const promptTokens =
            input + (params.usage?.cacheRead ?? 0) + (params.usage?.cacheWrite ?? 0);
          const totalTokens = promptTokens > 0 ? promptTokens : (params.usage?.total ?? input);
          let nextEntry = applySessionTaskUpdate(entry, {
            taskId: resolveSessionTaskId({ entry }),
            totalTokens,
            updatedAt: Date.now(),
            source: "usage",
          });
          nextEntry = {
            ...nextEntry,
            inputTokens: input,
            outputTokens: output,
            totalTokens,
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: params.contextTokensUsed ?? entry.contextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            updatedAt: Date.now(),
          };
          const cliProvider = params.providerUsed ?? entry.modelProvider;
          if (params.cliSessionId && cliProvider) {
            setCliSessionId(nextEntry, cliProvider, params.cliSessionId);
          }
          return nextEntry;
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}usage update: ${String(err)}`);
    }
    return;
  }

  if (params.modelUsed || params.contextTokensUsed) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          let nextEntry = applySessionTaskUpdate(entry, {
            taskId: resolveSessionTaskId({ entry }),
            updatedAt: Date.now(),
            source: "usage",
          });
          nextEntry = {
            ...nextEntry,
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: params.contextTokensUsed ?? entry.contextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            updatedAt: Date.now(),
          };
          const cliProvider = params.providerUsed ?? entry.modelProvider;
          if (params.cliSessionId && cliProvider) {
            setCliSessionId(nextEntry, cliProvider, params.cliSessionId);
          }
          return nextEntry;
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}model/context update: ${String(err)}`);
    }
  }
}
