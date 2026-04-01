import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createHash } from "node:crypto";
import {
  extractAssistantToolCallRecords,
  extractToolResultCorrelationId,
} from "../utils/tool-call-correlation.js";
import { sanitizeToolCallId, type ToolCallIdMode } from "./tool-call-id.js";

const TOOL_CALL_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

type ToolCallBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  arguments?: unknown;
};

function isToolCallBlock(block: unknown): block is ToolCallBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return typeof type === "string" && TOOL_CALL_TYPES.has(type);
}

function hasToolCallInput(block: ToolCallBlock): boolean {
  const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
  const hasArguments =
    "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
  return hasInput || hasArguments;
}

function makeMissingToolResult(params: {
  toolCallId: string;
  toolName?: string;
}): Extract<AgentMessage, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId,
    toolName: params.toolName ?? "unknown",
    content: [
      {
        type: "text",
        text: "[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.",
      },
    ],
    isError: true,
    timestamp: Date.now(),
  } as Extract<AgentMessage, { role: "toolResult" }>;
}

export { makeMissingToolResult };

export type ToolCallInputRepairReport = {
  messages: AgentMessage[];
  droppedToolCalls: number;
  droppedAssistantMessages: number;
};

export function repairToolCallInputs(messages: AgentMessage[]): ToolCallInputRepairReport {
  let droppedToolCalls = 0;
  let droppedAssistantMessages = 0;
  let changed = false;
  const out: AgentMessage[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }

    const nextContent = [];
    let droppedInMessage = 0;

    for (const block of msg.content) {
      if (isToolCallBlock(block) && !hasToolCallInput(block)) {
        droppedToolCalls += 1;
        droppedInMessage += 1;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }

    if (droppedInMessage > 0) {
      if (nextContent.length === 0) {
        droppedAssistantMessages += 1;
        changed = true;
        continue;
      }
      out.push({ ...msg, content: nextContent });
      continue;
    }

    out.push(msg);
  }

  return {
    messages: changed ? out : messages,
    droppedToolCalls,
    droppedAssistantMessages,
  };
}

export function sanitizeToolCallInputs(messages: AgentMessage[]): AgentMessage[] {
  return repairToolCallInputs(messages).messages;
}

export function sanitizeToolUseResultPairing(messages: AgentMessage[]): AgentMessage[] {
  return repairToolUseResultPairing(messages).messages;
}

export type ToolUseRepairReport = {
  messages: AgentMessage[];
  added: Array<Extract<AgentMessage, { role: "toolResult" }>>;
  missingCount: number;
  droppedDuplicateCount: number;
  droppedOrphanCount: number;
  rewrittenToolCallIds: number;
  rewrittenToolResultIds: number;
  moved: boolean;
};

function shortHash(text: string, length = 8): string {
  return createHash("sha1").update(text).digest("hex").slice(0, length);
}

function makeUniqueToolCallId(params: {
  id: string;
  usedIds: Set<string>;
  mode?: ToolCallIdMode;
}): string {
  const seed = params.id || "toolcall";
  const initial = params.mode ? sanitizeToolCallId(seed, params.mode) : seed;
  if (!params.usedIds.has(initial)) {
    return initial;
  }

  for (let attempt = 2; attempt < 1_000; attempt += 1) {
    const candidate =
      params.mode === "strict9"
        ? shortHash(`${seed}:${attempt}`, 9)
        : params.mode === "strict"
          ? sanitizeToolCallId(`${seed}${shortHash(`${seed}:${attempt}`, 6)}`, "strict")
          : `${seed}#${attempt}`;
    if (!params.usedIds.has(candidate)) {
      return candidate;
    }
  }

  return params.mode === "strict9"
    ? shortHash(`${seed}:${params.usedIds.size}:fallback`, 9)
    : params.mode === "strict"
      ? sanitizeToolCallId(`${seed}${shortHash(`${seed}:fallback`, 8)}`, "strict")
      : `${seed}#${params.usedIds.size + 1}`;
}

function rewriteAssistantToolCallIds(params: {
  message: Extract<AgentMessage, { role: "assistant" }>;
  idsByIndex: Map<number, string>;
}): Extract<AgentMessage, { role: "assistant" }> {
  if (params.idsByIndex.size === 0 || !Array.isArray(params.message.content)) {
    return params.message;
  }

  let changed = false;
  const nextContent = params.message.content.map((block, index) => {
    const nextId = params.idsByIndex.get(index);
    if (!nextId || !block || typeof block !== "object") {
      return block;
    }
    const currentId = (block as { id?: unknown }).id;
    if (currentId === nextId) {
      return block;
    }
    changed = true;
    return { ...(block as Record<string, unknown>), id: nextId };
  });

  return changed
    ? ({ ...params.message, content: nextContent } as Extract<AgentMessage, { role: "assistant" }>)
    : params.message;
}

function rewriteToolResultCorrelationId(params: {
  message: Extract<AgentMessage, { role: "toolResult" }>;
  toolCallId: string;
}): Extract<AgentMessage, { role: "toolResult" }> {
  const next = { ...params.message } as Extract<AgentMessage, { role: "toolResult" }> & {
    toolUseId?: string;
  };
  if (typeof next.toolCallId === "string" && next.toolCallId) {
    next.toolCallId = params.toolCallId;
  }
  if (typeof next.toolUseId === "string" && next.toolUseId) {
    next.toolUseId = params.toolCallId;
  }
  if (!("toolCallId" in next) && !("toolUseId" in next)) {
    next.toolCallId = params.toolCallId;
  }
  return next;
}

export function repairToolUseResultPairing(
  messages: AgentMessage[],
  options?: {
    allowSyntheticToolResults?: boolean;
    toolCallIdMode?: ToolCallIdMode;
  },
): ToolUseRepairReport {
  // Anthropic (and Cloud Code Assist) reject transcripts where assistant tool calls are not
  // immediately followed by matching tool results. Session files can end up with results
  // displaced (e.g. after user turns) or duplicated. Repair by:
  // - moving matching toolResult messages directly after their assistant toolCall turn
  // - inserting synthetic error toolResults for missing ids
  // - dropping duplicate toolResults for the same id (anywhere in the transcript)
  const out: AgentMessage[] = [];
  const added: Array<Extract<AgentMessage, { role: "toolResult" }>> = [];
  const allowSyntheticToolResults = options?.allowSyntheticToolResults ?? true;
  const seenToolCallIds = new Set<string>();
  const seenOriginalToolCallIds = new Set<string>();
  const seenToolResultIds = new Set<string>();
  let missingCount = 0;
  let droppedDuplicateCount = 0;
  let droppedOrphanCount = 0;
  let rewrittenToolCallIds = 0;
  let rewrittenToolResultIds = 0;
  let moved = false;
  let changed = false;

  const pushToolResult = (msg: Extract<AgentMessage, { role: "toolResult" }>) => {
    const id = extractToolResultCorrelationId(msg);
    if (id && seenToolResultIds.has(id)) {
      droppedDuplicateCount += 1;
      changed = true;
      return;
    }
    if (id) {
      seenToolResultIds.add(id);
    }
    out.push(msg);
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    const role = (msg as { role?: unknown }).role;
    if (role !== "assistant") {
      // Tool results must only appear directly after the matching assistant tool call turn.
      // Any "free-floating" toolResult entries in session history can make strict providers
      // (Anthropic-compatible APIs, MiniMax, Cloud Code Assist) reject the entire request.
      if (role !== "toolResult") {
        out.push(msg);
      } else {
        const id = extractToolResultCorrelationId(msg);
        if (id && (seenOriginalToolCallIds.has(id) || seenToolResultIds.has(id))) {
          droppedDuplicateCount += 1;
        } else {
          droppedOrphanCount += 1;
        }
        changed = true;
      }
      continue;
    }

    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;

    // Skip tool call extraction for aborted or errored assistant messages.
    // When stopReason is "error" or "aborted", the tool_use blocks may be incomplete
    // (e.g., partialJson: true) and should not have synthetic tool_results created.
    // Creating synthetic results for incomplete tool calls causes API 400 errors:
    // "unexpected tool_use_id found in tool_result blocks"
    // See: https://github.com/openclaw/openclaw/issues/4597
    const stopReason = (assistant as { stopReason?: string }).stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      out.push(msg);
      continue;
    }

    const toolCalls = extractAssistantToolCallRecords(assistant).map((record) => ({
      sourceId: record.toolCallId,
      name: record.toolName,
      indexWithinMessage: record.indexWithinMessage,
    }));
    if (toolCalls.length === 0) {
      out.push(msg);
      continue;
    }

    const rewrittenIdsByIndex = new Map<number, string>();
    const normalizedToolCalls = toolCalls.map((call) => {
      seenOriginalToolCallIds.add(call.sourceId);
      let toolCallId = call.sourceId;
      if (seenToolCallIds.has(toolCallId)) {
        toolCallId = makeUniqueToolCallId({
          id: call.sourceId,
          usedIds: seenToolCallIds,
          mode: options?.toolCallIdMode,
        });
      }
      if (toolCallId !== call.sourceId) {
        rewrittenIdsByIndex.set(call.indexWithinMessage, toolCallId);
        rewrittenToolCallIds += 1;
        changed = true;
      }
      seenToolCallIds.add(toolCallId);
      return {
        sourceId: call.sourceId,
        toolCallId,
        name: call.name,
      };
    });

    const toolCallsBySourceId = new Map<
      string,
      Array<{
        toolCallId: string;
        name?: string;
        result?: Extract<AgentMessage, { role: "toolResult" }>;
      }>
    >();
    for (const call of normalizedToolCalls) {
      const existing = toolCallsBySourceId.get(call.sourceId) ?? [];
      existing.push({ toolCallId: call.toolCallId, name: call.name });
      toolCallsBySourceId.set(call.sourceId, existing);
    }

    const remainder: AgentMessage[] = [];

    let j = i + 1;
    for (; j < messages.length; j += 1) {
      const next = messages[j];
      if (!next || typeof next !== "object") {
        remainder.push(next);
        continue;
      }

      const nextRole = (next as { role?: unknown }).role;
      if (nextRole === "assistant") {
        break;
      }

      if (nextRole === "toolResult") {
        const toolResult = next as Extract<AgentMessage, { role: "toolResult" }>;
        const id = extractToolResultCorrelationId(toolResult);
        if (id && toolCallsBySourceId.has(id)) {
          const pending = toolCallsBySourceId.get(id) ?? [];
          const unresolved = pending.find((entry) => !entry.result);
          if (!unresolved) {
            droppedDuplicateCount += 1;
            changed = true;
            continue;
          }
          const nextToolResult =
            unresolved.toolCallId === id
              ? toolResult
              : rewriteToolResultCorrelationId({
                  message: toolResult,
                  toolCallId: unresolved.toolCallId,
                });
          if (nextToolResult !== toolResult) {
            rewrittenToolResultIds += 1;
            changed = true;
          }
          if (seenToolResultIds.has(unresolved.toolCallId)) {
            droppedDuplicateCount += 1;
            changed = true;
            continue;
          }
          unresolved.result = nextToolResult;
          continue;
        }
      }

      // Drop tool results that don't match the current assistant tool calls.
      if (nextRole !== "toolResult") {
        remainder.push(next);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
    }

    const nextAssistant = rewriteAssistantToolCallIds({
      message: assistant,
      idsByIndex: rewrittenIdsByIndex,
    });
    out.push(nextAssistant);

    const matchedResultsCount = [...toolCallsBySourceId.values()]
      .flat()
      .filter((entry) => entry.result).length;
    if (matchedResultsCount > 0 && remainder.length > 0) {
      moved = true;
      changed = true;
    }

    for (const call of normalizedToolCalls) {
      const matching = (toolCallsBySourceId.get(call.sourceId) ?? []).find(
        (entry) => entry.toolCallId === call.toolCallId,
      );
      if (matching?.result) {
        pushToolResult(matching.result);
      } else if (allowSyntheticToolResults) {
        const missing = makeMissingToolResult({
          toolCallId: call.toolCallId,
          toolName: call.name,
        });
        added.push(missing);
        missingCount += 1;
        changed = true;
        pushToolResult(missing);
      } else {
        missingCount += 1;
      }
    }

    for (const rem of remainder) {
      if (!rem || typeof rem !== "object") {
        out.push(rem);
        continue;
      }
      out.push(rem);
    }
    i = j - 1;
  }

  const changedOrMoved = changed || moved;
  return {
    messages: changedOrMoved ? out : messages,
    added,
    missingCount,
    droppedDuplicateCount,
    droppedOrphanCount,
    rewrittenToolCallIds,
    rewrittenToolResultIds,
    moved: changedOrMoved,
  };
}
