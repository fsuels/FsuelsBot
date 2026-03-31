import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import type { ChatLifecycleGuard, ChatLifecycleSnapshot } from "./chat-lifecycle-guard.ts";
import { extractText } from "../chat/message-extract.ts";
import { generateUUID } from "../uuid.ts";

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
  chatLifecycleGuard?: ChatLifecycleGuard;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

function getLifecycleSnapshot(
  state: Pick<ChatState, "chatSending" | "chatRunId" | "chatLifecycleGuard">,
): ChatLifecycleSnapshot {
  if (state.chatLifecycleGuard) {
    return state.chatLifecycleGuard.getSnapshot();
  }
  const active = typeof state.chatRunId === "string" && state.chatRunId.trim().length > 0;
  const reserved = Boolean(state.chatSending) && !active;
  return {
    phase: active ? "active" : reserved ? "reserved" : "idle",
    runId: active ? state.chatRunId : null,
    generation: null,
    reserved,
    active,
    busy: reserved || active,
  };
}

function getActiveRunId(
  state: Pick<ChatState, "chatSending" | "chatRunId" | "chatLifecycleGuard">,
): string | null {
  return getLifecycleSnapshot(state).runId;
}

function endLifecycleRun(
  state: Pick<ChatState, "chatRunId" | "chatLifecycleGuard">,
  runId: string,
): boolean {
  if (!state.chatLifecycleGuard) {
    state.chatRunId = null;
    return true;
  }
  const snapshot = state.chatLifecycleGuard.getSnapshot();
  if (snapshot.runId !== runId || snapshot.generation == null) {
    return false;
  }
  return state.chatLifecycleGuard.end(snapshot.generation);
}

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey: state.sessionKey,
        limit: 200,
      },
    );
    state.chatMessages = Array.isArray(res.messages) ? res.messages : [];
    state.chatThinkingLevel = res.thinkingLevel ?? null;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.chatLoading = false;
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const lifecycle = state.chatLifecycleGuard;
  if (lifecycle && !lifecycle.reserve()) {
    return null;
  }

  let reservedLifecycle = Boolean(lifecycle);
  const runId = generateUUID();
  const generation = lifecycle?.tryStart(runId) ?? null;
  if (lifecycle) {
    reservedLifecycle = false;
    if (generation == null) {
      lifecycle.cancelReservation();
      return null;
    }
  }

  const now = Date.now();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
    },
  ];

  state.lastError = null;
  if (!lifecycle) {
    state.chatSending = true;
    state.chatRunId = runId;
  }
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = String(err);
    const endedCurrentRun = lifecycle ? generation != null && lifecycle.end(generation) : true;
    if (endedCurrentRun) {
      if (!lifecycle) {
        state.chatRunId = null;
      }
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.lastError = error;
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: "Error: " + error }],
          timestamp: Date.now(),
        },
      ];
    }
    return null;
  } finally {
    if (lifecycle) {
      if (reservedLifecycle) {
        lifecycle.cancelReservation();
      }
    } else {
      state.chatSending = false;
    }
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = getActiveRunId(state);
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  const activeRunId = getActiveRunId(state);
  if (payload.runId && activeRunId && payload.runId !== activeRunId) {
    if (payload.state === "final") {
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string") {
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        state.chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    const endedCurrentRun = endLifecycleRun(state, payload.runId);
    if (endedCurrentRun) {
      state.chatStream = null;
      state.chatStreamStartedAt = null;
    }
  } else if (payload.state === "aborted") {
    const endedCurrentRun = endLifecycleRun(state, payload.runId);
    if (endedCurrentRun) {
      state.chatStream = null;
      state.chatStreamStartedAt = null;
    }
  } else if (payload.state === "error") {
    const endedCurrentRun = endLifecycleRun(state, payload.runId);
    if (endedCurrentRun) {
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.lastError = payload.errorMessage ?? "chat error";
    }
  }
  return payload.state;
}
