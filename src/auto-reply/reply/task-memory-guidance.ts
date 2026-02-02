import type { SessionEntry } from "../../config/sessions/types.js";
import { DEFAULT_SESSION_TASK_ID } from "../../sessions/task-context.js";

const LONG_SILENCE_MS = 6 * 60 * 60 * 1000;
const COMPLEX_TASK_TOKENS = 12_000;
const LOW_CONFIDENCE_SCORE = 0.72;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function hasCriticalMemoryPhrase(message: string): boolean {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  return (
    normalized.includes("important") ||
    normalized.includes("dont forget") ||
    normalized.includes("don't forget") ||
    normalized.includes("must remember") ||
    normalized.includes("must not forget")
  );
}

function looksMultiIntent(message: string): boolean {
  const normalized = normalizeText(message);
  if (!normalized || normalized.length < 20) return false;
  const joinerCount = (normalized.match(/\b(and|also|then)\b/g) ?? []).length;
  if (joinerCount < 1) return false;
  const actionCount = (
    normalized.match(
      /\b(fix|build|write|review|check|update|continue|start|create|refactor|investigate|test)\b/g,
    ) ?? []
  ).length;
  return actionCount >= 2;
}

export function selectTaskMemoryNudge(params: {
  message: string;
  isNewSession: boolean;
  sessionEntry?: SessionEntry;
  activeTaskId: string;
  inferredTaskId?: string;
  inferredTaskScore?: number;
  inferredTaskConfidence?: "low" | "medium" | "high";
  ambiguousTaskIds?: string[];
  taskCompactionCount?: number;
  taskTotalTokens?: number;
  hasImportantConflict?: boolean;
  now?: number;
}): string | null {
  const message = params.message.trim();
  const now = params.now ?? Date.now();
  const lastUpdatedAt = params.sessionEntry?.updatedAt ?? now;
  const idleMs = Math.max(0, now - lastUpdatedAt);
  const activeTaskId = params.activeTaskId.trim() || DEFAULT_SESSION_TASK_ID;
  const inferredTaskId = params.inferredTaskId?.trim();
  const inferredTaskScore = params.inferredTaskScore ?? 0;

  if (params.hasImportantConflict) {
    return (
      "I see a conflict between something marked as important and something newer. " +
      "Which one should I treat as correct?"
    );
  }

  if (hasCriticalMemoryPhrase(message)) {
    return "Got it. I will treat this as important and remember it.";
  }

  if (params.ambiguousTaskIds && params.ambiguousTaskIds.length > 0) {
    return (
      "I remember a few things that could match this. " +
      "Can you tell me which one you want to continue?"
    );
  }

  if (params.isNewSession && inferredTaskId && inferredTaskId !== DEFAULT_SESSION_TASK_ID) {
    return "I remember this task. Do you want me to continue from where we left off?";
  }

  if (params.isNewSession && !inferredTaskId && message.length <= 30) {
    return (
      "Just checking - do you want to continue something we worked on before, " +
      "or start a new topic?"
    );
  }

  if (params.isNewSession || idleMs >= LONG_SILENCE_MS) {
    return "Before we begin - what would you like to work on?";
  }

  if (
    inferredTaskId &&
    inferredTaskId !== activeTaskId &&
    inferredTaskId !== DEFAULT_SESSION_TASK_ID
  ) {
    return "It looks like we may be switching topics. Is this something new?";
  }

  if (looksMultiIntent(message)) {
    return "I can help with both, but it is clearer to do one at a time. Which should we start with?";
  }

  if (
    inferredTaskId &&
    inferredTaskId !== DEFAULT_SESSION_TASK_ID &&
    (params.inferredTaskConfidence === "low" || inferredTaskScore < LOW_CONFIDENCE_SCORE)
  ) {
    return (
      "I am not fully confident I am using the right saved information. " +
      "Should I continue without using memory, or search again?"
    );
  }

  if (
    activeTaskId === DEFAULT_SESSION_TASK_ID &&
    message.length >= 40 &&
    idleMs < LONG_SILENCE_MS
  ) {
    return "Just checking - should I treat this as one ongoing task?";
  }

  const compactionCount = params.taskCompactionCount ?? 0;
  const totalTokens = params.taskTotalTokens ?? 0;
  if (compactionCount >= 2 || totalTokens >= COMPLEX_TASK_TOKENS) {
    return "Would you like me to save where we are so we can continue later?";
  }

  return null;
}
