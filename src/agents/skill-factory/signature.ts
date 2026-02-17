import crypto from "node:crypto";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeIntentText(input: string): string {
  const lowered = input.toLowerCase().replace(/\s+/g, " ").trim();
  return lowered.slice(0, 600);
}

export function summarizeIntent(input: string): string {
  const normalized = normalizeIntentText(input);
  const scrubbed = normalized
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "<email>")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "<phone>")
    .replace(/\b\d{4,}\b/g, "<num>");
  return scrubbed.slice(0, 160);
}

export function extractIntentKeywords(input: string, max = 8): string[] {
  const tokens = normalizeIntentText(input)
    .split(/[^a-z0-9_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(token);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export function computeIntentSignature(params: {
  prompt: string;
  toolNames?: string[];
  taskTitle?: string;
}): { signature: string; summary: string; intentHash: string } {
  const summary = summarizeIntent(params.prompt);
  const keywords = extractIntentKeywords(params.prompt, 10);
  const toolShape = (params.toolNames ?? [])
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .slice()
    .toSorted()
    .join(",");
  const task = (params.taskTitle ?? "").trim().toLowerCase();
  const signatureBase = `${keywords.join("|")}::${toolShape}::${task}`;
  return {
    signature: sha256(signatureBase),
    summary,
    intentHash: sha256(normalizeIntentText(params.prompt)),
  };
}

export function hashNullable(value?: string): string | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  return sha256(value.trim());
}

export function hashWorkspaceLabel(workspaceDir?: string): {
  workspaceHash: string;
  workspaceLabel?: string;
} {
  const normalized = (workspaceDir ?? "").trim();
  if (!normalized) {
    return { workspaceHash: sha256("workspace:unknown"), workspaceLabel: undefined };
  }
  return {
    workspaceHash: sha256(normalized),
    workspaceLabel: normalized.split(/[\\/]/).filter(Boolean).slice(-1)[0],
  };
}
