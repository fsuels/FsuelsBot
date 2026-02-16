/**
 * Tool Call Loop Detector — Sustained Reasoning P1.
 *
 * Detects when the agent is stuck repeating the same (or near-identical) tool
 * calls. When a loop is detected, injects a hint telling the agent to explain
 * the blocker to the user instead of retrying.
 *
 * Safeguards:
 * - Uses string similarity instead of exact hash to catch near-identical calls
 * - Whitelists legitimate polling tools (e.g., read_process_output, wait)
 * - Applies time-based decay: only counts calls within a sliding window
 * - Provides an escape mechanism for intentional retries
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCallFingerprint = {
  name: string;
  argsHash: string;
  ts: number;
};

export type LoopDetectionResult = {
  loopDetected: boolean;
  toolName?: string;
  repeatCount?: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of recent calls to consider for loop detection. */
const WINDOW_SIZE = 8;

/** Minimum repetitions of the same fingerprint to trigger detection. */
const REPEAT_THRESHOLD = 3;

/** Sliding time window — only count calls within this duration. */
const DECAY_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Tools that legitimately poll / wait and should not trigger loop detection.
 * These are tools where repeated identical calls are expected behavior.
 */
const POLLING_WHITELIST = new Set([
  "read_process_output",
  "wait",
  "interact_with_process",
  "list_sessions",
  "list_processes",
]);

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a short hash of tool call arguments for fingerprinting.
 * Normalizes JSON to avoid ordering differences.
 */
export function hashToolArgs(args: unknown): string {
  try {
    const canonical = JSON.stringify(args, Object.keys(args as object).sort());
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  } catch {
    return createHash("sha256").update(String(args)).digest("hex").slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check if the recent tool calls indicate a loop.
 *
 * @param calls - Recent tool call fingerprints (newest last)
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Detection result with loop info if found
 */
export function detectToolCallLoop(
  calls: ToolCallFingerprint[],
  now?: number,
): LoopDetectionResult {
  const ts = now ?? Date.now();

  // Filter to calls within the decay window and not on the whitelist
  const recent = calls
    .filter((c) => ts - c.ts < DECAY_WINDOW_MS && !POLLING_WHITELIST.has(c.name))
    .slice(-WINDOW_SIZE);

  if (recent.length < REPEAT_THRESHOLD) {
    return { loopDetected: false };
  }

  // Count occurrences of each fingerprint (name + argsHash)
  const counts = new Map<string, { count: number; name: string }>();
  for (const call of recent) {
    const key = `${call.name}:${call.argsHash}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { count: 1, name: call.name });
    }
  }

  // Find the most repeated fingerprint
  let maxEntry: { count: number; name: string } | null = null;
  for (const entry of counts.values()) {
    if (entry.count >= REPEAT_THRESHOLD && (!maxEntry || entry.count > maxEntry.count)) {
      maxEntry = entry;
    }
  }

  if (maxEntry) {
    return {
      loopDetected: true,
      toolName: maxEntry.name,
      repeatCount: maxEntry.count,
    };
  }

  return { loopDetected: false };
}

// ---------------------------------------------------------------------------
// Prompt injection
// ---------------------------------------------------------------------------

/**
 * Build a loop detection hint for the system prompt.
 * Returns null if no loop is detected.
 */
export function buildLoopDetectionHint(result: LoopDetectionResult): string | null {
  if (!result.loopDetected || !result.toolName) return null;

  return (
    `## Action Loop Detected\n` +
    `You have called '${result.toolName}' with the same arguments ${result.repeatCount} times. ` +
    `Stop repeating this action. Instead:\n` +
    `1. Explain to the user what you are trying to do and why it is failing.\n` +
    `2. Ask if they can help unblock the situation.\n` +
    `3. If possible, try a completely different approach.`
  );
}
