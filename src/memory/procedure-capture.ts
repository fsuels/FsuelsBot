/**
 * Procedure Capture — Learnability P2.
 *
 * On positive session close, extracts the tool-call sequence as a
 * procedure template and stores it in workspace memory. Future sessions
 * can retrieve the procedure via `memory_search` to guide similar tasks.
 *
 * Guardrails:
 * - Only captures from sessions with ≥3 tool calls and no drift corrections
 * - Templates are deduplicated by tool sequence fingerprint
 * - Stored in a structured format retrievable via keyword search
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolStep = {
  toolName: string;
  /** Summary of what the tool call accomplished (first 200 chars of result). */
  summary: string;
  /** Sequence position (1-indexed). */
  position: number;
};

export type ProcedureTemplate = {
  /** SHA-256 fingerprint of the tool sequence. */
  fingerprint: string;
  /** Human-readable title inferred from the session context. */
  title: string;
  /** Ordered tool steps. */
  steps: ToolStep[];
  /** When the procedure was captured. */
  capturedAt: number;
  /** Session ID it was captured from. */
  sourceSessionId: string;
  /** Number of tool calls in the original session. */
  toolCallCount: number;
};

export type ProcedureCaptureResult = {
  captured: boolean;
  procedure?: ProcedureTemplate;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum tool calls required to consider a session for procedure capture. */
const MIN_TOOL_CALLS = 3;

/** Maximum steps to include in a procedure. */
const MAX_STEPS = 20;

/** Maximum summary length per step. */
const MAX_STEP_SUMMARY = 200;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Compute a fingerprint for a tool call sequence.
 * Uses the ordered tool names to identify the pattern.
 */
export function computeSequenceFingerprint(toolNames: string[]): string {
  const hash = createHash("sha256");
  hash.update(toolNames.join("|"));
  return hash.digest("hex").slice(0, 16);
}

/**
 * Determine if a session is eligible for procedure capture.
 */
export function isEligibleForCapture(params: {
  toolMetas: Array<{ toolName: string; meta?: string }>;
  hadDriftCorrections: boolean;
  hadErrors: boolean;
}): { eligible: boolean; reason?: string } {
  if (params.toolMetas.length < MIN_TOOL_CALLS) {
    return { eligible: false, reason: `Only ${params.toolMetas.length} tool calls (min ${MIN_TOOL_CALLS})` };
  }
  if (params.hadDriftCorrections) {
    return { eligible: false, reason: "Session had drift corrections" };
  }
  if (params.hadErrors) {
    return { eligible: false, reason: "Session had errors" };
  }
  return { eligible: true };
}

/**
 * Extract a procedure template from a successful session's tool calls.
 */
export function extractProcedure(params: {
  toolMetas: Array<{ toolName: string; meta?: string }>;
  sessionId: string;
  title: string;
  now?: number;
}): ProcedureCaptureResult {
  const { toolMetas, sessionId, title } = params;
  const ts = params.now ?? Date.now();

  if (toolMetas.length < MIN_TOOL_CALLS) {
    return { captured: false, reason: "Too few tool calls" };
  }

  const steps: ToolStep[] = toolMetas.slice(0, MAX_STEPS).map((meta, idx) => ({
    toolName: meta.toolName,
    summary: (meta.meta ?? "").slice(0, MAX_STEP_SUMMARY),
    position: idx + 1,
  }));

  const toolNames = steps.map((s) => s.toolName);
  const fingerprint = computeSequenceFingerprint(toolNames);

  const procedure: ProcedureTemplate = {
    fingerprint,
    title,
    steps,
    capturedAt: ts,
    sourceSessionId: sessionId,
    toolCallCount: toolMetas.length,
  };

  return { captured: true, procedure };
}

/**
 * Format a procedure template as markdown for memory storage.
 */
export function formatProcedureForStorage(procedure: ProcedureTemplate): string {
  const lines: string[] = [
    `# Procedure: ${procedure.title}`,
    "",
    `_Captured from session ${procedure.sourceSessionId} on ${new Date(procedure.capturedAt).toISOString()}_`,
    `_Fingerprint: ${procedure.fingerprint}_`,
    "",
    "## Steps",
    "",
  ];

  for (const step of procedure.steps) {
    lines.push(`${step.position}. **${step.toolName}**${step.summary ? ` — ${step.summary}` : ""}`);
  }

  return lines.join("\n");
}

/**
 * Check if a procedure with the same fingerprint already exists.
 */
export function isDuplicateProcedure(
  fingerprint: string,
  existingFingerprints: string[],
): boolean {
  return existingFingerprints.includes(fingerprint);
}
