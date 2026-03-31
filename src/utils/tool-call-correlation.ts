import type { AgentMessage } from "@mariozechner/pi-agent-core";

const TOOL_CALL_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

export type AssistantToolCallRecord = {
  toolCallId: string;
  toolName?: string;
  indexWithinMessage: number;
  parentMessageId?: string;
  status?: string;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resolveAssistantMessageId(
  message: Extract<AgentMessage, { role: "assistant" }>,
): string | undefined {
  const record = message as Record<string, unknown>;
  return asNonEmptyString(record.id) ?? asNonEmptyString(record.messageId);
}

export function extractAssistantToolCallRecords(
  message: Extract<AgentMessage, { role: "assistant" }>,
): AssistantToolCallRecord[] {
  const content = message.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const parentMessageId = resolveAssistantMessageId(message);
  const status = asNonEmptyString((message as { stopReason?: unknown }).stopReason);
  const records: AssistantToolCallRecord[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    if (!block || typeof block !== "object") {
      continue;
    }
    const rec = block as { type?: unknown; id?: unknown; name?: unknown };
    if (
      typeof rec.type !== "string" ||
      !TOOL_CALL_TYPES.has(rec.type) ||
      typeof rec.id !== "string" ||
      !rec.id
    ) {
      continue;
    }
    records.push({
      toolCallId: rec.id,
      toolName: asNonEmptyString(rec.name),
      indexWithinMessage: index,
      parentMessageId,
      status,
    });
  }

  return records;
}

export type ToolResultCorrelation = {
  toolCallId: string | null;
  source: "toolCallId" | "toolUseId" | null;
};

export function resolveToolResultCorrelation(message: unknown): ToolResultCorrelation {
  if (!message || typeof message !== "object") {
    return { toolCallId: null, source: null };
  }
  const record = message as { toolCallId?: unknown; toolUseId?: unknown };
  if (typeof record.toolCallId === "string" && record.toolCallId) {
    return { toolCallId: record.toolCallId, source: "toolCallId" };
  }
  if (typeof record.toolUseId === "string" && record.toolUseId) {
    return { toolCallId: record.toolUseId, source: "toolUseId" };
  }
  return { toolCallId: null, source: null };
}

export function extractToolResultCorrelationId(message: unknown): string | null {
  return resolveToolResultCorrelation(message).toolCallId;
}
