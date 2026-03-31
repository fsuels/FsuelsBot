import type { TaskAwaitingInput } from "./task-output-contract.js";
import { clampWithDefault, readEnvInt } from "./bash-tools.shared.js";

const DEFAULT_STALL_CHECK_INTERVAL_MS = 5_000;
const DEFAULT_STALL_THRESHOLD_MS = 45_000;

export type ProcessStallSettings = {
  checkIntervalMs: number;
  thresholdMs: number;
};

const PROMPT_GUIDANCE =
  "Process appears to be waiting for interactive input. Send input with the process tool, or kill it and rerun with piped input or a non-interactive flag such as --yes, --force, or --non-interactive.";

const TAIL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\((?:y\/n|yes\/no)\)/i,
    reason: "interactive confirmation prompt",
  },
  {
    pattern: /\[(?:y\/n|yes\/no)\]/i,
    reason: "interactive confirmation prompt",
  },
  {
    pattern: /\bpress enter\b/i,
    reason: "interactive enter prompt",
  },
  {
    pattern: /\boverwrite\b[\s\S]{0,120}\?/i,
    reason: "interactive overwrite prompt",
  },
  {
    pattern: /\bcontinue\b[\s\S]{0,120}\?/i,
    reason: "interactive continue prompt",
  },
  {
    pattern: /\b(?:enter|input)\b[\s\S]{0,120}\?/i,
    reason: "interactive input prompt",
  },
  {
    pattern: /\b(?:password|passphrase|otp|token|username)\b[\s\S]{0,40}:$/i,
    reason: "interactive credential prompt",
  },
];

const DIRECT_QUESTION_RE =
  /\b(?:confirm|continue|overwrite|replace|proceed|retry|trust|accept|delete|install|login|save)\b[\s\S]*\?$/i;

export function resolveProcessStallSettings(): ProcessStallSettings {
  return {
    checkIntervalMs: clampWithDefault(
      readEnvInt("OPENCLAW_PROCESS_STALL_CHECK_MS"),
      DEFAULT_STALL_CHECK_INTERVAL_MS,
      1_000,
      60_000,
    ),
    thresholdMs: clampWithDefault(
      readEnvInt("OPENCLAW_PROCESS_STALL_THRESHOLD_MS"),
      DEFAULT_STALL_THRESHOLD_MS,
      5_000,
      10 * 60_000,
    ),
  };
}

function lastNonEmptyLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1);
}

export function detectAwaitingInputFromTail(
  tailText: string,
  now = Date.now(),
): TaskAwaitingInput | null {
  const trimmed = tailText.trim();
  if (!trimmed) {
    return null;
  }
  const prompt = lastNonEmptyLine(trimmed);
  if (!prompt) {
    return null;
  }

  for (const candidate of TAIL_PATTERNS) {
    if (candidate.pattern.test(prompt) || candidate.pattern.test(trimmed)) {
      return {
        detected_at: now,
        reason: candidate.reason,
        guidance: PROMPT_GUIDANCE,
        prompt,
      };
    }
  }

  if (prompt.endsWith("?") && DIRECT_QUESTION_RE.test(prompt)) {
    return {
      detected_at: now,
      reason: "interactive question prompt",
      guidance: PROMPT_GUIDANCE,
      prompt,
    };
  }

  return null;
}
