import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { extractAssistantToolCallRecords } from "../utils/tool-call-correlation.js";
import { validateAnthropicTurns, validateGeminiTurns } from "./pi-embedded-helpers.js";
import {
  sanitizeSessionHistory,
  type SanitizeSessionHistoryOptions,
} from "./pi-embedded-runner/google.js";
import { repairToolUseResultPairing } from "./session-transcript-repair.js";
import { resolveTranscriptPolicy, type TranscriptPolicy } from "./transcript-policy.js";

const log = createSubsystemLogger("agents/transcript-normalizer");

export type PrepareMessagesMode = "repair" | "strict";

export type TranscriptRepairCategory =
  | "assistant_empty_removed"
  | "assistant_whitespace_removed"
  | "assistant_fragments_merged"
  | "duplicate_tool_call_id_rewritten"
  | "duplicate_tool_result_removed"
  | "duplicate_tool_result_id_rewritten"
  | "missing_tool_result_repaired"
  | "orphan_tool_result_removed"
  | "trailing_human_turn_dropped"
  | "user_turns_merged";

export type TranscriptRepairStats = Partial<Record<TranscriptRepairCategory, number>>;

export type PrepareMessagesForModelResult = {
  sanitizedMessages: AgentMessage[];
  messages: AgentMessage[];
  policy: TranscriptPolicy;
  repairCategories: TranscriptRepairCategory[];
  repairStats: TranscriptRepairStats;
};

export class PrepareMessagesForModelError extends Error {
  readonly categories: TranscriptRepairCategory[];
  readonly stats: TranscriptRepairStats;

  constructor(stats: TranscriptRepairStats) {
    const categories = Object.keys(stats) as TranscriptRepairCategory[];
    super(
      `Transcript requires repair before model call: ${categories.length > 0 ? categories.join(", ") : "unknown"}`,
    );
    this.name = "PrepareMessagesForModelError";
    this.categories = categories;
    this.stats = stats;
  }
}

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

function resolveRole(message: AgentMessage | undefined): string | undefined {
  return message && typeof message === "object"
    ? ((message as { role?: unknown }).role as string | undefined)
    : undefined;
}

function assistantMessageId(message: AssistantMessage): string | undefined {
  const record = message as Record<string, unknown>;
  return typeof record.id === "string" && record.id.trim()
    ? record.id
    : typeof record.messageId === "string" && record.messageId.trim()
      ? record.messageId
      : undefined;
}

function mergeAssistantMessages(
  previous: AssistantMessage,
  current: AssistantMessage,
): AssistantMessage {
  return {
    ...previous,
    ...current,
    content: [
      ...(Array.isArray(previous.content) ? previous.content : []),
      ...(Array.isArray(current.content) ? current.content : []),
    ],
    timestamp: current.timestamp ?? previous.timestamp,
  } as AssistantMessage;
}

function recordRepair(
  stats: TranscriptRepairStats,
  category: TranscriptRepairCategory,
  count: number,
): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }
  stats[category] = (stats[category] ?? 0) + count;
}

function removeBlankAssistantMessages(messages: AgentMessage[]): {
  messages: AgentMessage[];
  emptyRemoved: number;
  whitespaceRemoved: number;
} {
  const out: AgentMessage[] = [];
  let emptyRemoved = 0;
  let whitespaceRemoved = 0;

  for (const message of messages) {
    if (resolveRole(message) !== "assistant") {
      out.push(message);
      continue;
    }
    const assistant = message as AssistantMessage;
    const content = assistant.content;
    if (content == null) {
      emptyRemoved += 1;
      continue;
    }
    if (!Array.isArray(content)) {
      out.push(message);
      continue;
    }
    if (content.length === 0) {
      emptyRemoved += 1;
      continue;
    }
    const onlyBlankText = content.every((block) => {
      if (!block || typeof block !== "object") {
        return true;
      }
      const record = block as { type?: unknown; text?: unknown };
      if (record.type !== "text") {
        return false;
      }
      return typeof record.text !== "string" || record.text.trim().length === 0;
    });
    if (!onlyBlankText) {
      out.push(message);
      continue;
    }
    const hasWhitespaceText = content.some((block) => {
      if (!block || typeof block !== "object") {
        return false;
      }
      const record = block as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" && record.text.length > 0;
    });
    if (hasWhitespaceText) {
      whitespaceRemoved += 1;
    } else {
      emptyRemoved += 1;
    }
  }

  return {
    messages: emptyRemoved > 0 || whitespaceRemoved > 0 ? out : messages,
    emptyRemoved,
    whitespaceRemoved,
  };
}

function mergeAdjacentAssistantFragments(messages: AgentMessage[]): {
  messages: AgentMessage[];
  mergedCount: number;
} {
  const out: AgentMessage[] = [];
  let mergedCount = 0;

  for (const message of messages) {
    if (resolveRole(message) !== "assistant") {
      out.push(message);
      continue;
    }
    const assistant = message as AssistantMessage;
    const previous = out.at(-1);
    if (resolveRole(previous as AgentMessage | undefined) !== "assistant") {
      out.push(message);
      continue;
    }

    const previousAssistant = previous as AssistantMessage;
    const previousId = assistantMessageId(previousAssistant);
    const nextId = assistantMessageId(assistant);
    if (!previousId || !nextId || previousId !== nextId) {
      out.push(message);
      continue;
    }

    out[out.length - 1] = mergeAssistantMessages(previousAssistant, assistant);
    mergedCount += 1;
  }

  return {
    messages: mergedCount > 0 ? out : messages,
    mergedCount,
  };
}

export function isAssistantTurnMessage(message: AgentMessage | undefined): boolean {
  return resolveRole(message) === "assistant";
}

export function isToolResultMessage(message: AgentMessage | undefined): boolean {
  return resolveRole(message) === "toolResult";
}

export function isToolCallMessage(message: AgentMessage | undefined): boolean {
  return (
    isAssistantTurnMessage(message) &&
    extractAssistantToolCallRecords(message as AssistantMessage).length > 0
  );
}

export function isMetaSystemMessage(message: AgentMessage | undefined): boolean {
  const role = resolveRole(message);
  return Boolean(role && role !== "user" && role !== "assistant" && role !== "toolResult");
}

export function isProgressOrAttachmentMessage(message: AgentMessage | undefined): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (Array.isArray(record.attachments) && record.attachments.length > 0) {
    return true;
  }
  const content = record.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const value = block as Record<string, unknown>;
    return (
      value.type === "image" ||
      typeof value.progress === "number" ||
      typeof value.progressMessage === "string"
    );
  });
}

export function isHumanTurnMessage(message: AgentMessage | undefined): boolean {
  return resolveRole(message) === "user" && !isMetaSystemMessage(message);
}

export async function prepareMessagesForModel(params: {
  messages: AgentMessage[];
  sessionManager: SessionManager;
  sessionId: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  policy?: TranscriptPolicy;
  mode?: PrepareMessagesMode;
  sanitizeOptions?: SanitizeSessionHistoryOptions;
  dropTrailingHumanTurnBeforePrompt?: boolean;
}): Promise<PrepareMessagesForModelResult> {
  const policy =
    params.policy ??
    resolveTranscriptPolicy({
      modelApi: params.modelApi,
      provider: params.provider,
      modelId: params.modelId,
    });
  const stats: TranscriptRepairStats = {};
  const rawBlankPreview = removeBlankAssistantMessages(params.messages);
  const rawPairingPreview = repairToolUseResultPairing(params.messages, {
    allowSyntheticToolResults: policy.allowSyntheticToolResults,
    toolCallIdMode: policy.toolCallIdMode,
  });
  recordRepair(stats, "assistant_empty_removed", rawBlankPreview.emptyRemoved);
  recordRepair(stats, "assistant_whitespace_removed", rawBlankPreview.whitespaceRemoved);
  recordRepair(stats, "orphan_tool_result_removed", rawPairingPreview.droppedOrphanCount);
  recordRepair(stats, "duplicate_tool_result_removed", rawPairingPreview.droppedDuplicateCount);
  recordRepair(stats, "duplicate_tool_call_id_rewritten", rawPairingPreview.rewrittenToolCallIds);
  recordRepair(
    stats,
    "duplicate_tool_result_id_rewritten",
    rawPairingPreview.rewrittenToolResultIds,
  );
  recordRepair(stats, "missing_tool_result_repaired", rawPairingPreview.missingCount);
  const sanitizedMessages = await sanitizeSessionHistory({
    messages: params.messages,
    modelApi: params.modelApi,
    modelId: params.modelId,
    provider: params.provider,
    sessionManager: params.sessionManager,
    sessionId: params.sessionId,
    policy,
    options: params.sanitizeOptions,
  });

  const blankFiltered = removeBlankAssistantMessages(sanitizedMessages);
  recordRepair(
    stats,
    "assistant_empty_removed",
    Math.max(0, blankFiltered.emptyRemoved - rawBlankPreview.emptyRemoved),
  );
  recordRepair(
    stats,
    "assistant_whitespace_removed",
    Math.max(0, blankFiltered.whitespaceRemoved - rawBlankPreview.whitespaceRemoved),
  );

  const mergedFragments = mergeAdjacentAssistantFragments(blankFiltered.messages);
  recordRepair(stats, "assistant_fragments_merged", mergedFragments.mergedCount);

  const pairing = repairToolUseResultPairing(mergedFragments.messages, {
    allowSyntheticToolResults: policy.allowSyntheticToolResults,
    toolCallIdMode: policy.toolCallIdMode,
  });
  recordRepair(
    stats,
    "orphan_tool_result_removed",
    Math.max(0, pairing.droppedOrphanCount - rawPairingPreview.droppedOrphanCount),
  );
  recordRepair(
    stats,
    "duplicate_tool_result_removed",
    Math.max(0, pairing.droppedDuplicateCount - rawPairingPreview.droppedDuplicateCount),
  );
  recordRepair(
    stats,
    "duplicate_tool_call_id_rewritten",
    Math.max(0, pairing.rewrittenToolCallIds - rawPairingPreview.rewrittenToolCallIds),
  );
  recordRepair(
    stats,
    "duplicate_tool_result_id_rewritten",
    Math.max(0, pairing.rewrittenToolResultIds - rawPairingPreview.rewrittenToolResultIds),
  );
  recordRepair(
    stats,
    "missing_tool_result_repaired",
    Math.max(0, pairing.missingCount - rawPairingPreview.missingCount),
  );

  const validatedGemini = policy.validateGeminiTurns
    ? validateGeminiTurns(pairing.messages)
    : pairing.messages;
  const validated = policy.validateAnthropicTurns
    ? validateAnthropicTurns(validatedGemini)
    : validatedGemini;
  recordRepair(stats, "user_turns_merged", Math.max(0, validatedGemini.length - validated.length));

  let finalMessages = validated;
  if (
    params.dropTrailingHumanTurnBeforePrompt &&
    isHumanTurnMessage(finalMessages.at(-1) as AgentMessage | undefined)
  ) {
    finalMessages = finalMessages.slice(0, -1);
    recordRepair(stats, "trailing_human_turn_dropped", 1);
  }

  const repairCategories = Object.keys(stats) as TranscriptRepairCategory[];
  if (repairCategories.length > 0) {
    if ((params.mode ?? "repair") === "strict") {
      throw new PrepareMessagesForModelError(stats);
    }
    log.info("transcript repaired before model call", {
      sessionId: params.sessionId,
      provider: params.provider,
      modelId: params.modelId,
      modelApi: params.modelApi,
      categories: repairCategories,
      stats,
    });
  }

  return {
    sanitizedMessages,
    messages: finalMessages,
    policy,
    repairCategories,
    repairStats: stats,
  };
}
