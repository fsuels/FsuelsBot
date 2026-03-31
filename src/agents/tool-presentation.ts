type JsonPrimitive = string | number | boolean | null;

export type ToolPresentationOptions = {
  verbose?: boolean;
  maxArgValueChars?: number;
  maxJsonChars?: number;
  dominantStringChars?: number;
  dominantMultilineChars?: number;
  flatObjectMaxKeys?: number;
  flatObjectMaxChars?: number;
  nestedValueMaxChars?: number;
  linkifyUrls?: boolean;
  toolName?: string;
};

const DEFAULTS = {
  maxArgValueChars: 80,
  maxJsonChars: 200_000,
  dominantStringChars: 200,
  dominantMultilineChars: 50,
  flatObjectMaxKeys: 12,
  flatObjectMaxChars: 5_000,
  nestedValueMaxChars: 120,
} as const;

const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g;
const MESSAGE_LIKE_SUCCESS_TOOLS = new Set([
  "message",
  "telegram",
  "discord",
  "slack",
  "signal",
  "whatsapp",
  "imessage",
  "line",
]);

type StructuredPresentation =
  | { kind: "plain"; text: string }
  | { kind: "flat"; rows: Array<{ key: string; value: string }> }
  | {
      kind: "dominant";
      body: string;
      metadata: Array<{ key: string; value: string }>;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return JSON.stringify(value) ?? String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function truncateForDisplay(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) {
    return "…";
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function normalizeOptions(options?: ToolPresentationOptions) {
  return {
    verbose: options?.verbose === true,
    maxArgValueChars: Math.max(
      1,
      Math.floor(options?.maxArgValueChars ?? DEFAULTS.maxArgValueChars),
    ),
    maxJsonChars: Math.max(1, Math.floor(options?.maxJsonChars ?? DEFAULTS.maxJsonChars)),
    dominantStringChars: Math.max(
      1,
      Math.floor(options?.dominantStringChars ?? DEFAULTS.dominantStringChars),
    ),
    dominantMultilineChars: Math.max(
      1,
      Math.floor(options?.dominantMultilineChars ?? DEFAULTS.dominantMultilineChars),
    ),
    flatObjectMaxKeys: Math.max(
      1,
      Math.floor(options?.flatObjectMaxKeys ?? DEFAULTS.flatObjectMaxKeys),
    ),
    flatObjectMaxChars: Math.max(
      1,
      Math.floor(options?.flatObjectMaxChars ?? DEFAULTS.flatObjectMaxChars),
    ),
    nestedValueMaxChars: Math.max(
      1,
      Math.floor(options?.nestedValueMaxChars ?? DEFAULTS.nestedValueMaxChars),
    ),
    linkifyUrls: options?.linkifyUrls !== false,
    toolName: options?.toolName?.trim().toLowerCase() || undefined,
  };
}

function linkifyUrls(text: string): string {
  return text.replace(URL_RE, (url) => `<${url}>`);
}

function maybeLinkify(text: string, enabled: boolean): string {
  return enabled ? linkifyUrls(text) : text;
}

function compactNestedValue(
  value: unknown,
  options: ReturnType<typeof normalizeOptions>,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return '""';
    }
    if (normalized.length > options.nestedValueMaxChars) {
      return undefined;
    }
    return maybeLinkify(normalized, options.linkifyUrls);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > options.nestedValueMaxChars) {
      return undefined;
    }
    return maybeLinkify(serialized, options.linkifyUrls);
  } catch {
    return undefined;
  }
}

function formatRows(rows: Array<{ key: string; value: string }>): string {
  if (rows.length === 0) {
    return "";
  }
  const width = rows.reduce((max, row) => Math.max(max, row.key.length), 0);
  return rows.map((row) => `${row.key.padEnd(width)}: ${row.value}`).join("\n");
}

function isDominantString(value: string, options: ReturnType<typeof normalizeOptions>): boolean {
  return (
    value.length > options.dominantStringChars ||
    (value.includes("\n") && value.length > options.dominantMultilineChars)
  );
}

function renderStructuredPresentation(
  presentation: StructuredPresentation,
  options: ReturnType<typeof normalizeOptions>,
): string {
  if (presentation.kind === "plain") {
    return presentation.text;
  }
  if (presentation.kind === "flat") {
    return formatRows(presentation.rows);
  }
  const metadata =
    presentation.metadata.length > 0 ? `${formatRows(presentation.metadata)}\n\n` : "";
  return `${metadata}${maybeLinkify(presentation.body, options.linkifyUrls)}`;
}

function presentJsonObject(
  record: Record<string, unknown>,
  sourceText: string,
  options: ReturnType<typeof normalizeOptions>,
): string {
  const entries = Object.entries(record);
  const prettyFallback = JSON.stringify(record, null, 2);

  const dominantKeys = entries
    .filter(([, value]) => typeof value === "string" && isDominantString(value, options))
    .map(([key]) => key);

  if (dominantKeys.length === 1) {
    const dominantKey = dominantKeys[0];
    const body = typeof record[dominantKey] === "string" ? record[dominantKey] : "";
    const metadata: Array<{ key: string; value: string }> = [];
    for (const [key, value] of entries) {
      if (key === dominantKey) {
        continue;
      }
      const compact = compactNestedValue(value, options);
      if (!compact) {
        return prettyFallback;
      }
      metadata.push({ key, value: compact });
    }
    return renderStructuredPresentation(
      {
        kind: "dominant",
        body,
        metadata,
      },
      options,
    );
  }

  if (dominantKeys.length > 1) {
    return prettyFallback;
  }

  if (
    entries.length > options.flatObjectMaxKeys ||
    sourceText.length > options.flatObjectMaxChars
  ) {
    return prettyFallback;
  }

  const rows: Array<{ key: string; value: string }> = [];
  for (const [key, value] of entries) {
    const compact = compactNestedValue(value, options);
    if (!compact) {
      return prettyFallback;
    }
    rows.push({ key, value: compact });
  }

  if (rows.length === 0) {
    return prettyFallback;
  }

  return renderStructuredPresentation({ kind: "flat", rows }, options);
}

function renderJsonString(text: string, options: ReturnType<typeof normalizeOptions>): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  if (trimmed.length > options.maxJsonChars) {
    return maybeLinkify(text, options.linkifyUrls);
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return maybeLinkify(text, options.linkifyUrls);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isPlainObject(parsed)) {
      const compactSuccess = renderCompactSuccess(parsed, options);
      if (compactSuccess) {
        return compactSuccess;
      }
      return presentJsonObject(parsed, trimmed, options);
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return maybeLinkify(text, options.linkifyUrls);
  }
}

function renderBlockArray(
  content: unknown[],
  options: ReturnType<typeof normalizeOptions>,
): string | undefined {
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "text" && typeof block.text === "string") {
      parts.push(renderJsonString(block.text, options));
      continue;
    }
    if (type === "image") {
      parts.push("[Image]");
      continue;
    }
    return undefined;
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n");
}

function isSuccessLike(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "ok" ||
    normalized === "success" ||
    normalized === "sent" ||
    normalized === "queued" ||
    normalized === "accepted" ||
    normalized === "completed"
  );
}

function renderCompactSuccess(
  result: Record<string, unknown>,
  options: ReturnType<typeof normalizeOptions>,
): string | undefined {
  const toolName = options.toolName;
  if (!toolName || !MESSAGE_LIKE_SUCCESS_TOOLS.has(toolName)) {
    return undefined;
  }

  const details = isPlainObject(result.details) ? result.details : result;
  if (!isPlainObject(details)) {
    return undefined;
  }

  const success =
    isSuccessLike(details.status) ||
    isSuccessLike(details.result) ||
    isSuccessLike(details.ok) ||
    isSuccessLike(details.success);
  if (!success) {
    return undefined;
  }

  const destination =
    (typeof details.to === "string" && details.to.trim()) ||
    (typeof details.destination === "string" && details.destination.trim()) ||
    (typeof details.url === "string" && details.url.trim()) ||
    "";
  if (!destination) {
    return undefined;
  }

  const channel = typeof details.channel === "string" ? details.channel.trim() : "";
  const messageId = typeof details.messageId === "string" ? details.messageId.trim() : "";
  const target = maybeLinkify(destination, options.linkifyUrls);
  const via = channel ? ` via ${channel}` : "";
  const receipt = messageId ? ` (${messageId})` : "";
  return `Sent to ${target}${via}${receipt}`;
}

export function summarizeToolArgs(
  args: unknown,
  options?: ToolPresentationOptions,
): string | undefined {
  const normalized = normalizeOptions(options);
  if (args === undefined) {
    return undefined;
  }
  if (!isPlainObject(args)) {
    const serialized = safeJsonStringify(args);
    return normalized.verbose
      ? serialized
      : truncateForDisplay(serialized, normalized.maxArgValueChars);
  }

  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const serialized = safeJsonStringify(value);
      const rendered = normalized.verbose
        ? serialized
        : truncateForDisplay(serialized, normalized.maxArgValueChars);
      return `${key}: ${rendered}`;
    });

  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function renderToolProgressText(
  value: unknown,
  options?: ToolPresentationOptions,
): string | undefined {
  const normalized = normalizeOptions(options);
  const detailsCandidate =
    value && typeof value === "object" ? (value as { details?: unknown }).details : undefined;
  const record = isPlainObject(detailsCandidate)
    ? detailsCandidate
    : isPlainObject(value)
      ? value
      : null;
  if (!record) {
    return undefined;
  }

  const progress =
    typeof record.progress === "number"
      ? record.progress
      : typeof record.completed === "number"
        ? record.completed
        : undefined;
  const total =
    typeof record.total === "number"
      ? record.total
      : typeof record.totalSteps === "number"
        ? record.totalSteps
        : undefined;

  if (
    typeof progress === "number" &&
    Number.isFinite(progress) &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0
  ) {
    const pct = Math.round((progress / total) * 100);
    return `Processing… ${progress}/${total} (${pct}%)`;
  }

  const progressMessage =
    typeof record.progressMessage === "string"
      ? record.progressMessage.trim()
      : typeof record.label === "string"
        ? record.label.trim()
        : "";
  if (progressMessage) {
    return maybeLinkify(progressMessage, normalized.linkifyUrls);
  }

  if (typeof record.progress === "string" && record.progress.trim()) {
    return `Processing… ${maybeLinkify(record.progress.trim(), normalized.linkifyUrls)}`;
  }

  if (typeof record.status === "string" && record.status.trim().toLowerCase() === "running") {
    return "Running…";
  }

  return undefined;
}

export function renderToolResultText(
  result: unknown,
  options?: ToolPresentationOptions,
): string | undefined {
  const normalized = normalizeOptions(options);

  if (typeof result === "string") {
    return renderJsonString(result, normalized);
  }
  if (
    typeof result === "number" ||
    typeof result === "boolean" ||
    typeof result === "bigint" ||
    result === null
  ) {
    return String(result);
  }
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const compactSuccess = renderCompactSuccess(record, normalized);
  if (compactSuccess) {
    return compactSuccess;
  }

  if (Array.isArray(record.content)) {
    const renderedBlocks = renderBlockArray(record.content, normalized);
    if (renderedBlocks !== undefined) {
      return renderedBlocks;
    }
  }

  if (typeof record.text === "string") {
    return renderJsonString(record.text, normalized);
  }

  try {
    return JSON.stringify(record, null, 2);
  } catch {
    return String(result);
  }
}
