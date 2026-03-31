import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import type { OpenClawTool } from "../tool-contract.js";
import { detectMime } from "../../media/mime.js";
import { truncateUtf16Safe } from "../../utils.js";
import { sanitizeToolResultImages } from "../tool-images.js";

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyAgentTool = OpenClawTool<any, any>;

export type StringParamOptions = {
  required?: boolean;
  trim?: boolean;
  label?: string;
  allowEmpty?: boolean;
};

export type AliasedStringParamOptions = StringParamOptions & {
  primaryKey: string;
  aliasKeys?: string[];
  rejectConflicts?: boolean;
};

export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

export function createActionGate<T extends Record<string, boolean | undefined>>(
  actions: T | undefined,
): ActionGate<T> {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value !== false;
  };
}

export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new Error(`${label} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new Error(`${label} required`);
    }
    return undefined;
  }
  return value;
}

export function readStringOrNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {},
): string | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value) {
      return value;
    }
  }
  if (required) {
    throw new Error(`${label} required`);
  }
  return undefined;
}

export function readAliasedStringParam(
  params: Record<string, unknown>,
  options: AliasedStringParamOptions & { required: true },
): {
  value: string;
  sourceKey: string;
  usedAlias: boolean;
};
export function readAliasedStringParam(
  params: Record<string, unknown>,
  options: AliasedStringParamOptions,
): {
  value?: string;
  sourceKey?: string;
  usedAlias: boolean;
};
export function readAliasedStringParam(
  params: Record<string, unknown>,
  options: AliasedStringParamOptions,
) {
  const {
    primaryKey,
    aliasKeys = [],
    required = false,
    trim = true,
    label = primaryKey,
    allowEmpty = false,
    rejectConflicts = true,
  } = options;

  const readValue = (key: string) => {
    const raw = params[key];
    if (typeof raw !== "string") {
      return undefined;
    }
    const value = trim ? raw.trim() : raw;
    if (!value && !allowEmpty) {
      return undefined;
    }
    return value;
  };

  const primaryValue = readValue(primaryKey);
  const aliasMatches = aliasKeys
    .map((key) => {
      const value = readValue(key);
      return value ? { key, value } : null;
    })
    .filter((entry): entry is { key: string; value: string } => Boolean(entry));

  if (rejectConflicts && primaryValue) {
    const conflictingAlias = aliasMatches.find((entry) => entry.value !== primaryValue);
    if (conflictingAlias) {
      throw new Error(`${label} conflicts with deprecated alias ${conflictingAlias.key}`);
    }
  }

  if (rejectConflicts && aliasMatches.length > 1) {
    const first = aliasMatches[0];
    const conflictingAlias = aliasMatches.find((entry) => entry.value !== first.value);
    if (conflictingAlias) {
      throw new Error(`${label} conflicts across deprecated aliases`);
    }
  }

  if (primaryValue) {
    return {
      value: primaryValue,
      sourceKey: primaryKey,
      usedAlias: false,
    };
  }

  const aliasMatch = aliasMatches[0];
  if (aliasMatch) {
    return {
      value: aliasMatch.value,
      sourceKey: aliasMatch.key,
      usedAlias: true,
    };
  }

  if (required) {
    throw new Error(`${label} required`);
  }

  return {
    value: undefined,
    sourceKey: undefined,
    usedAlias: false,
  };
}

export function assertKnownParams(
  params: Record<string, unknown>,
  allowedKeys: Iterable<string>,
  options: { label?: string } = {},
): void {
  const allowed = new Set(Array.from(allowedKeys).filter(Boolean));
  const unknown = Object.keys(params)
    .filter((key) => !allowed.has(key))
    .toSorted((left, right) => left.localeCompare(right));
  if (unknown.length === 0) {
    return;
  }
  const label = options.label?.trim() || "parameters";
  const noun = unknown.length === 1 ? "parameter" : "parameters";
  throw new Error(`Unknown ${label} ${noun}: ${unknown.join(", ")}`);
}

export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string; integer?: boolean } = {},
): number | undefined {
  const { required = false, label = key, integer = false } = options;
  const raw = params[key];
  let value: number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }
  if (value === undefined) {
    if (required) {
      throw new Error(`${label} required`);
    }
    return undefined;
  }
  return integer ? Math.trunc(value) : value;
}

export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string[];
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string[] | undefined;
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (required) {
        throw new Error(`${label} required`);
      }
      return undefined;
    }
    return values;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) {
      if (required) {
        throw new Error(`${label} required`);
      }
      return undefined;
    }
    return [value];
  }
  if (required) {
    throw new Error(`${label} required`);
  }
  return undefined;
}

export type ReactionParams = {
  emoji: string;
  remove: boolean;
  isEmpty: boolean;
};

export function readReactionParams(
  params: Record<string, unknown>,
  options: {
    emojiKey?: string;
    removeKey?: string;
    removeErrorMessage: string;
  },
): ReactionParams {
  const emojiKey = options.emojiKey ?? "emoji";
  const removeKey = options.removeKey ?? "remove";
  const remove = typeof params[removeKey] === "boolean" ? params[removeKey] : false;
  const emoji = readStringParam(params, emojiKey, {
    required: true,
    allowEmpty: true,
  });
  if (remove && !emoji) {
    throw new Error(options.removeErrorMessage);
  }
  return { emoji, remove, isEmpty: !emoji };
}

export function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

const DEFAULT_MODEL_RESULT_MAX_CHARS = 8_000;
const FALLBACK_TRUNCATED_RESULT = {
  truncated: true,
  message: "Tool result truncated. Narrow the query and try again.",
} as const;

function safeJsonStringify(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

export function formatStructuredResultForModel<T>(
  payload: T,
  options?: {
    emptyMessage?: string;
    isEmpty?: (payload: T) => boolean;
    maxChars?: number;
    summarize?: (payload: T) => unknown;
  },
): string {
  if (options?.isEmpty?.(payload)) {
    return options.emptyMessage?.trim() || "No results.";
  }

  const maxChars = Math.max(64, Math.floor(options?.maxChars ?? DEFAULT_MODEL_RESULT_MAX_CHARS));
  const direct = safeJsonStringify(payload);
  if (direct && direct.length <= maxChars) {
    return direct;
  }

  const summaryPayload = options?.summarize?.(payload) ?? FALLBACK_TRUNCATED_RESULT;
  const summary = safeJsonStringify(summaryPayload);
  if (summary && summary.length <= maxChars) {
    return summary;
  }

  const fallback = safeJsonStringify(FALLBACK_TRUNCATED_RESULT);
  if (fallback && fallback.length <= maxChars) {
    return fallback;
  }

  return truncateUtf16Safe(fallback ?? FALLBACK_TRUNCATED_RESULT.message, maxChars);
}

export async function imageResult(params: {
  label: string;
  path: string;
  base64: string;
  mimeType: string;
  extraText?: string;
  details?: Record<string, unknown>;
}): Promise<AgentToolResult<unknown>> {
  const content: AgentToolResult<unknown>["content"] = [
    {
      type: "text",
      text: params.extraText ?? `MEDIA:${params.path}`,
    },
    {
      type: "image",
      data: params.base64,
      mimeType: params.mimeType,
    },
  ];
  const result: AgentToolResult<unknown> = {
    content,
    details: { path: params.path, ...params.details },
  };
  return await sanitizeToolResultImages(result, params.label);
}

export async function imageResultFromFile(params: {
  label: string;
  path: string;
  extraText?: string;
  details?: Record<string, unknown>;
}): Promise<AgentToolResult<unknown>> {
  const buf = await fs.readFile(params.path);
  const mimeType = (await detectMime({ buffer: buf.slice(0, 256) })) ?? "image/png";
  return await imageResult({
    label: params.label,
    path: params.path,
    base64: buf.toString("base64"),
    mimeType,
    extraText: params.extraText,
    details: params.details,
  });
}
