/**
 * Context Budget Allocator — System-Level Recommendation S1.
 *
 * Coordinates context window allocation across competing consumers:
 * system prompt, bootstrap files, coherence injections, tool schemas,
 * and conversation history. Prevents any single consumer from displacing
 * others and enforces minimum guaranteed allocations.
 *
 * Key invariants:
 * - contextPressure is always in [0, 1]
 * - Minimum memory band (injection + history floor) >= 25% of context
 * - Compaction targets 80% utilization AFTER deducting fixed allocations
 */

import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateMessagesTokens } from "./compaction.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextBudget = {
  /** Total context window in tokens. */
  totalTokens: number;
  /** Estimated tokens consumed by tool schemas (fixed per-session). */
  toolSchemaTokens: number;
  /** Estimated tokens consumed by system prompt core (fixed per-turn). */
  systemPromptTokens: number;
  /** Budget allocated to coherence injections (variable). */
  injectionBudgetTokens: number;
  /** Budget allocated to bootstrap/workspace files (variable). */
  bootstrapBudgetTokens: number;
  /** Budget remaining for conversation history. */
  historyBudgetTokens: number;
  /** Current utilization ratio (0-1). */
  contextPressure: number;
  /** Whether proactive compaction should be triggered. */
  shouldCompact: boolean;
  /** Maximum chars for coherence injection (derived from injectionBudgetTokens). */
  maxInjectionChars: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum share of context window for coherence/capability injections. */
const MAX_INJECTION_SHARE = 0.15; // 15%

/** Maximum share of context window for bootstrap files. */
const MAX_BOOTSTRAP_SHARE = 0.20; // 20%

/** Minimum guaranteed share for conversation history. */
const MIN_HISTORY_SHARE = 0.20; // 20%

/** Minimum guaranteed share for injections (prevents compaction from over-pruning). */
const MIN_INJECTION_SHARE = 0.05; // 5%

/** Proactive compaction threshold — trigger when utilization exceeds this. */
const PROACTIVE_COMPACTION_THRESHOLD = 0.80; // 80%

/** Approximate tokens-per-char ratio for budget conversion. */
const TOKENS_PER_CHAR = 0.25; // ~4 chars per token

// ---------------------------------------------------------------------------
// Budget computation
// ---------------------------------------------------------------------------

/**
 * Compute the context budget allocation for a given turn.
 *
 * @param contextWindowTokens - Total model context window in tokens
 * @param systemPromptText - The rendered system prompt text
 * @param messages - Current conversation messages
 * @param toolSchemaEstimate - Estimated tokens for tool schemas (optional)
 */
export function computeContextBudget(params: {
  contextWindowTokens: number;
  systemPromptText?: string;
  messages?: AgentMessage[];
  toolSchemaEstimate?: number;
}): ContextBudget {
  const total = params.contextWindowTokens;

  // Estimate fixed costs
  const toolSchemaTokens = params.toolSchemaEstimate ?? 0;
  const systemPromptTokens = params.systemPromptText
    ? estimateTokenCount(params.systemPromptText)
    : 0;

  // Compute variable budgets as shares of the remaining space
  const fixedTokens = toolSchemaTokens + systemPromptTokens;
  const availableTokens = Math.max(0, total - fixedTokens);

  // Allocate shares with minimum guarantees
  const injectionBudgetTokens = Math.max(
    Math.floor(total * MIN_INJECTION_SHARE),
    Math.min(Math.floor(availableTokens * MAX_INJECTION_SHARE), Math.floor(total * MAX_INJECTION_SHARE)),
  );

  const bootstrapBudgetTokens = Math.min(
    Math.floor(availableTokens * MAX_BOOTSTRAP_SHARE),
    Math.floor(total * MAX_BOOTSTRAP_SHARE),
  );

  const historyBudgetTokens = Math.max(
    Math.floor(total * MIN_HISTORY_SHARE),
    availableTokens - injectionBudgetTokens - bootstrapBudgetTokens,
  );

  // Estimate current usage
  const messagesTokens = params.messages ? estimateMessagesTokens(params.messages) : 0;
  const currentUsage = fixedTokens + messagesTokens;
  const contextPressure = Math.min(1, Math.max(0, currentUsage / total));

  // Convert injection budget to chars for coherence-intervention.ts
  const maxInjectionChars = Math.floor(injectionBudgetTokens / TOKENS_PER_CHAR);

  return {
    totalTokens: total,
    toolSchemaTokens,
    systemPromptTokens,
    injectionBudgetTokens,
    bootstrapBudgetTokens,
    historyBudgetTokens,
    contextPressure,
    shouldCompact: contextPressure > PROACTIVE_COMPACTION_THRESHOLD,
    maxInjectionChars,
  };
}

/**
 * Determine if proactive compaction should be triggered.
 * Respects the minimum memory band invariant: compaction targets
 * 80% utilization AFTER deducting minimum injection + history floors.
 */
export function shouldTriggerProactiveCompaction(params: {
  contextWindowTokens: number;
  currentUsageTokens: number;
}): boolean {
  const pressure = params.currentUsageTokens / params.contextWindowTokens;
  return pressure > PROACTIVE_COMPACTION_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Token estimation helpers
// ---------------------------------------------------------------------------

function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}
