export type ToolErrorClassification = "validation" | "cancelled" | "generic";

export type PresentedToolError = {
  text: string;
  fullText: string;
  truncated: boolean;
  hiddenLineCount: number;
  classification: ToolErrorClassification;
};

const DEFAULT_MAX_LINES = 10;
const ANSI_ESCAPE_RE = new RegExp(
  String.raw`\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])`,
  "g",
);
const INTERNAL_PAIR_TAGS = [
  "tool_error",
  "error",
  "final",
  "thinking",
  "analysis",
  "assistant_response",
] as const;
const INLINE_TAG_RE = /<\/?[a-z][a-z0-9:_-]*\b[^>]*>/gi;

type ValidationIssue = {
  path: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function unwrapInternalTags(text: string): string {
  let next = text;
  for (const tag of INTERNAL_PAIR_TAGS) {
    const pairRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    next = next.replace(pairRe, "$1");
  }
  return next.replace(INLINE_TAG_RE, "");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function splitMeaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripKnownPrefixes(text: string): { prefix?: "Error:" | "Cancelled:"; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^(Error:|Cancelled:)\s*/i);
  if (!match) {
    return { body: trimmed };
  }
  const prefix = match[1]?.toLowerCase() === "cancelled:" ? "Cancelled:" : "Error:";
  return {
    prefix,
    body: trimmed.slice(match[0].length).trim(),
  };
}

function extractValidationIssues(value: unknown): ValidationIssue[] {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return [];
  }
  const issuesRaw = Array.isArray(record.issues) ? record.issues : [];
  return issuesRaw
    .map((entry) => {
      const issue = isRecord(entry) ? entry : null;
      const path = trimOptional(issue?.path) ?? "/";
      const message = trimOptional(issue?.message);
      if (!message) {
        return null;
      }
      return { path, message };
    })
    .filter((entry): entry is ValidationIssue => Boolean(entry));
}

function formatValidationIssues(issues: ValidationIssue[]): string | undefined {
  if (issues.length === 0) {
    return undefined;
  }
  const lines = ["Invalid tool input:"];
  for (const issue of issues) {
    lines.push(`- ${issue.path} ${issue.message}`);
  }
  return lines.join("\n");
}

function extractTextBlocks(value: unknown): string | undefined {
  const record = isRecord(value) ? value : null;
  const content = Array.isArray(record?.content) ? record.content : null;
  if (!content) {
    return undefined;
  }
  const text = content
    .map((entry) => {
      const block = isRecord(entry) ? entry : null;
      return block?.type === "text" ? trimOptional(block.text) : undefined;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
  return trimOptional(text);
}

function stringifyObject(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return trimOptional(serialized);
  } catch {
    return undefined;
  }
}

function extractCandidateErrorText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return trimOptional(value);
  }
  const record = isRecord(value) ? value : null;
  if (!record) {
    return undefined;
  }

  const validationText =
    formatValidationIssues(extractValidationIssues(record.details)) ??
    formatValidationIssues(extractValidationIssues(record));
  if (validationText) {
    return validationText;
  }

  const candidates = [
    record.details,
    record.error,
    record.message,
    record.reason,
    record.status,
    extractTextBlocks(record),
  ];
  for (const candidate of candidates) {
    const nested =
      typeof candidate === "string"
        ? trimOptional(candidate)
        : extractCandidateErrorText(candidate);
    if (nested) {
      return nested;
    }
  }
  return stringifyObject(record);
}

function classifyToolError(value: unknown, text: string): ToolErrorClassification {
  const lower = text.toLowerCase();
  const details = isRecord(value) && isRecord(value.details) ? value.details : undefined;
  const errorCode =
    trimOptional(details?.error_code) ??
    trimOptional((value as Record<string, unknown> | null)?.code);

  if (
    extractValidationIssues(details).length > 0 ||
    extractValidationIssues(value).length > 0 ||
    errorCode === "invalid_input" ||
    errorCode === "structured_output_validation_failed" ||
    lower.includes("schema validation") ||
    lower.includes("invalid tool input") ||
    lower.includes("unexpected property") ||
    lower.includes("field required") ||
    lower.includes("missing required") ||
    lower.includes("must have") ||
    lower.includes("must be")
  ) {
    return "validation";
  }

  if (
    lower.startsWith("cancelled:") ||
    lower.startsWith("canceled:") ||
    lower.includes("operation aborted") ||
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("interrupted")
  ) {
    return "cancelled";
  }

  return "generic";
}

function mapFriendlyText(text: string, classification: ToolErrorClassification): string {
  const { prefix, body } = stripKnownPrefixes(text);
  if (classification === "validation") {
    const normalizedBody = body.toLowerCase().startsWith("invalid tool input:")
      ? body
      : `Invalid tool input: ${body}`;
    return prefix ? `${prefix} ${normalizedBody}` : normalizedBody;
  }
  if (classification === "cancelled") {
    if (prefix === "Cancelled:") {
      return prefix + (body ? ` ${body}` : "");
    }
    return body ? `Cancelled: ${body}` : "Cancelled.";
  }
  return prefix ? `${prefix} ${body}` : body;
}

export function presentToolError(
  value: unknown,
  options?: { maxLines?: number; verbose?: boolean },
): PresentedToolError | null {
  const extracted = extractCandidateErrorText(value);
  if (!extracted) {
    return null;
  }
  const normalized = normalizeWhitespace(unwrapInternalTags(stripAnsi(extracted)));
  if (!normalized) {
    return null;
  }

  const classification = classifyToolError(value, normalized);
  const friendly = mapFriendlyText(normalized, classification);
  const lines = splitMeaningfulLines(friendly);
  if (lines.length === 0) {
    return null;
  }

  const maxLines =
    typeof options?.maxLines === "number" && Number.isFinite(options.maxLines)
      ? Math.max(1, Math.floor(options.maxLines))
      : DEFAULT_MAX_LINES;
  const verbose = options?.verbose === true;
  const hiddenLineCount = Math.max(0, lines.length - maxLines);
  const visibleLines = verbose || hiddenLineCount === 0 ? lines : lines.slice(0, maxLines);
  const text =
    !verbose && hiddenLineCount > 0
      ? `${visibleLines.join("\n")}\n+${hiddenLineCount} more lines`
      : visibleLines.join("\n");

  return {
    text,
    fullText: lines.join("\n"),
    truncated: !verbose && hiddenLineCount > 0,
    hiddenLineCount,
    classification,
  };
}
