import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { resolveTaskScopedHistoryMessages } from "../sessions/task-context.js";
import { estimateMessagesTokens } from "./compaction.js";
import { validateAnthropicTurns, validateGeminiTurns } from "./pi-embedded-helpers.js";
import {
  sanitizeSessionHistory,
  type SanitizeSessionHistoryOptions,
} from "./pi-embedded-runner/google.js";
import {
  getDmHistoryLimitFromSessionKey,
  limitHistoryTurns,
} from "./pi-embedded-runner/history.js";
import { truncateOversizedToolResultsInMessages } from "./pi-embedded-runner/tool-result-truncation.js";
import { resolveTranscriptPolicy, type TranscriptPolicy } from "./transcript-policy.js";

const TOKENS_PER_CHAR_ESTIMATE = 0.25;

export type ModelVisibleContextUsage = {
  branchHistoryMessages: number;
  branchHistoryTokens: number;
  scopedHistoryMessages: number;
  scopedHistoryTokens: number;
  projectedHistoryMessages: number;
  projectedHistoryTokens: number;
  taskScoped: boolean;
  dmHistoryLimit?: number;
  truncatedToolResults: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  projectedTotalTokens: number;
  contextWindowTokens?: number;
  contextPressure?: number;
};

export type ModelVisibleConversationProjection = {
  branchMessages: AgentMessage[];
  scopedMessages: AgentMessage[];
  sanitizedMessages: AgentMessage[];
  limitedMessages: AgentMessage[];
  projectedMessages: AgentMessage[];
  usage: ModelVisibleContextUsage;
};

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) * TOKENS_PER_CHAR_ESTIMATE);
}

export function attachModelViewToSystemPromptReport(
  report: SessionSystemPromptReport,
  usage: ModelVisibleContextUsage,
): SessionSystemPromptReport {
  return {
    ...report,
    modelView: {
      branchHistoryMessages: usage.branchHistoryMessages,
      branchHistoryTokens: usage.branchHistoryTokens,
      scopedHistoryMessages: usage.scopedHistoryMessages,
      scopedHistoryTokens: usage.scopedHistoryTokens,
      projectedHistoryMessages: usage.projectedHistoryMessages,
      projectedHistoryTokens: usage.projectedHistoryTokens,
      taskScoped: usage.taskScoped,
      dmHistoryLimit: usage.dmHistoryLimit,
      truncatedToolResults: usage.truncatedToolResults,
      systemPromptTokens: usage.systemPromptTokens,
      toolSchemaTokens: usage.toolSchemaTokens,
      projectedTotalTokens: usage.projectedTotalTokens,
      contextWindowTokens: usage.contextWindowTokens,
      contextPressure: usage.contextPressure,
    },
  };
}

export async function projectConversationForModel(params: {
  sessionManager: SessionManager;
  sessionId: string;
  sessionKey?: string;
  taskId?: string;
  config?: OpenClawConfig;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  contextWindowTokens?: number;
  systemPromptReport?: SessionSystemPromptReport | null;
  transcriptPolicy?: TranscriptPolicy;
  sanitizeOptions?: SanitizeSessionHistoryOptions;
}): Promise<ModelVisibleConversationProjection> {
  const branchMessages = params.sessionManager.buildSessionContext().messages;
  const history = resolveTaskScopedHistoryMessages({
    sessionManager: params.sessionManager,
    taskId: params.taskId,
  });
  const transcriptPolicy =
    params.transcriptPolicy ??
    resolveTranscriptPolicy({
      modelApi: params.modelApi,
      provider: params.provider,
      modelId: params.modelId,
    });

  const sanitizedMessages = await sanitizeSessionHistory({
    messages: history.messages,
    modelApi: params.modelApi,
    modelId: params.modelId,
    provider: params.provider,
    sessionManager: params.sessionManager,
    sessionId: params.sessionId,
    policy: transcriptPolicy,
    options: params.sanitizeOptions,
  });
  const validatedGemini = transcriptPolicy.validateGeminiTurns
    ? validateGeminiTurns(sanitizedMessages)
    : sanitizedMessages;
  const validated = transcriptPolicy.validateAnthropicTurns
    ? validateAnthropicTurns(validatedGemini)
    : validatedGemini;
  const dmHistoryLimit = getDmHistoryLimitFromSessionKey(params.sessionKey, params.config);
  const limitedMessages = limitHistoryTurns(validated, dmHistoryLimit);
  const hasContextWindowTokens =
    typeof params.contextWindowTokens === "number" &&
    Number.isFinite(params.contextWindowTokens) &&
    params.contextWindowTokens > 0;
  const contextWindowTokens = hasContextWindowTokens ? params.contextWindowTokens : undefined;
  const truncated = contextWindowTokens
    ? truncateOversizedToolResultsInMessages(limitedMessages, contextWindowTokens)
    : { messages: limitedMessages, truncatedCount: 0 };

  const systemPromptTokens = params.systemPromptReport
    ? estimateTokensFromChars(params.systemPromptReport.systemPrompt.chars)
    : 0;
  const toolSchemaTokens = params.systemPromptReport
    ? estimateTokensFromChars(params.systemPromptReport.tools.schemaChars)
    : 0;
  const projectedHistoryTokens = estimateMessagesTokens(truncated.messages);
  const projectedTotalTokens = systemPromptTokens + toolSchemaTokens + projectedHistoryTokens;

  return {
    branchMessages,
    scopedMessages: history.messages,
    sanitizedMessages,
    limitedMessages,
    projectedMessages: truncated.messages,
    usage: {
      branchHistoryMessages: branchMessages.length,
      branchHistoryTokens: estimateMessagesTokens(branchMessages),
      scopedHistoryMessages: history.messages.length,
      scopedHistoryTokens: estimateMessagesTokens(history.messages),
      projectedHistoryMessages: truncated.messages.length,
      projectedHistoryTokens,
      taskScoped: history.scoped,
      dmHistoryLimit: dmHistoryLimit ?? undefined,
      truncatedToolResults: truncated.truncatedCount,
      systemPromptTokens,
      toolSchemaTokens,
      projectedTotalTokens,
      contextWindowTokens,
      contextPressure:
        contextWindowTokens && contextWindowTokens > 0
          ? Math.min(1, projectedTotalTokens / contextWindowTokens)
          : undefined,
    },
  };
}
