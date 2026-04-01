/**
 * Pre-router that classifies incoming messages and routes delegate-eligible
 * tasks directly to a cheaper model (Sonnet) BEFORE the main agent (Opus)
 * ever sees them. This saves cost and latency on mechanical tasks.
 *
 * The classification is keyword-based (no LLM call needed) and intentionally
 * conservative — only clearly mechanical tasks get routed. Anything ambiguous
 * goes to the main agent as normal.
 */

import { completeSimple, type TextContent } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../../config/config.js";
import { hasAnyKeywordTrigger } from "../../../shared/text/keyword-trigger.js";
import { createAbortControllerWithParents } from "../../abort-tree.js";
import { getApiKeyForModel, requireApiKey } from "../../model-auth.js";
import { resolveModel } from "../model.js";

const DEFAULT_DELEGATE_MODEL = "anthropic/claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Pattern sets for classification. All patterns are case-insensitive. */
const TRANSLATE_KEYWORDS = ["translate", "translation"];
const TRANSLATE_PATTERNS = [
  /\bin\s+(spanish|french|german|japanese|arabic|chinese|korean|portuguese|italian|russian|hindi|dutch|swedish|turkish|polish|czech|thai|vietnamese|indonesian|malay|hebrew|greek|danish|norwegian|finnish)\b/i,
  /\bto\s+(spanish|french|german|japanese|arabic|chinese|korean|portuguese|italian|russian|hindi|dutch|swedish|turkish|polish|czech|thai|vietnamese|indonesian|malay|hebrew|greek|danish|norwegian|finnish)\b/i,
];

const SUMMARIZE_KEYWORDS = ["summarize", "summarise", "summary"];
const SUMMARIZE_PATTERNS = [
  /\btl;?dr\b/i,
  /\bgive me (a |the )?(brief|short|quick)\b/i,
  /\bin (one|two|three|a few|2|3) sentence/i,
];

const FORMAT_KEYWORDS = ["reformat"];
const FORMAT_PATTERNS = [
  /\bre-format\b/i,
  /\bconvert .+ (to|into) (json|csv|yaml|xml|markdown|html|table)\b/i,
  /\bformat (this|the|my)\b/i,
];

const BOILERPLATE_PATTERNS = [
  /\b(write|draft|create) .{0,30}(email|letter|template|memo|announcement|invitation)\b/i,
  /\bprofessional (email|letter|reply|response)\b/i,
  /\bfollow.?up email\b/i,
];

const GRAMMAR_PATTERNS = [/\b(fix|correct|check) .{0,20}(grammar|spelling|typo|punctuation)\b/i];

const FACTUAL_QA_PATTERNS = [
  /^what (is|are|was|were) .{3,}[?]?\s*$/i,
  /^explain (what|how|the concept)\b/i,
];

const LIST_PATTERNS = [
  /\blist .{0,30}(pros? and cons?|advantages? and disadvantages?)\b/i,
  /\bgive me a list of\b/i,
  /\blist (the )?top \d+\b/i,
];

/**
 * Negative patterns — if any of these match, NEVER delegate.
 * These indicate the user wants the agent's judgment, tools, or context.
 */
const NEVER_DELEGATE_KEYWORDS = [
  "analyze",
  "analyse",
  "evaluate",
  "assess",
  "review",
  "critique",
  "search",
  "browse",
  "fetch",
  "open",
  "navigate",
  "screenshot",
  "run",
  "execute",
  "install",
  "build",
  "file",
  "folder",
  "directory",
  "path",
  "code",
  "script",
  "function",
  "bug",
  "error",
  "debug",
  "remember",
  "recall",
  "session",
  "history",
  "context",
  "send",
  "telegram",
  "whatsapp",
  "discord",
  "slack",
  "schedule",
  "cron",
  "reminder",
  "alarm",
  "timer",
  "wake",
  "weather",
  "time",
  "date",
  "news",
  "image",
  "photo",
  "picture",
  "canvas",
  "draw",
  "generate",
  "plan",
  "strategy",
  "design",
  "architect",
  "decision",
];

const NEVER_DELEGATE_PATTERNS = [
  /\b(your|you) (think|opinion|perspective|take|view|thought)\b/i,
  /\blast time\b/i,
  /\b(email to)\b/i,
  /\b(help me|walk me through|guide me|teach me|explain to me how)\b/i,
];

export type DelegateRouterResult =
  | {
      delegated: true;
      text: string;
      model: string;
      latencyMs: number;
      usage?: { input?: number; output?: number };
    }
  | {
      delegated: false;
    };

function isTextContent(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function readUsageMetric(value: unknown, key: "input" | "output"): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const usage = (value as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const metric = (usage as Record<string, unknown>)[key];
  return typeof metric === "number" ? metric : undefined;
}

/**
 * Classify whether a prompt should be delegated.
 * Returns the category name if delegate-eligible, or null if not.
 */
export function classifyForDelegation(prompt: string): string | null {
  if (prompt.trimStart().startsWith("/")) {
    return null;
  }

  // First check negative patterns — if ANY match, never delegate
  if (hasAnyKeywordTrigger(prompt, NEVER_DELEGATE_KEYWORDS)) {
    return null;
  }
  for (const pattern of NEVER_DELEGATE_PATTERNS) {
    if (pattern.test(prompt)) {
      return null;
    }
  }

  // Very short messages (< 10 chars) or very long messages (> 2000 chars)
  // are unlikely to be simple delegate tasks
  if (prompt.length < 10 || prompt.length > 2000) {
    return null;
  }

  // Check positive patterns in priority order
  if (hasAnyKeywordTrigger(prompt, TRANSLATE_KEYWORDS)) {
    return "translation";
  }
  for (const pattern of TRANSLATE_PATTERNS) {
    if (pattern.test(prompt)) {
      return "translation";
    }
  }
  if (hasAnyKeywordTrigger(prompt, SUMMARIZE_KEYWORDS)) {
    return "summarization";
  }
  for (const pattern of SUMMARIZE_PATTERNS) {
    if (pattern.test(prompt)) {
      return "summarization";
    }
  }
  if (hasAnyKeywordTrigger(prompt, FORMAT_KEYWORDS)) {
    return "formatting";
  }
  for (const pattern of FORMAT_PATTERNS) {
    if (pattern.test(prompt)) {
      return "formatting";
    }
  }
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(prompt)) {
      return "boilerplate";
    }
  }
  if (hasAnyKeywordTrigger(prompt, ["proofread"])) {
    return "grammar";
  }
  for (const pattern of GRAMMAR_PATTERNS) {
    if (pattern.test(prompt)) {
      return "grammar";
    }
  }
  if (hasAnyKeywordTrigger(prompt, ["define"])) {
    return "factual_qa";
  }
  for (const pattern of FACTUAL_QA_PATTERNS) {
    if (pattern.test(prompt)) {
      return "factual_qa";
    }
  }
  for (const pattern of LIST_PATTERNS) {
    if (pattern.test(prompt)) {
      return "list_generation";
    }
  }

  return null;
}

/**
 * Attempt to route a prompt to the delegate model.
 * Returns { delegated: true, text, ... } if handled, or { delegated: false } if the
 * prompt should go to the main agent.
 */
export async function tryDelegateRoute(opts: {
  prompt: string;
  config?: OpenClawConfig;
  agentDir?: string;
  abortSignal?: AbortSignal;
}): Promise<DelegateRouterResult> {
  const { prompt, config, agentDir, abortSignal } = opts;

  // Check if delegate routing is enabled in config
  const delegateCfg = config?.agents?.defaults?.delegate;
  if (!delegateCfg) {
    return { delegated: false };
  }

  // Classify the prompt
  const category = classifyForDelegation(prompt);
  if (!category) {
    return { delegated: false };
  }

  const startTime = Date.now();
  const modelRef = delegateCfg.model ?? DEFAULT_DELEGATE_MODEL;
  const slashIdx = modelRef.indexOf("/");
  const provider = slashIdx > 0 ? modelRef.slice(0, slashIdx) : "anthropic";
  const modelId = slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef;
  const maxTokens = delegateCfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = delegateCfg.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = delegateCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const resolved = resolveModel(provider, modelId, agentDir, config);
    if (!resolved.model) {
      return { delegated: false };
    }

    const auth = await getApiKeyForModel({ model: resolved.model, cfg: config, agentDir });
    const apiKey = requireApiKey(auth, provider);

    const linkedAbort = createAbortControllerWithParents([abortSignal]);
    const timeout = setTimeout(() => linkedAbort.controller.abort(), timeoutMs);

    try {
      const systemPrompt =
        category === "translation"
          ? "You are a professional translator. Provide accurate, natural translations. Respond with just the translations, formatted clearly."
          : category === "grammar"
            ? "You are a proofreader. Fix grammar, spelling, and punctuation. Return the corrected text."
            : "You are a helpful assistant. Respond concisely and directly.";

      const res = await completeSimple(
        resolved.model,
        {
          systemPrompt,
          messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
        },
        { apiKey, maxTokens, temperature, signal: linkedAbort.signal },
      );

      const text = res.content
        .filter(isTextContent)
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (!text) {
        return { delegated: false };
      }

      return {
        delegated: true,
        text,
        model: `${provider}/${modelId}`,
        latencyMs: Date.now() - startTime,
        usage: {
          input: readUsageMetric(res, "input"),
          output: readUsageMetric(res, "output"),
        },
      };
    } finally {
      clearTimeout(timeout);
      linkedAbort.dispose();
    }
  } catch {
    // Any error → fall back to main agent
    return { delegated: false };
  }
}
