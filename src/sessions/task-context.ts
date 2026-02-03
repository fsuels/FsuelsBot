import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  buildSessionContext,
  type SessionEntry as PiSessionEntry,
  type SessionManager,
} from "@mariozechner/pi-coding-agent";

import type { SessionEntry, SessionTaskState } from "../config/sessions/types.js";

export const DEFAULT_SESSION_TASK_ID = "default";
export const TASK_CONTEXT_CUSTOM_TYPE = "moltbot-task-context";

type TaskMarkerEntry = Extract<PiSessionEntry, { type: "custom" }> & {
  customType: typeof TASK_CONTEXT_CUSTOM_TYPE;
  data?: TaskContextMarkerData;
};

type TaskReplayEntry = Extract<
  PiSessionEntry,
  {
    type:
      | "message"
      | "thinking_level_change"
      | "model_change"
      | "compaction"
      | "branch_summary"
      | "custom_message";
  }
>;

export type TaskContextMarkerData = {
  taskId: string;
  title?: string;
  fromTaskId?: string;
  switchedAt: number;
  source?: string;
};

type SessionTaskView = {
  taskId: string;
  status?: "active" | "paused" | "completed" | "archived";
  title?: string;
  compactionCount: number;
  totalTokens?: number;
  memoryFlushAt?: number;
  memoryFlushCompactionCount?: number;
};

function normalizeTaskStack(value: unknown, activeTaskId?: string): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const active = normalizeTaskId(activeTaskId);
  for (const raw of value) {
    const taskId = normalizeTaskId(raw);
    if (!taskId) continue;
    if (taskId === active) continue;
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    out.push(taskId);
    if (out.length >= 3) break;
  }
  return out;
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const normalizeTaskCount = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const next = Math.floor(value);
  return next >= 0 ? next : undefined;
};

export function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSessionTaskId(params: {
  entry?: Pick<SessionEntry, "activeTaskId">;
  fallbackTaskId?: string;
}): string {
  return (
    normalizeTaskId(params.fallbackTaskId) ??
    normalizeTaskId(params.entry?.activeTaskId) ??
    DEFAULT_SESSION_TASK_ID
  );
}

function resolveTaskState(
  entry: SessionEntry | undefined,
  taskId: string,
): SessionTaskState | undefined {
  const state = entry?.taskStateById?.[taskId];
  return state && typeof state === "object" ? state : undefined;
}

export function resolveSessionTaskView(params: {
  entry?: SessionEntry;
  taskId?: string;
}): SessionTaskView {
  const taskId = resolveSessionTaskId({
    entry: params.entry,
    fallbackTaskId: params.taskId,
  });
  const entry = params.entry;
  const state = resolveTaskState(entry, taskId);
  const activeTaskId = normalizeTaskId(entry?.activeTaskId);
  const map = entry?.taskStateById;
  const shouldUseLegacy =
    !state && (!map || Object.keys(map).length === 0 || (activeTaskId && activeTaskId === taskId));
  const legacyCompaction = shouldUseLegacy ? normalizeTaskCount(entry?.compactionCount) : undefined;
  const legacyTotalTokens =
    shouldUseLegacy && typeof entry?.totalTokens === "number" && Number.isFinite(entry.totalTokens)
      ? Math.floor(entry.totalTokens)
      : undefined;
  const legacyFlushAt =
    shouldUseLegacy &&
    typeof entry?.memoryFlushAt === "number" &&
    Number.isFinite(entry.memoryFlushAt)
      ? entry.memoryFlushAt
      : undefined;
  const legacyFlushCompaction =
    shouldUseLegacy &&
    typeof entry?.memoryFlushCompactionCount === "number" &&
    Number.isFinite(entry.memoryFlushCompactionCount)
      ? Math.floor(entry.memoryFlushCompactionCount)
      : undefined;
  return {
    taskId,
    status: state?.status ?? (activeTaskId === taskId ? "active" : undefined),
    title: state?.title ?? (activeTaskId === taskId ? entry?.activeTaskTitle : undefined),
    compactionCount: state?.compactionCount ?? legacyCompaction ?? 0,
    totalTokens: state?.totalTokens ?? legacyTotalTokens,
    memoryFlushAt: state?.memoryFlushAt ?? legacyFlushAt,
    memoryFlushCompactionCount: state?.memoryFlushCompactionCount ?? legacyFlushCompaction,
  };
}

export function applySessionTaskUpdate(
  entry: SessionEntry,
  params: {
    taskId?: string;
    status?: "active" | "paused" | "completed" | "archived" | null;
    title?: string | null;
    compactionCount?: number;
    totalTokens?: number;
    memoryFlushAt?: number;
    memoryFlushCompactionCount?: number;
    updatedAt?: number;
    source?: string;
  },
): SessionEntry {
  const updatedAt = Math.max(entry.updatedAt ?? 0, params.updatedAt ?? 0, Date.now());
  const taskView = resolveSessionTaskView({
    entry,
    taskId: params.taskId,
  });
  const nextTaskId = taskView.taskId;
  const previousTaskId = normalizeTaskId(entry.activeTaskId);
  const nextMap = { ...entry.taskStateById };
  const existingState = resolveTaskState(entry, nextTaskId);
  const resolvedCompactionCount =
    existingState?.compactionCount ??
    (taskView.compactionCount > 0 ? taskView.compactionCount : undefined);
  const nextState: SessionTaskState = {
    status: existingState?.status ?? taskView.status ?? "active",
    title: existingState?.title ?? taskView.title,
    compactionCount: resolvedCompactionCount,
    totalTokens: existingState?.totalTokens ?? taskView.totalTokens,
    memoryFlushAt: existingState?.memoryFlushAt ?? taskView.memoryFlushAt,
    memoryFlushCompactionCount:
      existingState?.memoryFlushCompactionCount ?? taskView.memoryFlushCompactionCount,
    updatedAt: Math.max(existingState?.updatedAt ?? 0, updatedAt),
  };

  if (hasOwn(params, "title")) {
    const normalizedTitle = normalizeTaskId(params.title ?? undefined);
    if (normalizedTitle) nextState.title = normalizedTitle;
    else delete nextState.title;
  }
  if (hasOwn(params, "status")) {
    const status = params.status;
    if (
      status === "active" ||
      status === "paused" ||
      status === "completed" ||
      status === "archived"
    ) {
      nextState.status = status;
    } else {
      delete nextState.status;
    }
  }
  if (hasOwn(params, "compactionCount")) {
    nextState.compactionCount = normalizeTaskCount(params.compactionCount);
  }
  if (hasOwn(params, "totalTokens")) {
    nextState.totalTokens = normalizeTaskCount(params.totalTokens);
  }
  if (hasOwn(params, "memoryFlushAt")) {
    if (typeof params.memoryFlushAt === "number" && Number.isFinite(params.memoryFlushAt)) {
      nextState.memoryFlushAt = Math.floor(params.memoryFlushAt);
    } else {
      delete nextState.memoryFlushAt;
    }
  }
  if (hasOwn(params, "memoryFlushCompactionCount")) {
    nextState.memoryFlushCompactionCount = normalizeTaskCount(params.memoryFlushCompactionCount);
  }
  nextMap[nextTaskId] = nextState;

  const switched = Boolean(previousTaskId && previousTaskId !== nextTaskId);
  if (switched && !hasOwn(params, "status")) {
    nextState.status = "active";
  }
  const existingStack = normalizeTaskStack(entry.taskStack, nextTaskId);
  const nextTaskStack = (() => {
    if (!switched || !previousTaskId) return existingStack;
    const merged = [previousTaskId, ...existingStack];
    return normalizeTaskStack(merged, nextTaskId);
  })();
  const nextEntry: SessionEntry = {
    ...entry,
    updatedAt,
    activeTaskId: nextTaskId,
    activeTaskTitle: nextState.title,
    compactionCount: nextState.compactionCount ?? 0,
    totalTokens: nextState.totalTokens,
    memoryFlushAt: nextState.memoryFlushAt,
    memoryFlushCompactionCount: nextState.memoryFlushCompactionCount,
    taskStack: nextTaskStack,
    taskStateById: nextMap,
  };
  if (!nextEntry.activeTaskTitle) {
    delete nextEntry.activeTaskTitle;
  }
  if (switched) {
    nextEntry.lastTaskSwitch = {
      fromTaskId: previousTaskId,
      toTaskId: nextTaskId,
      switchedAt: updatedAt,
      source: params.source,
    };
    nextEntry.lastTaskSwitchAt = updatedAt;
  }
  return nextEntry;
}

export function ensureSessionTaskState(
  entry: SessionEntry,
  params?: { taskId?: string; source?: string; updatedAt?: number },
): SessionEntry {
  return applySessionTaskUpdate(entry, {
    taskId: params?.taskId,
    updatedAt: params?.updatedAt,
    source: params?.source,
  });
}

function asTaskMarkerEntry(entry: PiSessionEntry): TaskMarkerEntry | null {
  if (entry.type !== "custom" || entry.customType !== TASK_CONTEXT_CUSTOM_TYPE) return null;
  if (!entry.data || typeof entry.data !== "object") return null;
  const data = entry.data as TaskContextMarkerData;
  const taskId = normalizeTaskId(data.taskId);
  if (!taskId) return null;
  return {
    ...entry,
    customType: TASK_CONTEXT_CUSTOM_TYPE,
    data: {
      ...data,
      taskId,
    },
  };
}

function isTaskReplayEntry(entry: PiSessionEntry): entry is TaskReplayEntry {
  switch (entry.type) {
    case "message":
    case "thinking_level_change":
    case "model_change":
    case "compaction":
    case "branch_summary":
    case "custom_message":
      return true;
    default:
      return false;
  }
}

export function readLastTaskContextMarker(
  sessionManager: SessionManager,
): TaskContextMarkerData | null {
  const entries = sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const marker = asTaskMarkerEntry(entries[i]);
    if (!marker?.data) continue;
    return marker.data;
  }
  return null;
}

export function appendTaskContextMarker(params: {
  sessionManager: SessionManager;
  taskId: string;
  title?: string;
  source?: string;
  force?: boolean;
}): { appended: boolean; marker: TaskContextMarkerData } {
  const taskId = normalizeTaskId(params.taskId) ?? DEFAULT_SESSION_TASK_ID;
  const title = normalizeTaskId(params.title);
  const prior = readLastTaskContextMarker(params.sessionManager);
  const changed = !prior || prior.taskId !== taskId || (title && prior.title !== title);
  const marker: TaskContextMarkerData = {
    taskId,
    title,
    fromTaskId: changed ? prior?.taskId : undefined,
    switchedAt: Date.now(),
    source: params.source,
  };
  if (!params.force && !changed) {
    return { appended: false, marker };
  }
  params.sessionManager.appendCustomEntry(TASK_CONTEXT_CUSTOM_TYPE, marker);
  return { appended: true, marker };
}

export function resolveTaskScopedHistoryMessages(params: {
  sessionManager: SessionManager;
  taskId?: string;
}): { messages: AgentMessage[]; scoped: boolean } {
  const taskId = normalizeTaskId(params.taskId) ?? DEFAULT_SESSION_TASK_ID;
  const branch = params.sessionManager.getBranch();
  if (branch.length === 0) {
    return { messages: [], scoped: false };
  }

  let currentTaskId = DEFAULT_SESSION_TASK_ID;
  let sawMarker = false;
  const scopedEntries: TaskReplayEntry[] = [];

  for (const entry of branch) {
    const marker = asTaskMarkerEntry(entry);
    if (marker?.data?.taskId) {
      currentTaskId = marker.data.taskId;
      sawMarker = true;
      continue;
    }
    if (currentTaskId !== taskId) continue;
    if (!isTaskReplayEntry(entry)) continue;
    scopedEntries.push(entry);
  }

  if (!sawMarker) {
    return {
      messages: params.sessionManager.buildSessionContext().messages,
      scoped: false,
    };
  }
  if (scopedEntries.length === 0) {
    return { messages: [], scoped: true };
  }

  const linearized = scopedEntries.map((entry, index) => ({
    ...entry,
    parentId: index === 0 ? null : scopedEntries[index - 1].id,
  })) as PiSessionEntry[];
  const context = buildSessionContext(linearized, linearized[linearized.length - 1]?.id);
  return { messages: context.messages, scoped: true };
}
