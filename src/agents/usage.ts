import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";

export type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  // Common alternates across providers/SDKs.
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  // Some agents/logs emit alternate naming.
  totalTokens?: number;
  total_tokens?: number;
  cache_read?: number;
  cache_write?: number;
};

export type NormalizedUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAssistantMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "assistant" }> {
  return isRecord(message) && message.role === "assistant";
}

export function hasNonzeroUsage(usage?: NormalizedUsage | null): usage is NormalizedUsage {
  if (!usage) {
    return false;
  }
  return [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.total].some(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
}

export function getTokenUsage(
  message: AgentMessage | UsageLike | null | undefined,
): NormalizedUsage | undefined {
  if (!message) {
    return undefined;
  }
  if (isRecord(message) && "usage" in message) {
    return normalizeUsage((message as { usage?: UsageLike | null }).usage);
  }
  return normalizeUsage(message as UsageLike);
}

export function normalizeUsage(raw?: UsageLike | null): NormalizedUsage | undefined {
  if (!raw) {
    return undefined;
  }

  const input = asFiniteNumber(
    raw.input ?? raw.inputTokens ?? raw.input_tokens ?? raw.promptTokens ?? raw.prompt_tokens,
  );
  const output = asFiniteNumber(
    raw.output ??
      raw.outputTokens ??
      raw.output_tokens ??
      raw.completionTokens ??
      raw.completion_tokens,
  );
  const cacheRead = asFiniteNumber(raw.cacheRead ?? raw.cache_read ?? raw.cache_read_input_tokens);
  const cacheWrite = asFiniteNumber(
    raw.cacheWrite ?? raw.cache_write ?? raw.cache_creation_input_tokens,
  );
  const total = asFiniteNumber(raw.total ?? raw.totalTokens ?? raw.total_tokens);

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    total === undefined
  ) {
    return undefined;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
  };
}

export function derivePromptTokens(usage?: {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number | undefined {
  if (!usage) {
    return undefined;
  }
  const input = usage.input ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const sum = input + cacheRead + cacheWrite;
  return sum > 0 ? sum : undefined;
}

export function getTokenCountFromUsage(usage?: NormalizedUsage | null): number | undefined {
  if (!usage) {
    return undefined;
  }
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const total = usage.total ?? input + output + cacheRead + cacheWrite;
  return total > 0 ? total : undefined;
}

export function finalContextTokensFromLastResponse(messages: AgentMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantMessage(message)) {
      continue;
    }
    const total = getTokenCountFromUsage(getTokenUsage(message));
    if (total !== undefined) {
      return total;
    }
  }
  return undefined;
}

export function messageOutputTokensFromLastResponse(messages: AgentMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantMessage(message)) {
      continue;
    }
    const usage = getTokenUsage(message);
    if (usage?.output && usage.output > 0) {
      return usage.output;
    }
  }
  return undefined;
}

export function tokenCountWithEstimation(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantMessage(message)) {
      continue;
    }
    const usageTokens = getTokenCountFromUsage(getTokenUsage(message));
    if (usageTokens === undefined) {
      continue;
    }
    const trailingEstimate = messages
      .slice(index + 1)
      .reduce((sum, trailingMessage) => sum + estimateTokens(trailingMessage), 0);
    return usageTokens + trailingEstimate;
  }
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

export function deriveSessionTotalTokens(params: {
  usage?: {
    input?: number;
    total?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextTokens?: number;
}): number | undefined {
  const usage = params.usage;
  if (!usage) {
    return undefined;
  }
  const input = usage.input ?? 0;
  const promptTokens = derivePromptTokens({
    input: usage.input,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  });
  let total = promptTokens ?? usage.total ?? input;
  if (!(total > 0)) {
    return undefined;
  }

  const contextTokens = params.contextTokens;
  if (typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0) {
    total = Math.min(total, contextTokens);
  }
  return total;
}
