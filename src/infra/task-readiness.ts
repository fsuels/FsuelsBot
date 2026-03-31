export type TaskNextRecommendedAction =
  | "start_task"
  | "wait_for_blockers"
  | "inspect_blockers"
  | "task_not_found";

export type TaskReadinessState = {
  unresolvedBlockers: string[];
  resolvedBlockers: string[];
  canStart: boolean;
  nextRecommendedAction: TaskNextRecommendedAction;
};

type TaskLike = {
  status?: unknown;
  blockers?: unknown;
  blocker?: unknown;
  handoff?: unknown;
  lane?: unknown;
};

const TERMINAL_STATUSES = new Set([
  "archived",
  "canceled",
  "cancelled",
  "closed",
  "completed",
  "done",
  "trashed",
]);
const STARTABLE_STATUSES = new Set([
  "active",
  "in_progress",
  "pending",
  "queued",
  "todo",
  "working",
]);
const WAITING_STATUSES = new Set([
  "blocked",
  "hold",
  "on_hold",
  "paused",
  "waiting",
  "waiting_human",
]);
const WAITING_LANES = new Set(["human", "paused"]);

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStatus(value: unknown): string | undefined {
  return normalizeText(value)?.toLowerCase();
}

function normalizeBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const blocker = normalizeText(entry);
    if (!blocker) {
      continue;
    }
    const key = blocker.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(blocker);
  }
  return out;
}

function splitResolvedBlockers(blockers: string[]) {
  const unresolvedBlockers: string[] = [];
  const resolvedBlockers: string[] = [];
  const resolvedMarkerSet = new Set<string>();
  const unresolvedSeen = new Set<string>();
  const resolvedSeen = new Set<string>();

  for (const blocker of blockers) {
    if (/^resolved\s*:/i.test(blocker)) {
      const normalized = normalizeText(blocker.replace(/^resolved\s*:/i, ""));
      if (normalized) {
        const key = normalized.toLowerCase();
        resolvedMarkerSet.add(key);
        if (!resolvedSeen.has(key)) {
          resolvedSeen.add(key);
          resolvedBlockers.push(normalized);
        }
      }
      continue;
    }
    const key = blocker.toLowerCase();
    if (unresolvedSeen.has(key)) {
      continue;
    }
    unresolvedSeen.add(key);
    unresolvedBlockers.push(blocker);
  }

  return {
    unresolvedBlockers: unresolvedBlockers.filter(
      (blocker) => !resolvedMarkerSet.has(blocker.toLowerCase()),
    ),
    resolvedBlockers,
  };
}

export function normalizeTaskReadiness(task?: TaskLike | null): TaskReadinessState {
  if (!task || typeof task !== "object") {
    return {
      unresolvedBlockers: [],
      resolvedBlockers: [],
      canStart: false,
      nextRecommendedAction: "task_not_found",
    };
  }

  const handoff = task.handoff && typeof task.handoff === "object" ? task.handoff : undefined;
  const rawBlockers = [
    ...normalizeBlockers(task.blockers),
    ...normalizeBlockers(
      handoff && typeof handoff === "object" ? (handoff as { blockers?: unknown }).blockers : [],
    ),
  ];
  const blockerText = normalizeText(task.blocker);
  if (blockerText) {
    rawBlockers.push(blockerText);
  }
  const { unresolvedBlockers, resolvedBlockers } = splitResolvedBlockers(rawBlockers);
  const status = normalizeStatus(task.status);
  const lane = normalizeStatus(task.lane);

  if (unresolvedBlockers.length > 0) {
    return {
      unresolvedBlockers,
      resolvedBlockers,
      canStart: false,
      nextRecommendedAction: WAITING_STATUSES.has(status ?? "")
        ? "wait_for_blockers"
        : "inspect_blockers",
    };
  }

  if (TERMINAL_STATUSES.has(status ?? "")) {
    return {
      unresolvedBlockers,
      resolvedBlockers,
      canStart: false,
      nextRecommendedAction: "inspect_blockers",
    };
  }

  if (WAITING_STATUSES.has(status ?? "") || WAITING_LANES.has(lane ?? "")) {
    return {
      unresolvedBlockers,
      resolvedBlockers,
      canStart: false,
      nextRecommendedAction: "wait_for_blockers",
    };
  }

  if (STARTABLE_STATUSES.has(status ?? "")) {
    return {
      unresolvedBlockers,
      resolvedBlockers,
      canStart: true,
      nextRecommendedAction: "start_task",
    };
  }

  return {
    unresolvedBlockers,
    resolvedBlockers,
    canStart: false,
    nextRecommendedAction: "inspect_blockers",
  };
}

export function decorateTaskWithReadiness<T extends Record<string, unknown>>(
  task: T,
): T & {
  unresolved_blockers: string[];
  resolved_blockers: string[];
  can_start: boolean;
  next_recommended_action: TaskNextRecommendedAction;
} {
  const readiness = normalizeTaskReadiness(task);
  return {
    ...task,
    unresolved_blockers: readiness.unresolvedBlockers,
    resolved_blockers: readiness.resolvedBlockers,
    can_start: readiness.canStart,
    next_recommended_action: readiness.nextRecommendedAction,
  };
}
