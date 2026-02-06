/**
 * Tool Failure Tracker — RSC v2.1 tool substitution engine.
 *
 * Tracks per-tool consecutive failure counts in session metadata.
 * When a tool has failed 2+ times consecutively, injects avoidance
 * guidance into the system prompt to encourage alternative approaches.
 *
 * Also manages failure signatures (v2.1 item 4) for session-scoped
 * failure memory — recognizing recurring error patterns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-tool failure record stored in session metadata. */
export type ToolFailureRecord = {
  toolName: string;
  consecutiveFailures: number;
  lastError: string;
  lastTs: number;
};

export type ToolFailureState = {
  records: ToolFailureRecord[];
};

/** Session-scoped failure signature for recurring error patterns. */
export type FailureSignature = {
  toolName: string;
  /** First 120 chars of the error string. */
  errorPattern: string;
  /** Number of times this exact pattern has occurred. */
  count: number;
  lastTs: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum tracked tools in failure state. */
const MAX_TOOL_RECORDS = 20;

/** Minimum consecutive failures to trigger avoidance guidance. */
const AVOIDANCE_THRESHOLD = 2;

/** Maximum failure signatures per session. */
const MAX_FAILURE_SIGNATURES = 10;

/** Maximum error pattern length stored. */
const MAX_ERROR_PATTERN_LENGTH = 120;

/** Minimum occurrences of a failure signature to include in hints. */
const FAILURE_MEMORY_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Error pattern normalization (RSC v2.1 patch — reviewer feedback)
// ---------------------------------------------------------------------------

/**
 * Normalize an error string so that variable components (file paths,
 * timestamps, UUIDs, memory addresses) are replaced with placeholders.
 * This allows failure signatures to match across invocations even when
 * the raw error text contains unique per-invocation values.
 */
function normalizeErrorPattern(raw: string): string {
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<ts>")
    .replace(/\d{10,13}/g, "<ts>")
    .replace(/\/[\w.\-/]+/g, "<path>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_PATTERN_LENGTH);
}

// ---------------------------------------------------------------------------
// State resolution
// ---------------------------------------------------------------------------

export function resolveToolFailureState(raw: { toolFailures?: unknown }): ToolFailureState {
  const records = Array.isArray(raw.toolFailures)
    ? (raw.toolFailures as ToolFailureRecord[])
        .filter(
          (r): r is ToolFailureRecord =>
            typeof r.toolName === "string" &&
            typeof r.consecutiveFailures === "number" &&
            typeof r.lastTs === "number",
        )
        .slice(-MAX_TOOL_RECORDS)
    : [];
  return { records };
}

export function resolveFailureSignatures(raw: { failureSignatures?: unknown }): FailureSignature[] {
  if (!Array.isArray(raw.failureSignatures)) return [];
  return (raw.failureSignatures as FailureSignature[])
    .filter(
      (s): s is FailureSignature =>
        typeof s.toolName === "string" &&
        typeof s.errorPattern === "string" &&
        typeof s.count === "number" &&
        typeof s.lastTs === "number",
    )
    .slice(-MAX_FAILURE_SIGNATURES);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record the outcome of a tool call (success or failure).
 * On success: resets consecutive failure count for the tool.
 * On failure: increments consecutive failure count and stores error hint.
 */
export function recordToolOutcome(
  state: ToolFailureState,
  toolName: string,
  succeeded: boolean,
  errorHint?: string,
  now?: number,
): ToolFailureState {
  const ts = now ?? Date.now();
  const records = [...state.records];
  const idx = records.findIndex((r) => r.toolName === toolName);

  if (succeeded) {
    // Reset consecutive failures on success
    if (idx >= 0) {
      records[idx] = { ...records[idx]!, consecutiveFailures: 0, lastTs: ts };
    }
    return { records };
  }

  // Failure case
  const normalizedError = normalizeErrorPattern(errorHint ?? "");
  if (idx >= 0) {
    records[idx] = {
      ...records[idx]!,
      consecutiveFailures: records[idx]!.consecutiveFailures + 1,
      lastError: normalizedError,
      lastTs: ts,
    };
  } else {
    records.push({
      toolName,
      consecutiveFailures: 1,
      lastError: normalizedError,
      lastTs: ts,
    });
  }

  return { records: records.slice(-MAX_TOOL_RECORDS) };
}

/**
 * Record a failure signature for session-scoped failure memory.
 * Increments count if exact match on toolName + errorPattern, else appends.
 */
export function recordFailureSignature(
  signatures: FailureSignature[],
  toolName: string,
  errorString: string,
  now?: number,
): FailureSignature[] {
  const ts = now ?? Date.now();
  const pattern = normalizeErrorPattern(errorString);
  const result = [...signatures];
  const idx = result.findIndex((s) => s.toolName === toolName && s.errorPattern === pattern);

  if (idx >= 0) {
    result[idx] = { ...result[idx]!, count: result[idx]!.count + 1, lastTs: ts };
  } else {
    result.push({ toolName, errorPattern: pattern, count: 1, lastTs: ts });
  }

  return result.slice(-MAX_FAILURE_SIGNATURES);
}

// ---------------------------------------------------------------------------
// Prompt injection builders
// ---------------------------------------------------------------------------

/**
 * Build tool avoidance injection text for the system prompt.
 * Returns null if no tool has reached the avoidance threshold.
 */
export function buildToolAvoidanceInjection(state: ToolFailureState): string | null {
  const failing = state.records.filter((r) => r.consecutiveFailures >= AVOIDANCE_THRESHOLD);
  if (failing.length === 0) return null;

  const lines = ["## Tool Reliability"];
  for (const record of failing) {
    const hint = record.lastError ? ` (last error: ${record.lastError})` : "";
    lines.push(
      `- Tool '${record.toolName}' has failed ${record.consecutiveFailures} times consecutively${hint}. Consider an alternative approach before retrying. If no alternative exists, explain the blocker to the user.`,
    );
  }
  return lines.join("\n");
}

/**
 * Build failure memory hints for the system prompt.
 * Returns null if no recurring failure patterns exist.
 */
export function buildFailureMemoryHint(signatures: FailureSignature[]): string | null {
  const recurring = signatures.filter((s) => s.count >= FAILURE_MEMORY_THRESHOLD);
  if (recurring.length === 0) return null;

  const lines: string[] = [];
  for (const sig of recurring) {
    lines.push(
      `- Previous attempts with '${sig.toolName}' resulted in: '${sig.errorPattern}' (${sig.count} occurrences). Consider a different approach.`,
    );
  }
  return lines.join("\n");
}
