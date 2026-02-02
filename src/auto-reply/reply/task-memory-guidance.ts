import type { SessionEntry } from "../../config/sessions/types.js";
import { DEFAULT_SESSION_TASK_ID } from "../../sessions/task-context.js";

const LONG_SILENCE_MS = 6 * 60 * 60 * 1000;
const COMPLEX_TASK_TOKENS = 12_000;
const LOW_CONFIDENCE_SCORE = 0.72;
const RESPONSE_WINDOW_MS = 30 * 60 * 1000;

export type MemoryGuidanceMode = "supportive" | "minimal";

export type MemoryGuidanceNudgeKind =
  | "important-conflict"
  | "critical-memory"
  | "task-ambiguous"
  | "resume-known-task"
  | "new-session-unclear"
  | "session-start"
  | "topic-switch"
  | "multi-intent"
  | "low-confidence"
  | "missing-task"
  | "long-task-save";

export type MemoryGuidanceDecision = {
  kind: MemoryGuidanceNudgeKind;
  text: string;
};

export type MemoryGuidanceUserSignal = "explicit-task" | "none";

export type MemoryGuidanceState = {
  mode: MemoryGuidanceMode;
  promptCount: number;
  explicitCount: number;
  ignoredCount: number;
  lastNudgeKind?: MemoryGuidanceNudgeKind;
  lastNudgeAt?: number;
};

export type MemoryGuidanceResponse = {
  priorNudgeKind: MemoryGuidanceNudgeKind;
  response: "acknowledged" | "ignored";
  latencyMs?: number;
};

export type MemoryGuidanceTurnUpdate = {
  next: MemoryGuidanceState;
  changed: boolean;
  modeChanged: boolean;
  response?: MemoryGuidanceResponse;
};

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

export function detectMemoryGuidanceUserSignal(message: string): MemoryGuidanceUserSignal {
  const normalized = normalizeText(message);
  if (!normalized) return "none";
  if (/^\/task\b/.test(normalized)) return "explicit-task";
  if (
    /\b(working on|work on|continue (with )?(task|project|topic)|start(ing)? (a )?new (task|topic|project)|switch(ing)? to|resume|let'?s continue)\b/.test(
      normalized,
    )
  ) {
    return "explicit-task";
  }
  return "none";
}

export function resolveMemoryGuidanceState(entry?: SessionEntry): MemoryGuidanceState {
  const rawMode = entry?.memoryGuidanceMode;
  const mode: MemoryGuidanceMode = rawMode === "minimal" ? "minimal" : "supportive";
  const promptCount =
    typeof entry?.memoryGuidancePromptCount === "number" && entry.memoryGuidancePromptCount > 0
      ? Math.floor(entry.memoryGuidancePromptCount)
      : 0;
  const explicitCount =
    typeof entry?.memoryGuidanceExplicitCount === "number" && entry.memoryGuidanceExplicitCount > 0
      ? Math.floor(entry.memoryGuidanceExplicitCount)
      : 0;
  const ignoredCount =
    typeof entry?.memoryGuidanceIgnoredCount === "number" && entry.memoryGuidanceIgnoredCount > 0
      ? Math.floor(entry.memoryGuidanceIgnoredCount)
      : 0;
  const lastNudgeKind = (() => {
    const value = entry?.memoryGuidanceLastNudgeKind?.trim();
    return value ? (value as MemoryGuidanceNudgeKind) : undefined;
  })();
  const lastNudgeAt =
    typeof entry?.memoryGuidanceLastNudgeAt === "number" && Number.isFinite(entry.memoryGuidanceLastNudgeAt)
      ? Math.floor(entry.memoryGuidanceLastNudgeAt)
      : undefined;
  return {
    mode,
    promptCount,
    explicitCount,
    ignoredCount,
    lastNudgeKind,
    lastNudgeAt,
  };
}

function resolveNextMode(state: MemoryGuidanceState): MemoryGuidanceMode {
  if (
    state.mode === "supportive" &&
    state.explicitCount >= 3 &&
    state.promptCount >= 2 &&
    state.ignoredCount === 0
  ) {
    return "minimal";
  }
  if (state.mode === "minimal" && state.ignoredCount >= 2) {
    return "supportive";
  }
  return state.mode;
}

export function applyMemoryGuidanceTurn(params: {
  state: MemoryGuidanceState;
  userSignal: MemoryGuidanceUserSignal;
  shownNudgeKind?: MemoryGuidanceNudgeKind;
  now?: number;
}): MemoryGuidanceTurnUpdate {
  const now = params.now ?? Date.now();
  const next: MemoryGuidanceState = {
    ...params.state,
  };
  let response: MemoryGuidanceResponse | undefined;

  if (params.userSignal === "explicit-task") {
    next.explicitCount += 1;
  }

  if (next.lastNudgeKind) {
    const latency =
      typeof next.lastNudgeAt === "number" && Number.isFinite(next.lastNudgeAt)
        ? Math.max(0, now - next.lastNudgeAt)
        : undefined;
    const inWindow = latency == null || latency <= RESPONSE_WINDOW_MS;
    if (inWindow) {
      if (params.userSignal === "explicit-task") {
        response = {
          priorNudgeKind: next.lastNudgeKind,
          response: "acknowledged",
          latencyMs: latency,
        };
      } else {
        next.ignoredCount += 1;
        response = {
          priorNudgeKind: next.lastNudgeKind,
          response: "ignored",
          latencyMs: latency,
        };
      }
    }
    delete next.lastNudgeKind;
    delete next.lastNudgeAt;
  }

  if (params.shownNudgeKind) {
    next.promptCount += 1;
    next.lastNudgeKind = params.shownNudgeKind;
    next.lastNudgeAt = now;
  }

  const resolvedMode = resolveNextMode(next);
  const modeChanged = resolvedMode !== next.mode;
  next.mode = resolvedMode;

  const changed =
    next.mode !== params.state.mode ||
    next.promptCount !== params.state.promptCount ||
    next.explicitCount !== params.state.explicitCount ||
    next.ignoredCount !== params.state.ignoredCount ||
    next.lastNudgeKind !== params.state.lastNudgeKind ||
    next.lastNudgeAt !== params.state.lastNudgeAt;

  return {
    next,
    changed,
    modeChanged,
    response,
  };
}

export function selectTaskMemoryNudge(params: {
  message: string;
  isNewSession: boolean;
  sessionEntry?: SessionEntry;
  activeTaskId: string;
  guidanceMode?: MemoryGuidanceMode;
  inferredTaskId?: string;
  inferredTaskScore?: number;
  inferredTaskConfidence?: "low" | "medium" | "high";
  ambiguousTaskIds?: string[];
  taskCompactionCount?: number;
  taskTotalTokens?: number;
  hasImportantConflict?: boolean;
  now?: number;
}): MemoryGuidanceDecision | null {
  const message = params.message.trim();
  const mode = params.guidanceMode ?? "supportive";
  const now = params.now ?? Date.now();
  const lastUpdatedAt = params.sessionEntry?.updatedAt ?? now;
  const idleMs = Math.max(0, now - lastUpdatedAt);
  const activeTaskId = params.activeTaskId.trim() || DEFAULT_SESSION_TASK_ID;
  const inferredTaskId = params.inferredTaskId?.trim();
  const inferredTaskScore = params.inferredTaskScore ?? 0;

  if (params.hasImportantConflict) {
    return {
      kind: "important-conflict",
      text:
        "I see a conflict between something marked as important and something newer. " +
        "Which one should I treat as correct?",
    };
  }

  if (hasCriticalMemoryPhrase(message)) {
    return {
      kind: "critical-memory",
      text: "Got it. I will treat this as important and remember it.",
    };
  }

  if (params.ambiguousTaskIds && params.ambiguousTaskIds.length > 0) {
    return {
      kind: "task-ambiguous",
      text:
        "I remember a few things that could match this. " +
        "Can you tell me which one you want to continue?",
    };
  }

  if (params.isNewSession && inferredTaskId && inferredTaskId !== DEFAULT_SESSION_TASK_ID) {
    return {
      kind: "resume-known-task",
      text: "I remember this task. Do you want me to continue from where we left off?",
    };
  }

  if (params.isNewSession && !inferredTaskId && message.length <= 30) {
    return {
      kind: "new-session-unclear",
      text:
        mode === "minimal"
          ? "Quick check - should I continue what we were doing, or start something new?"
          : "Just checking - do you want to continue something we worked on before, or start a new topic?",
    };
  }

  if (mode === "supportive" && (params.isNewSession || idleMs >= LONG_SILENCE_MS)) {
    return {
      kind: "session-start",
      text: "Before we begin - what would you like to work on?",
    };
  }

  if (
    inferredTaskId &&
    inferredTaskId !== activeTaskId &&
    inferredTaskId !== DEFAULT_SESSION_TASK_ID
  ) {
    return {
      kind: "topic-switch",
      text: "It looks like we may be switching topics. Is this something new?",
    };
  }

  if (looksMultiIntent(message)) {
    return {
      kind: "multi-intent",
      text: "I can help with both, but it is clearer to do one at a time. Which should we start with?",
    };
  }

  if (
    inferredTaskId &&
    inferredTaskId !== DEFAULT_SESSION_TASK_ID &&
    (params.inferredTaskConfidence === "low" || inferredTaskScore < LOW_CONFIDENCE_SCORE)
  ) {
    return {
      kind: "low-confidence",
      text:
        "I am not fully confident I am using the right saved information. " +
        "Should I continue without using memory, or search again?",
    };
  }

  if (
    mode === "supportive" &&
    activeTaskId === DEFAULT_SESSION_TASK_ID &&
    message.length >= 40 &&
    idleMs < LONG_SILENCE_MS
  ) {
    return {
      kind: "missing-task",
      text: "Just checking - should I treat this as one ongoing task?",
    };
  }

  const compactionCount = params.taskCompactionCount ?? 0;
  const totalTokens = params.taskTotalTokens ?? 0;
  if (mode === "supportive" && (compactionCount >= 2 || totalTokens >= COMPLEX_TASK_TOKENS)) {
    return {
      kind: "long-task-save",
      text: "Would you like me to save where we are so we can continue later?",
    };
  }

  return null;
}

