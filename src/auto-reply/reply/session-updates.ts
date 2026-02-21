import crypto from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveUserTimezone } from "../../agents/date-time.js";
import { buildWorkspaceSkillSnapshot } from "../../agents/skills.js";
import { ensureSkillsWatcher, getSkillsSnapshotVersion } from "../../agents/skills/refresh.js";
import { checkpointActiveTask } from "../../agents/task-checkpoint.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";
import { buildChannelSummary } from "../../infra/channel-summary.js";
import {
  resolveTimezone,
  formatUtcTimestamp,
  formatZonedTimestamp,
} from "../../infra/format-time/format-datetime.ts";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { drainSystemEventEntries } from "../../infra/system-events.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { applySessionTaskUpdate, resolveSessionTaskView } from "../../sessions/task-context.js";

const log = createSubsystemLogger("session-updates");

export async function prependSystemEvents(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  isMainSession: boolean;
  isNewSession: boolean;
  prefixedBodyBase: string;
}): Promise<string> {
  const compactSystemEvent = (line: string): string | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes("reason periodic")) {
      return null;
    }
    // Filter out the actual heartbeat prompt, but not cron jobs that mention "heartbeat"
    // The heartbeat prompt starts with "Read HEARTBEAT.md" - cron payloads won't match this
    if (lower.startsWith("read heartbeat.md")) {
      return null;
    }
    // Also filter heartbeat poll/wake noise
    if (lower.includes("heartbeat poll") || lower.includes("heartbeat wake")) {
      return null;
    }
    if (trimmed.startsWith("Node:")) {
      return trimmed.replace(/ · last input [^·]+/i, "").trim();
    }
    return trimmed;
  };

  const resolveSystemEventTimezone = (cfg: OpenClawConfig) => {
    const raw = cfg.agents?.defaults?.envelopeTimezone?.trim();
    if (!raw) {
      return { mode: "local" as const };
    }
    const lowered = raw.toLowerCase();
    if (lowered === "utc" || lowered === "gmt") {
      return { mode: "utc" as const };
    }
    if (lowered === "local" || lowered === "host") {
      return { mode: "local" as const };
    }
    if (lowered === "user") {
      return {
        mode: "iana" as const,
        timeZone: resolveUserTimezone(cfg.agents?.defaults?.userTimezone),
      };
    }
    const explicit = resolveTimezone(raw);
    return explicit ? { mode: "iana" as const, timeZone: explicit } : { mode: "local" as const };
  };

  const formatSystemEventTimestamp = (ts: number, cfg: OpenClawConfig) => {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
      return "unknown-time";
    }
    const zone = resolveSystemEventTimezone(cfg);
    if (zone.mode === "utc") {
      return formatUtcTimestamp(date, { displaySeconds: true });
    }
    if (zone.mode === "local") {
      return formatZonedTimestamp(date, { displaySeconds: true }) ?? "unknown-time";
    }
    return (
      formatZonedTimestamp(date, { timeZone: zone.timeZone, displaySeconds: true }) ??
      "unknown-time"
    );
  };

  const systemLines: string[] = [];
  const queued = drainSystemEventEntries(params.sessionKey);
  systemLines.push(
    ...queued
      .map((event) => {
        const compacted = compactSystemEvent(event.text);
        if (!compacted) {
          return null;
        }
        return `[${formatSystemEventTimestamp(event.ts, params.cfg)}] ${compacted}`;
      })
      .filter((v): v is string => Boolean(v)),
  );
  if (params.isMainSession && params.isNewSession) {
    const summary = await buildChannelSummary(params.cfg);
    if (summary.length > 0) {
      systemLines.unshift(...summary);
    }
  }
  if (systemLines.length === 0) {
    return params.prefixedBodyBase;
  }

  const block = systemLines.map((l) => `System: ${l}`).join("\n");
  return `${block}\n\n${params.prefixedBodyBase}`;
}

export async function ensureSkillSnapshot(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  sessionId?: string;
  isFirstTurnInSession: boolean;
  workspaceDir: string;
  cfg: OpenClawConfig;
  /** If provided, only load skills with these names (for per-channel skill filtering) */
  skillFilter?: string[];
}): Promise<{
  sessionEntry?: SessionEntry;
  skillsSnapshot?: SessionEntry["skillsSnapshot"];
  systemSent: boolean;
}> {
  const {
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionId,
    isFirstTurnInSession,
    workspaceDir,
    cfg,
    skillFilter,
  } = params;

  let nextEntry = sessionEntry;
  let systemSent = sessionEntry?.systemSent ?? false;
  const remoteEligibility = getRemoteSkillEligibility();
  const snapshotVersion = getSkillsSnapshotVersion(workspaceDir);
  ensureSkillsWatcher({ workspaceDir, config: cfg });
  const shouldRefreshSnapshot =
    snapshotVersion > 0 && (nextEntry?.skillsSnapshot?.version ?? 0) < snapshotVersion;

  if (isFirstTurnInSession && sessionStore && sessionKey) {
    const current = nextEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionId ?? crypto.randomUUID(),
        updatedAt: Date.now(),
      };
    const skillSnapshot =
      isFirstTurnInSession || !current.skillsSnapshot || shouldRefreshSnapshot
        ? buildWorkspaceSkillSnapshot(workspaceDir, {
            config: cfg,
            skillFilter,
            eligibility: { remote: remoteEligibility },
            snapshotVersion,
          })
        : current.skillsSnapshot;
    nextEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      systemSent: true,
      skillsSnapshot: skillSnapshot,
    };
    sessionStore[sessionKey] = { ...sessionStore[sessionKey], ...nextEntry };
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = { ...store[sessionKey], ...nextEntry };
      });
    }
    systemSent = true;
  }

  const skillsSnapshot = shouldRefreshSnapshot
    ? buildWorkspaceSkillSnapshot(workspaceDir, {
        config: cfg,
        skillFilter,
        eligibility: { remote: remoteEligibility },
        snapshotVersion,
      })
    : (nextEntry?.skillsSnapshot ??
      (isFirstTurnInSession
        ? undefined
        : buildWorkspaceSkillSnapshot(workspaceDir, {
            config: cfg,
            skillFilter,
            eligibility: { remote: remoteEligibility },
            snapshotVersion,
          })));
  if (
    skillsSnapshot &&
    sessionStore &&
    sessionKey &&
    !isFirstTurnInSession &&
    (!nextEntry?.skillsSnapshot || shouldRefreshSnapshot)
  ) {
    const current = nextEntry ?? {
      sessionId: sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    nextEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      skillsSnapshot,
    };
    sessionStore[sessionKey] = { ...sessionStore[sessionKey], ...nextEntry };
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = { ...store[sessionKey], ...nextEntry };
      });
    }
  }

  return { sessionEntry: nextEntry, skillsSnapshot, systemSent };
}

export async function incrementCompactionCount(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  taskId?: string;
  storePath?: string;
  now?: number;
  /** Token count after compaction - if provided, updates session token counts */
  tokensAfter?: number;
}): Promise<number | undefined> {
  const {
    sessionEntry,
    sessionStore,
    sessionKey,
    taskId,
    storePath,
    now = Date.now(),
    tokensAfter,
  } = params;
  if (!sessionStore || !sessionKey) {
    return undefined;
  }
  const entry = sessionStore[sessionKey] ?? sessionEntry;
  if (!entry) {
    return undefined;
  }
  const taskView = resolveSessionTaskView({ entry, taskId });
  const nextCount = taskView.compactionCount + 1;
  const compactionUpdate: Parameters<typeof applySessionTaskUpdate>[1] = {
    taskId: taskView.taskId,
    compactionCount: nextCount,
    updatedAt: now,
    source: "compaction",
  };
  if (tokensAfter != null && tokensAfter > 0) {
    compactionUpdate.totalTokens = tokensAfter;
  }
  let nextEntry = applySessionTaskUpdate(entry, compactionUpdate);
  // If tokensAfter is provided, update the cached token counts to reflect post-compaction state
  if (tokensAfter != null && tokensAfter > 0) {
    nextEntry = {
      ...nextEntry,
      totalTokens: tokensAfter,
      // Clear input/output breakdown since we only have the total estimate after compaction
      inputTokens: undefined,
      outputTokens: undefined,
    };
  }
  sessionStore[sessionKey] = nextEntry;
  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      const storeEntry = store[sessionKey] ?? entry;
      const storeCompactionUpdate: Parameters<typeof applySessionTaskUpdate>[1] = {
        taskId: taskView.taskId,
        compactionCount: nextCount,
        updatedAt: now,
        source: "compaction",
      };
      if (tokensAfter != null && tokensAfter > 0) {
        storeCompactionUpdate.totalTokens = tokensAfter;
      }
      let updated = applySessionTaskUpdate(storeEntry, storeCompactionUpdate);
      if (tokensAfter != null && tokensAfter > 0) {
        updated = {
          ...updated,
          totalTokens: tokensAfter,
          inputTokens: undefined,
          outputTokens: undefined,
        };
      }
      store[sessionKey] = updated;
    });
  }
  return nextCount;
}

// ---------------------------------------------------------------------------
// Periodic task card checkpoint
// ---------------------------------------------------------------------------

/** How many reply turns between automatic task checkpoints. */
const TASK_CHECKPOINT_INTERVAL = 5;

/**
 * Increments `replyCount` on the session and, every N turns, fires
 * `checkpointActiveTask()` to persist the task card to disk.
 *
 * This makes task card saves automatic — the agent no longer relies
 * exclusively on behavioral instructions to save progress.
 */
export async function persistTaskCheckpointIfDue(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  workspaceDir?: string;
  taskId?: string;
}): Promise<void> {
  const { sessionStore, sessionKey, storePath, workspaceDir } = params;

  // Can't do anything without session plumbing or workspace
  if (!sessionStore || !sessionKey || !workspaceDir) {
    return;
  }

  const entry = sessionStore[sessionKey] ?? params.sessionEntry;
  if (!entry) {
    return;
  }

  // Only checkpoint if there's an active task
  const activeTaskId = params.taskId ?? entry.activeTaskId;
  if (!activeTaskId) {
    return;
  }

  // Increment reply count
  const nextReplyCount = (entry.replyCount ?? 0) + 1;
  entry.replyCount = nextReplyCount;
  sessionStore[sessionKey] = entry;

  // Persist the count bump
  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      const storeEntry = store[sessionKey];
      if (storeEntry) {
        storeEntry.replyCount = nextReplyCount;
        store[sessionKey] = storeEntry;
      }
    });
  }

  // Fire checkpoint every N turns
  if (nextReplyCount % TASK_CHECKPOINT_INTERVAL === 0) {
    try {
      const saved = await checkpointActiveTask({ workspaceDir });
      if (saved) {
        log.info("periodic task checkpoint saved", {
          taskId: activeTaskId,
          replyCount: nextReplyCount,
        });
      }
    } catch (err) {
      log.warn(`periodic task checkpoint failed: ${err}`);
    }
  }
}
