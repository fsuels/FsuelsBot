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

export type ModelVisibleHistoryStage = {
  key: "branch" | "scoped" | "sanitized" | "validated" | "limited" | "projected";
  label: string;
  messages: number;
  tokens: number;
  changed: boolean;
  savingsTokens: number;
  reason?: string;
};

export type ModelVisibleContextUsage = {
  branchHistoryMessages: number;
  branchHistoryTokens: number;
  scopedHistoryMessages: number;
  scopedHistoryTokens: number;
  sanitizedHistoryMessages: number;
  sanitizedHistoryTokens: number;
  validatedHistoryMessages: number;
  validatedHistoryTokens: number;
  limitedHistoryMessages: number;
  limitedHistoryTokens: number;
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
  historyStages: ModelVisibleHistoryStage[];
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
      sanitizedHistoryMessages: usage.sanitizedHistoryMessages,
      sanitizedHistoryTokens: usage.sanitizedHistoryTokens,
      validatedHistoryMessages: usage.validatedHistoryMessages,
      validatedHistoryTokens: usage.validatedHistoryTokens,
      limitedHistoryMessages: usage.limitedHistoryMessages,
      limitedHistoryTokens: usage.limitedHistoryTokens,
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
      historyStages: usage.historyStages,
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
  historyMessagesOverride?: AgentMessage[];
  historyOverrideScoped?: boolean;
}): Promise<ModelVisibleConversationProjection> {
  const branchMessages = params.sessionManager.buildSessionContext().messages;
  const branchHistoryTokens = estimateMessagesTokens(branchMessages);
  const history = params.historyMessagesOverride
    ? {
        messages: params.historyMessagesOverride,
        scoped: params.historyOverrideScoped ?? true,
      }
    : resolveTaskScopedHistoryMessages({
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
  const scopedHistoryTokens = estimateMessagesTokens(history.messages);

  const sanitizedMessages = params.historyMessagesOverride
    ? history.messages
    : await sanitizeSessionHistory({
        messages: history.messages,
        modelApi: params.modelApi,
        modelId: params.modelId,
        provider: params.provider,
        sessionManager: params.sessionManager,
        sessionId: params.sessionId,
        policy: transcriptPolicy,
        options: params.sanitizeOptions,
      });
  const sanitizedHistoryTokens = estimateMessagesTokens(sanitizedMessages);
  const validatedGemini =
    params.historyMessagesOverride || !transcriptPolicy.validateGeminiTurns
      ? sanitizedMessages
      : validateGeminiTurns(sanitizedMessages);
  const validated =
    params.historyMessagesOverride || !transcriptPolicy.validateAnthropicTurns
      ? validatedGemini
      : validateAnthropicTurns(validatedGemini);
  const validatedHistoryTokens = estimateMessagesTokens(validated);
  const dmHistoryLimit = params.historyMessagesOverride
    ? undefined
    : getDmHistoryLimitFromSessionKey(params.sessionKey, params.config);
  const limitedMessages = params.historyMessagesOverride
    ? validated
    : limitHistoryTurns(validated, dmHistoryLimit);
  const limitedHistoryTokens = estimateMessagesTokens(limitedMessages);
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
  const historyStages: ModelVisibleHistoryStage[] = [
    {
      key: "branch",
      label: "Branch history",
      messages: branchMessages.length,
      tokens: branchHistoryTokens,
      changed: false,
      savingsTokens: 0,
      reason: "Full branch transcript before task scoping or request shaping.",
    },
    {
      key: "scoped",
      label: history.scoped ? "Task-scoped history" : "Scoped history",
      messages: history.messages.length,
      tokens: scopedHistoryTokens,
      changed:
        history.scoped &&
        (history.messages.length !== branchMessages.length ||
          scopedHistoryTokens !== branchHistoryTokens),
      savingsTokens: Math.max(0, branchHistoryTokens - scopedHistoryTokens),
      reason: history.scoped
        ? "Older turns outside the active task were hidden before the model call."
        : "No task-scoped collapse was active for this session.",
    },
    {
      key: "sanitized",
      label: "Sanitized history",
      messages: sanitizedMessages.length,
      tokens: sanitizedHistoryTokens,
      changed:
        sanitizedMessages.length !== history.messages.length ||
        sanitizedHistoryTokens !== scopedHistoryTokens,
      savingsTokens: Math.max(0, scopedHistoryTokens - sanitizedHistoryTokens),
      reason: "Provider-specific sanitization rewrote or removed unsupported transcript content.",
    },
    {
      key: "validated",
      label: "Validated turns",
      messages: validated.length,
      tokens: validatedHistoryTokens,
      changed:
        validated.length !== sanitizedMessages.length ||
        validatedHistoryTokens !== sanitizedHistoryTokens,
      savingsTokens: Math.max(0, sanitizedHistoryTokens - validatedHistoryTokens),
      reason:
        transcriptPolicy.validateGeminiTurns || transcriptPolicy.validateAnthropicTurns
          ? "Turn validation merged or reordered messages to satisfy model API rules."
          : "No additional turn validation was required for this provider.",
    },
    {
      key: "limited",
      label: typeof dmHistoryLimit === "number" ? "DM-limited history" : "Limited history",
      messages: limitedMessages.length,
      tokens: limitedHistoryTokens,
      changed:
        limitedMessages.length !== validated.length ||
        limitedHistoryTokens !== validatedHistoryTokens,
      savingsTokens: Math.max(0, validatedHistoryTokens - limitedHistoryTokens),
      reason:
        typeof dmHistoryLimit === "number"
          ? `Newest ${dmHistoryLimit} DM turns were kept for model visibility.`
          : "No DM history cap was applied.",
    },
    {
      key: "projected",
      label: "Projected model payload",
      messages: truncated.messages.length,
      tokens: projectedHistoryTokens,
      changed:
        truncated.messages.length !== limitedMessages.length ||
        projectedHistoryTokens !== limitedHistoryTokens,
      savingsTokens: Math.max(0, limitedHistoryTokens - projectedHistoryTokens),
      reason:
        truncated.truncatedCount > 0
          ? `Oversized tool results were truncated (${truncated.truncatedCount}) before the request.`
          : "No additional truncation was needed before the request.",
    },
  ];

  return {
    branchMessages,
    scopedMessages: history.messages,
    sanitizedMessages,
    limitedMessages,
    projectedMessages: truncated.messages,
    usage: {
      branchHistoryMessages: branchMessages.length,
      branchHistoryTokens,
      scopedHistoryMessages: history.messages.length,
      scopedHistoryTokens,
      sanitizedHistoryMessages: sanitizedMessages.length,
      sanitizedHistoryTokens,
      validatedHistoryMessages: validated.length,
      validatedHistoryTokens,
      limitedHistoryMessages: limitedMessages.length,
      limitedHistoryTokens,
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
      historyStages,
    },
  };
}
