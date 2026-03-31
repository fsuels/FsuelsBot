import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ErrorObject, ValidateFunction } from "ajv";
import AjvPkg from "ajv";
import { truncateUtf16Safe } from "../utils.js";

const Ajv = AjvPkg as unknown as new (opts?: object) => import("ajv").default;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});

const DEFAULT_TOOL_NAME = "structured_output";
const MAX_STATUS_CHARS = 240;
const MAX_ERROR_CHARS = 1_200;
const GOOGLE_STRUCTURED_OUTPUT_PROVIDERS = new Set(["google-antigravity", "google-gemini-cli"]);
const GOOGLE_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "patternProperties",
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "examples",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

export type StructuredOutputIssue = {
  path: string;
  message: string;
  keyword?: string;
};

export type StructuredOutputSchemaError = {
  code: "invalid_schema";
  message: string;
  issues: StructuredOutputIssue[];
};

type PreparedStructuredOutputSchema =
  | {
      ok: true;
      canonicalKey?: string;
      validate: ValidateFunction;
    }
  | {
      ok: false;
      canonicalKey?: string;
      error: StructuredOutputSchemaError;
    };

export type StructuredOutputCaptureResult =
  | { ok: true; statusText?: string }
  | { ok: false; statusText?: string };

export type StructuredOutputToolOptions = {
  jsonSchema: Record<string, unknown>;
  provider?: string;
  name?: string;
  onCapture?: (payload: unknown) => StructuredOutputCaptureResult;
};

export type StructuredOutputToolResult =
  | {
      tool: ToolDefinition;
    }
  | {
      error: StructuredOutputSchemaError;
    };

let identityCache = new WeakMap<object, PreparedStructuredOutputSchema>();
const canonicalCache = new Map<string, PreparedStructuredOutputSchema>();

let compileCount = 0;

function truncateStatus(text: string, maxChars: number) {
  return truncateUtf16Safe(text.trim(), maxChars);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssuePath(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const extra =
      err.params && typeof err.params === "object" && "additionalProperty" in err.params
        ? String((err.params as { additionalProperty?: unknown }).additionalProperty)
        : undefined;
    if (extra) {
      return err.instancePath ? `${err.instancePath}/${extra}` : `/${extra}`;
    }
  }
  return err.instancePath || "root";
}

function formatIssueMessage(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const extra =
      err.params && typeof err.params === "object" && "additionalProperty" in err.params
        ? String((err.params as { additionalProperty?: unknown }).additionalProperty)
        : undefined;
    return extra ? `unexpected property "${extra}"` : "unexpected property";
  }
  return err.message?.trim() || "invalid value";
}

function buildIssues(errors: ErrorObject[] | null | undefined): StructuredOutputIssue[] {
  return (errors ?? []).map((err) => ({
    path: formatIssuePath(err),
    message: formatIssueMessage(err),
    keyword: err.keyword,
  }));
}

function formatIssues(issues: StructuredOutputIssue[]): string {
  if (issues.length === 0) {
    return "root: invalid value";
  }
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join(", ");
}

function normalizeCanonicalValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCanonicalValue(entry, seen));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    throw new Error("cyclic value");
  }
  seen.add(value);
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted((left, right) => left.localeCompare(right))) {
    const entry = record[key];
    if (entry === undefined) {
      continue;
    }
    normalized[key] = normalizeCanonicalValue(entry, seen);
  }
  seen.delete(value);
  return normalized;
}

function toCanonicalJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(normalizeCanonicalValue(value, new WeakSet<object>()));
  } catch {
    return undefined;
  }
}

function buildSchemaError(errors: ErrorObject[] | null | undefined): StructuredOutputSchemaError {
  const issues = buildIssues(errors);
  return {
    code: "invalid_schema",
    message: `Structured output schema is invalid: ${formatIssues(issues)}`,
    issues,
  };
}

export function prepareStructuredOutputSchema(
  jsonSchema: Record<string, unknown>,
): PreparedStructuredOutputSchema {
  const cachedByIdentity = identityCache.get(jsonSchema);
  if (cachedByIdentity) {
    return cachedByIdentity;
  }

  const canonicalKey = toCanonicalJson(jsonSchema);
  if (canonicalKey) {
    const cachedByCanonical = canonicalCache.get(canonicalKey);
    if (cachedByCanonical) {
      identityCache.set(jsonSchema, cachedByCanonical);
      return cachedByCanonical;
    }
  }

  let prepared: PreparedStructuredOutputSchema;
  const validSchema = ajv.validateSchema(jsonSchema);
  if (!validSchema) {
    prepared = {
      ok: false,
      canonicalKey,
      error: buildSchemaError(ajv.errors),
    };
  } else {
    compileCount += 1;
    const validate = ajv.compile(jsonSchema);
    prepared = {
      ok: true,
      canonicalKey,
      validate,
    };
  }

  identityCache.set(jsonSchema, prepared);
  if (canonicalKey) {
    canonicalCache.set(canonicalKey, prepared);
  }
  return prepared;
}

function createToolResult(payload: {
  status: "ok" | "error";
  message: string;
  structured_output?: unknown;
  issues?: StructuredOutputIssue[];
  error_code?: string;
}): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text:
          payload.status === "ok"
            ? truncateStatus(payload.message, MAX_STATUS_CHARS)
            : truncateStatus(payload.message, MAX_ERROR_CHARS),
      },
    ],
    details: payload,
  };
}

function scrubSchemaForGoogle(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubSchemaForGoogle(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (GOOGLE_UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue;
    }
    next[key] = scrubSchemaForGoogle(entry);
  }
  return next;
}

function normalizeStructuredOutputToolSchema(params: {
  provider?: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
}): Record<string, unknown> {
  const base =
    !("type" in params.schema) &&
    (typeof params.schema.properties === "object" || Array.isArray(params.schema.required))
      ? { ...params.schema, type: "object" }
      : params.schema;
  if (GOOGLE_STRUCTURED_OUTPUT_PROVIDERS.has(params.provider ?? "")) {
    const scrubbed = scrubSchemaForGoogle(base);
    return isPlainObject(scrubbed) ? scrubbed : base;
  }
  return base;
}

export function createStructuredOutputTool(
  options: StructuredOutputToolOptions,
): StructuredOutputToolResult {
  const prepared = prepareStructuredOutputSchema(options.jsonSchema);
  if (!prepared.ok) {
    return { error: prepared.error };
  }

  const toolName = options.name?.trim() || DEFAULT_TOOL_NAME;
  const description =
    "Use this tool exactly once at the end to return the final structured output. " +
    "Pass native JSON arguments that match the schema. Do not call this tool until you are ready to finish.";
  const exposedSchema = normalizeStructuredOutputToolSchema({
    provider: options.provider,
    name: toolName,
    description,
    schema: options.jsonSchema,
  });

  return {
    tool: {
      name: toolName,
      label: "Structured Output",
      description,
      parameters: exposedSchema,
      execute: async (_toolCallId, input): Promise<AgentToolResult<unknown>> => {
        const valid = prepared.validate(input);
        if (!valid) {
          const issues = buildIssues(prepared.validate.errors);
          const message = `Structured output validation failed: ${formatIssues(issues)}`;
          return createToolResult({
            status: "error",
            message,
            error_code: "structured_output_validation_failed",
            issues,
          });
        }

        const capture = options.onCapture?.(input) ?? { ok: true };
        if (!capture.ok) {
          return createToolResult({
            status: "error",
            message:
              capture.statusText?.trim() ||
              "Structured output already captured. Call this tool exactly once at the end.",
            error_code: "structured_output_rejected",
          });
        }

        return createToolResult({
          status: "ok",
          message: capture.statusText?.trim() || "Structured output captured.",
          structured_output: input,
        });
      },
    },
  };
}

export const __testing = {
  getCompileCount() {
    return compileCount;
  },
  resetCaches() {
    compileCount = 0;
    identityCache = new WeakMap<object, PreparedStructuredOutputSchema>();
    canonicalCache.clear();
  },
};
