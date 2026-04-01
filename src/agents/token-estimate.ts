import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";

const TOKENS_PER_CHAR_FALLBACK = 0.25;
const EMPTY_MESSAGE: AgentMessage = {
  role: "user",
  content: "",
  timestamp: 0,
};

let emptyMessageTokens: number | null = null;

export function fallbackEstimateTokensFromText(text: string): number {
  return Math.ceil(Math.max(0, text.length) * TOKENS_PER_CHAR_FALLBACK);
}

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) * TOKENS_PER_CHAR_FALLBACK);
}

function getEmptyMessageTokens(): number {
  if (emptyMessageTokens != null) {
    return emptyMessageTokens;
  }
  emptyMessageTokens = estimateTokens(EMPTY_MESSAGE);
  return emptyMessageTokens;
}

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  try {
    return Math.max(
      0,
      estimateTokens({
        role: "user",
        content: text,
        timestamp: 0,
      }) - getEmptyMessageTokens(),
    );
  } catch {
    return estimateTokensFromChars(text.length);
  }
}

export function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value) ?? "");
  } catch {
    return 0;
  }
}
