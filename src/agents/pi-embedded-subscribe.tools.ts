import { getChannelPlugin, normalizeChannelId } from "../channels/plugins/index.js";
import { normalizeTargetForProvider } from "../infra/outbound/target-normalization.js";
import { truncateUtf16Safe } from "../utils.js";
import { type MessagingToolSend } from "./pi-embedded-messaging.js";
import { presentToolError, type PresentedToolError } from "./tool-error-presenter.js";
import { renderToolResultText } from "./tool-presentation.js";

const TOOL_RESULT_MAX_CHARS = 8000;
const TOOL_ERROR_MAX_CHARS = 400;

function truncateToolText(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_CHARS) {
    return text;
  }
  return `${truncateUtf16Safe(text, TOOL_RESULT_MAX_CHARS)}\n…(truncated)…`;
}

function normalizeToolErrorText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) {
    return undefined;
  }
  return firstLine.length > TOOL_ERROR_MAX_CHARS
    ? `${truncateUtf16Safe(firstLine, TOOL_ERROR_MAX_CHARS)}…`
    : firstLine;
}

export function sanitizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : null;
  if (!content) {
    return record;
  }
  const sanitized = content.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const entry = item as Record<string, unknown>;
    const type = typeof entry.type === "string" ? entry.type : undefined;
    if (type === "text" && typeof entry.text === "string") {
      return { ...entry, text: truncateToolText(entry.text) };
    }
    if (type === "image") {
      const data = typeof entry.data === "string" ? entry.data : undefined;
      const bytes = data ? data.length : undefined;
      const cleaned = { ...entry };
      delete cleaned.data;
      return { ...cleaned, bytes, omitted: true };
    }
    return entry;
  });
  return { ...record, content: sanitized };
}

function extractRawToolResultText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : null;
  if (!content) {
    return undefined;
  }
  const texts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const entry = item as Record<string, unknown>;
      if (entry.type !== "text" || typeof entry.text !== "string") {
        return undefined;
      }
      const trimmed = entry.text.trim();
      return trimmed ? trimmed : undefined;
    })
    .filter((value): value is string => Boolean(value));
  if (texts.length === 0) {
    return undefined;
  }
  return texts.join("\n");
}

export function extractToolResultStatus(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  const fromDetails =
    record.details && typeof record.details === "object"
      ? (record.details as Record<string, unknown>).status
      : undefined;
  const candidate = typeof fromDetails === "string" ? fromDetails : record.status;
  if (typeof candidate !== "string") {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed || undefined;
}

export function extractToolResultText(
  result: unknown,
  options?: { toolName?: string },
): string | undefined {
  return renderToolResultText(result, {
    toolName: options?.toolName,
  });
}

export function isToolResultError(result: unknown): boolean {
  const normalized = extractToolResultStatus(result)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === "error" || normalized === "timeout";
}

export function extractToolErrorMessage(result: unknown): string | undefined {
  const presented = presentToolError(result);
  if (presented) {
    return presented.text;
  }
  if (typeof result === "string") {
    return normalizeToolErrorText(result);
  }
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const text = extractRawToolResultText(result);
  return text ? normalizeToolErrorText(text) : undefined;
}

export function extractToolErrorPresentation(result: unknown): PresentedToolError | undefined {
  return presentToolError(result) ?? undefined;
}

export function extractMessagingToolSend(
  toolName: string,
  args: Record<string, unknown>,
): MessagingToolSend | undefined {
  // Provider docking: new provider tools must implement plugin.actions.extractToolSend.
  const action = typeof args.action === "string" ? args.action.trim() : "";
  const accountIdRaw = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
  const accountId = accountIdRaw ? accountIdRaw : undefined;
  if (toolName === "message") {
    if (action !== "send" && action !== "thread-reply") {
      return undefined;
    }
    const toRaw = typeof args.to === "string" ? args.to : undefined;
    if (!toRaw) {
      return undefined;
    }
    const providerRaw = typeof args.provider === "string" ? args.provider.trim() : "";
    const channelRaw = typeof args.channel === "string" ? args.channel.trim() : "";
    const providerHint = providerRaw || channelRaw;
    const providerId = providerHint ? normalizeChannelId(providerHint) : null;
    const provider = providerId ?? (providerHint ? providerHint.toLowerCase() : "message");
    const to = normalizeTargetForProvider(provider, toRaw);
    return to ? { tool: toolName, provider, accountId, to } : undefined;
  }
  const providerId = normalizeChannelId(toolName);
  if (!providerId) {
    return undefined;
  }
  const plugin = getChannelPlugin(providerId);
  const extracted = plugin?.actions?.extractToolSend?.({ args });
  if (!extracted?.to) {
    return undefined;
  }
  const to = normalizeTargetForProvider(providerId, extracted.to);
  return to
    ? {
        tool: toolName,
        provider: providerId,
        accountId: extracted.accountId ?? accountId,
        to,
      }
    : undefined;
}
