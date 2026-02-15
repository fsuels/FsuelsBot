import { emitDiagnosticEvent } from "../infra/diagnostic-events.js";
import {
  applyWalRetentionPolicy,
  pruneExpiredTransientBufferItems,
} from "./task-memory-system.js";
import { forgetMemoryPins } from "./pins.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetentionPolicyConfig = {
  /** Enable WAL segment compaction (default: true) */
  walCompaction: boolean;
  /** Enable transient buffer TTL pruning (default: true) */
  transientBufferPrune: boolean;
  /** Enable expired pin pruning (default: true) */
  expiredPinPrune: boolean;
  /** Minimum milliseconds between retention runs (default: 60_000 = 1 min) */
  cooldownMs: number;
};

export type RetentionResult = {
  ran: boolean;
  skippedReason?: "cooldown" | "error";
  walPrunedSegments?: number;
  transientBufferPruned?: number;
  expiredPinsPruned?: number;
  errors?: string[];
};

const DEFAULT_RETENTION_CONFIG: RetentionPolicyConfig = {
  walCompaction: true,
  transientBufferPrune: true,
  expiredPinPrune: true,
  cooldownMs: 60_000,
};

// ---------------------------------------------------------------------------
// Cooldown tracking (per-workspace)
// ---------------------------------------------------------------------------

const lastRunTimestamps = new Map<string, number>();

function shouldRun(workspaceDir: string, cooldownMs: number, now: number): boolean {
  const lastRun = lastRunTimestamps.get(workspaceDir);
  if (lastRun && now - lastRun < cooldownMs) {
    return false;
  }
  return true;
}

function markRun(workspaceDir: string, now: number): void {
  lastRunTimestamps.set(workspaceDir, now);
}

/**
 * Reset cooldown tracking — useful for testing.
 */
export function resetRetentionCooldowns(): void {
  lastRunTimestamps.clear();
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run retention policies for a workspace. Rate-limited by cooldown.
 *
 * This should be called:
 * 1. After each `commitMemoryEvents()` batch (piggyback on existing writes)
 * 2. On startup / session init
 * 3. Periodically from a health-check or heartbeat loop
 *
 * All operations are best-effort: failures are captured and returned,
 * not thrown, so callers can proceed even if retention partially fails.
 */
export async function runRetentionPolicies(params: {
  workspaceDir: string;
  config?: Partial<RetentionPolicyConfig>;
  now?: number;
  /** Skip cooldown check (useful for testing or forced runs) */
  force?: boolean;
  /** Enable diagnostic event emission */
  diagnosticsEnabled?: boolean;
}): Promise<RetentionResult> {
  const now = params.now ?? Date.now();
  const config = { ...DEFAULT_RETENTION_CONFIG, ...params.config };

  if (!params.force && !shouldRun(params.workspaceDir, config.cooldownMs, now)) {
    return { ran: false, skippedReason: "cooldown" };
  }

  markRun(params.workspaceDir, now);
  const errors: string[] = [];
  let walPrunedSegments = 0;
  let transientBufferPruned = 0;
  let expiredPinsPruned = 0;

  // 1. WAL segment compaction
  if (config.walCompaction) {
    try {
      const result = await applyWalRetentionPolicy({
        workspaceDir: params.workspaceDir,
        now,
      });
      walPrunedSegments = result.prunedSegments;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`wal-compaction: ${message}`);
    }
  }

  // 2. Transient buffer TTL cleanup
  if (config.transientBufferPrune) {
    try {
      transientBufferPruned = await pruneExpiredTransientBufferItems({
        workspaceDir: params.workspaceDir,
        now,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`transient-buffer-prune: ${message}`);
    }
  }

  // 3. Expired pin cleanup
  if (config.expiredPinPrune) {
    try {
      expiredPinsPruned = await pruneExpiredPins({
        workspaceDir: params.workspaceDir,
        now,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`expired-pin-prune: ${message}`);
    }
  }

  // Emit diagnostic event if any work was done
  if (
    params.diagnosticsEnabled &&
    (walPrunedSegments > 0 || transientBufferPruned > 0 || expiredPinsPruned > 0)
  ) {
    emitDiagnosticEvent({
      type: "memory.retention_run",
      walPrunedSegments,
      transientBufferPruned,
      expiredPinsPruned,
      errorCount: errors.length,
    });
  }

  return {
    ran: true,
    walPrunedSegments,
    transientBufferPruned,
    expiredPinsPruned,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

// ---------------------------------------------------------------------------
// Expired pin pruning
// ---------------------------------------------------------------------------

/**
 * Remove expired temporary pins (those with TTL that has passed).
 * Uses the existing forgetMemoryPins with time-based filtering.
 */
async function pruneExpiredPins(params: {
  workspaceDir: string;
  now?: number;
}): Promise<number> {
  const { listMemoryPins, removeMemoryPin } = await import("./pins.js");
  const now = params.now ?? Date.now();

  // List ALL pins (including expired) vs only active pins to find which expired
  const allPins = await listMemoryPins({ workspaceDir: params.workspaceDir, includeExpired: true });
  const activePins = await listMemoryPins({ workspaceDir: params.workspaceDir, now });
  const expiredIds = new Set(
    allPins
      .filter((pin) => !activePins.some((active) => active.id === pin.id))
      .map((pin) => pin.id),
  );

  let removed = 0;
  for (const id of expiredIds) {
    const success = await removeMemoryPin({
      workspaceDir: params.workspaceDir,
      id,
    });
    if (success) removed += 1;
  }
  return removed;
}
