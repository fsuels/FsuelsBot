import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionEntry, SessionManager } from "@mariozechner/pi-coding-agent";
import crypto from "node:crypto";
import type { EmbeddedRuntimeRequestSnapshot } from "./runtime-state.js";
import { resolveTaskScopedHistoryMessages } from "../../sessions/task-context.js";

export const SAVED_REQUEST_CONTEXT_CUSTOM_TYPE = "openclaw-saved-request-context";

export type SavedRequestContextEntry = Readonly<{
  recordedAt: number;
  promptId?: string;
  requestId?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  wasPostCompaction?: boolean;
  systemJson?: string;
  messagesJson: string;
  prefixHash: string;
}>;

export type CacheSafeForkContext = Readonly<{
  messages: AgentMessage[];
  prefixHash: string;
  reusedSavedPrefix: boolean;
  partialAssistantStripped: boolean;
}>;

type CustomEntryLike = Extract<SessionEntry, { type: "custom" }> & {
  customType?: string;
  data?: unknown;
};

function asSavedRequestContextEntry(value: unknown): SavedRequestContextEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.messagesJson !== "string" || candidate.messagesJson.length === 0) {
    return null;
  }
  if (typeof candidate.prefixHash !== "string" || candidate.prefixHash.length === 0) {
    return null;
  }
  return {
    recordedAt:
      typeof candidate.recordedAt === "number" && Number.isFinite(candidate.recordedAt)
        ? Math.floor(candidate.recordedAt)
        : Date.now(),
    promptId: typeof candidate.promptId === "string" ? candidate.promptId : undefined,
    requestId: typeof candidate.requestId === "string" ? candidate.requestId : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    modelId: typeof candidate.modelId === "string" ? candidate.modelId : undefined,
    modelApi:
      candidate.modelApi === null || typeof candidate.modelApi === "string"
        ? candidate.modelApi
        : undefined,
    wasPostCompaction: candidate.wasPostCompaction === true,
    systemJson: typeof candidate.systemJson === "string" ? candidate.systemJson : undefined,
    messagesJson: candidate.messagesJson,
    prefixHash: candidate.prefixHash,
  };
}

function stringifyForStorage(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function parseMessagesJson(messagesJson: string): AgentMessage[] | null {
  try {
    const parsed = JSON.parse(messagesJson);
    return Array.isArray(parsed) ? (parsed as AgentMessage[]) : null;
  } catch {
    return null;
  }
}

function hashSerializedPrefix(params: { systemJson?: string; messagesJson: string }): string {
  const hash = crypto.createHash("sha256");
  hash.update(params.systemJson ?? "");
  hash.update("\n--openclaw-prefix-boundary--\n");
  hash.update(params.messagesJson);
  return hash.digest("hex");
}

function isIncompleteAssistantMessage(message: AgentMessage | undefined): boolean {
  if (!message || message.role !== "assistant") {
    return false;
  }
  const stopReason =
    "stopReason" in message && typeof message.stopReason === "string" ? message.stopReason : "";
  return stopReason === "error" || stopReason === "aborted";
}

export function stripTrailingIncompleteAssistant(messages: readonly AgentMessage[]): {
  messages: AgentMessage[];
  stripped: boolean;
} {
  if (messages.length === 0) {
    return { messages: [], stripped: false };
  }
  const copy = [...messages];
  if (isIncompleteAssistantMessage(copy[copy.length - 1])) {
    copy.pop();
    return { messages: copy, stripped: true };
  }
  return { messages: copy, stripped: false };
}

export function serializeSavedRequestContext(
  snapshot: EmbeddedRuntimeRequestSnapshot | null | undefined,
): SavedRequestContextEntry | null {
  if (!snapshot) {
    return null;
  }
  const messagesJson = stringifyForStorage(snapshot.messages);
  if (!messagesJson) {
    return null;
  }
  const systemJson = stringifyForStorage(snapshot.system);
  return {
    recordedAt: snapshot.recordedAt,
    promptId: snapshot.promptId,
    requestId: snapshot.requestId,
    provider: snapshot.provider,
    modelId: snapshot.modelId,
    modelApi: snapshot.modelApi,
    wasPostCompaction: snapshot.wasPostCompaction,
    systemJson,
    messagesJson,
    prefixHash: hashSerializedPrefix({
      systemJson,
      messagesJson,
    }),
  };
}

export function readLatestSavedRequestContext(
  sessionManager: Pick<SessionManager, "getEntries">,
): SavedRequestContextEntry | null {
  const entries = sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as CustomEntryLike;
    if (entry?.type !== "custom" || entry.customType !== SAVED_REQUEST_CONTEXT_CUSTOM_TYPE) {
      continue;
    }
    const parsed = asSavedRequestContextEntry(entry.data);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export function persistSavedRequestContext(
  sessionManager: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
  snapshot: SavedRequestContextEntry,
): boolean {
  const latest = readLatestSavedRequestContext(sessionManager);
  if (
    latest &&
    latest.requestId === snapshot.requestId &&
    latest.promptId === snapshot.promptId &&
    latest.prefixHash === snapshot.prefixHash
  ) {
    return false;
  }
  sessionManager.appendCustomEntry(SAVED_REQUEST_CONTEXT_CUSTOM_TYPE, snapshot);
  return true;
}

export function buildCacheSafeForkContext(params: {
  sessionManager: SessionManager;
  taskId?: string;
  system?: unknown;
  liveOverride?: SavedRequestContextEntry | null;
}): CacheSafeForkContext {
  const currentSystemJson = stringifyForStorage(params.system);
  const saved = params.liveOverride ?? readLatestSavedRequestContext(params.sessionManager);
  const savedMessages = saved ? parseMessagesJson(saved.messagesJson) : null;
  if (saved && savedMessages) {
    return {
      messages: savedMessages,
      prefixHash: hashSerializedPrefix({
        systemJson: currentSystemJson,
        messagesJson: saved.messagesJson,
      }),
      reusedSavedPrefix: true,
      partialAssistantStripped: false,
    };
  }

  const scoped = resolveTaskScopedHistoryMessages({
    sessionManager: params.sessionManager,
    taskId: params.taskId,
  });
  const stripped = stripTrailingIncompleteAssistant(scoped.messages);
  const messagesJson = stringifyForStorage(stripped.messages) ?? "[]";
  return {
    messages: stripped.messages,
    prefixHash: hashSerializedPrefix({
      systemJson: currentSystemJson,
      messagesJson,
    }),
    reusedSavedPrefix: false,
    partialAssistantStripped: stripped.stripped,
  };
}
