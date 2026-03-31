import { renderToolOutputValue } from "./chat/tool-helpers.ts";
import { truncateText } from "./format.ts";

const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
};

export type ToolStreamEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
  message: Record<string, unknown>;
};

export type AgentReaction = {
  text: string;
  createdAt: number;
  ttlMs: number;
  channel: "observer" | "system" | "tool";
  style: "idle" | "success" | "warning" | "error";
};

type ToolStreamHost = {
  sessionKey: string;
  chatRunId: string | null;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  toolStreamSyncTimer: number | null;
};

function formatToolOutput(value: unknown, toolName?: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const rendered = renderToolOutputValue(value, { toolName, markdown: false });
  const text =
    rendered ??
    (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        // oxlint-disable typescript/no-base-to-string
        return String(value);
      }
    })();
  const truncated = truncateText(text, TOOL_OUTPUT_CHAR_LIMIT);
  if (!truncated.truncated) {
    return truncated.text;
  }
  return `${truncated.text}\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`;
}

function buildToolStreamMessage(entry: ToolStreamEntry): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "toolcall",
    name: entry.name,
    arguments: entry.args ?? {},
  });
  if (entry.output) {
    content.push({
      type: "toolresult",
      name: entry.name,
      text: entry.output,
    });
  }
  return {
    role: "assistant",
    toolCallId: entry.toolCallId,
    runId: entry.runId,
    content,
    timestamp: entry.startedAt,
  };
}

function trimToolStream(host: ToolStreamHost) {
  if (host.toolStreamOrder.length <= TOOL_STREAM_LIMIT) {
    return;
  }
  const overflow = host.toolStreamOrder.length - TOOL_STREAM_LIMIT;
  const removed = host.toolStreamOrder.splice(0, overflow);
  for (const id of removed) {
    host.toolStreamById.delete(id);
  }
}

function syncToolStreamMessages(host: ToolStreamHost) {
  host.chatToolMessages = host.toolStreamOrder
    .map((id) => host.toolStreamById.get(id)?.message)
    .filter((msg): msg is Record<string, unknown> => Boolean(msg));
}

export function flushToolStreamSync(host: ToolStreamHost) {
  if (host.toolStreamSyncTimer != null) {
    clearTimeout(host.toolStreamSyncTimer);
    host.toolStreamSyncTimer = null;
  }
  syncToolStreamMessages(host);
}

export function scheduleToolStreamSync(host: ToolStreamHost, force = false) {
  if (force) {
    flushToolStreamSync(host);
    return;
  }
  if (host.toolStreamSyncTimer != null) {
    return;
  }
  host.toolStreamSyncTimer = window.setTimeout(
    () => flushToolStreamSync(host),
    TOOL_STREAM_THROTTLE_MS,
  );
}

export function resetToolStream(host: ToolStreamHost) {
  host.toolStreamById.clear();
  host.toolStreamOrder = [];
  host.chatToolMessages = [];
  setAgentReaction(host as CompactionHost, null);
  flushToolStreamSync(host);
}

type CompactionHost = ToolStreamHost & {
  chatReaction?: AgentReaction | null;
  chatReactionClearTimer?: number | null;
};

const REACTION_TTL_MS = 5000;
const ACTIVE_REACTION_TTL_MS = 60_000;

function clearReactionTimer(host: CompactionHost) {
  if (host.chatReactionClearTimer != null) {
    window.clearTimeout(host.chatReactionClearTimer);
    host.chatReactionClearTimer = null;
  }
}

function scheduleReactionClear(host: CompactionHost, reaction: AgentReaction) {
  clearReactionTimer(host);
  if (!Number.isFinite(reaction.ttlMs) || reaction.ttlMs <= 0) {
    return;
  }
  host.chatReactionClearTimer = window.setTimeout(() => {
    if (host.chatReaction?.createdAt === reaction.createdAt) {
      host.chatReaction = null;
    }
    host.chatReactionClearTimer = null;
  }, reaction.ttlMs);
}

function setAgentReaction(host: CompactionHost, reaction: AgentReaction | null) {
  clearReactionTimer(host);
  host.chatReaction = reaction;
  if (reaction) {
    scheduleReactionClear(host, reaction);
  }
}

function startToolLabel(name: string): string {
  return name.replace(/[_-]+/g, " ").trim() || "tool";
}

function isRelevantAgentPayload(host: ToolStreamHost, payload: AgentEventPayload): boolean {
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (sessionKey && sessionKey !== host.sessionKey) {
    return false;
  }
  if (!sessionKey && host.chatRunId && payload.runId !== host.chatRunId) {
    return false;
  }
  if (host.chatRunId && payload.runId !== host.chatRunId) {
    return false;
  }
  if (!host.chatRunId && !sessionKey) {
    return false;
  }
  return true;
}

export function handleCompactionEvent(host: CompactionHost, payload: AgentEventPayload) {
  if (!isRelevantAgentPayload(host, payload)) {
    return;
  }
  const data = payload.data ?? {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  const ts = typeof payload.ts === "number" ? payload.ts : Date.now();

  if (phase === "start") {
    setAgentReaction(host, {
      text: "Compacting context...",
      createdAt: ts,
      ttlMs: ACTIVE_REACTION_TTL_MS,
      channel: "system",
      style: "idle",
    });
  } else if (phase === "end") {
    const willRetry = data.willRetry === true;
    setAgentReaction(host, {
      text: willRetry ? "Retrying compaction..." : "Context compacted",
      createdAt: ts,
      ttlMs: REACTION_TTL_MS,
      channel: "system",
      style: willRetry ? "warning" : "success",
    });
  }
}

function handleToolReactionEvent(host: CompactionHost, payload: AgentEventPayload) {
  if (!isRelevantAgentPayload(host, payload)) {
    return;
  }
  const data = payload.data ?? {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  if (phase !== "result" || data.isError !== true) {
    return;
  }
  const name = typeof data.name === "string" ? data.name : "tool";
  const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
  setAgentReaction(host, {
    text: `${startToolLabel(name)} failed`,
    createdAt: ts,
    ttlMs: REACTION_TTL_MS,
    channel: "tool",
    style: "error",
  });
}

export function handleAgentEvent(host: ToolStreamHost, payload?: AgentEventPayload) {
  if (!payload) {
    return;
  }

  // Handle compaction events
  if (payload.stream === "compaction") {
    handleCompactionEvent(host as CompactionHost, payload);
    return;
  }

  if (payload.stream === "tool") {
    handleToolReactionEvent(host as CompactionHost, payload);
  }

  if (payload.stream !== "tool") {
    return;
  }
  if (!isRelevantAgentPayload(host, payload)) {
    return;
  }
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;

  const data = payload.data ?? {};
  const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  if (!toolCallId) {
    return;
  }
  const name = typeof data.name === "string" ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  const args = phase === "start" ? data.args : undefined;
  const output =
    phase === "update"
      ? formatToolOutput(data.partialResult, name)
      : phase === "result"
        ? formatToolOutput(data.result, name)
        : undefined;

  const now = Date.now();
  let entry = host.toolStreamById.get(toolCallId);
  if (!entry) {
    entry = {
      toolCallId,
      runId: payload.runId,
      sessionKey,
      name,
      args,
      output: output || undefined,
      startedAt: typeof payload.ts === "number" ? payload.ts : now,
      updatedAt: now,
      message: {},
    };
    host.toolStreamById.set(toolCallId, entry);
    host.toolStreamOrder.push(toolCallId);
  } else {
    entry.name = name;
    if (args !== undefined) {
      entry.args = args;
    }
    if (output !== undefined) {
      entry.output = output || undefined;
    }
    entry.updatedAt = now;
  }

  entry.message = buildToolStreamMessage(entry);
  trimToolStream(host);
  scheduleToolStreamSync(host, phase === "result");
}
