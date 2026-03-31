import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import AjvPkg, { type ErrorObject, type ValidateFunction } from "ajv";
import { truncateUtf16Safe } from "../utils.js";
import { sanitizeToolResultImages } from "./tool-images.js";

const Ajv = AjvPkg as unknown as new (opts?: object) => import("ajv").default;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: true,
});

const validatorCache = new WeakMap<object, ValidateFunction>();
const DEFAULT_MAX_RESULT_SIZE_CHARS = 200_000;
const TRUNCATION_MARKER = "\n...(truncated)...\n";

export type ToolPermissionBehavior = "allow" | "ask" | "deny";

export type ToolPermissionDecision = {
  behavior: ToolPermissionBehavior;
  message?: string;
};

export type ToolValidationResult =
  | { result: true }
  | { result: false; message: string; errorCode?: number };

export type ToolExecutionSource = "embedded" | "http" | "direct";

export type ToolPermissionResolver = (args: {
  toolName: string;
  input: unknown;
  toolCallId: string;
  message?: string;
  source: ToolExecutionSource;
  context?: unknown;
}) => Promise<"allow" | "deny">;

export type ToolExecutionContext = {
  toolCallId: string;
  source: ToolExecutionSource;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  context?: unknown;
  permissionResolver?: ToolPermissionResolver;
};

export type ToolAvailabilityContext = {
  source: ToolExecutionSource;
  context?: unknown;
};

type Awaitable<T> = T | Promise<T>;

export type OpenClawTool<TParameters extends TSchema = TSchema, TDetails = unknown> = AgentTool<
  TParameters,
  TDetails
> & {
  userFacingName?: () => string;
  prompt?: () => string | Promise<string>;
  inputSchema?: TParameters;
  outputSchema?: TSchema;
  isEnabled?: (context: ToolAvailabilityContext) => boolean;
  isReadOnly?: () => boolean;
  isConcurrencySafe?: () => boolean;
  validateInput?: (
    input: Static<TParameters>,
    context: ToolExecutionContext,
  ) => ToolValidationResult | Promise<ToolValidationResult>;
  checkPermissions?: (
    input: Static<TParameters>,
    context: ToolExecutionContext,
  ) => Promise<ToolPermissionDecision>;
  call?: (input: Static<TParameters>, context: ToolExecutionContext) => Promise<{ data: unknown }>;
  mapToolResultToModelBlock?: (
    result: AgentToolResult<TDetails>,
    toolUseId: string,
    context: ToolExecutionContext,
  ) => AgentToolResult<TDetails> | Promise<AgentToolResult<TDetails>>;
  renderQueued?: (...args: unknown[]) => unknown;
  renderRejected?: (...args: unknown[]) => unknown;
  renderError?: (...args: unknown[]) => unknown;
  maxResultSizeChars?: number;
};

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyOpenClawTool = OpenClawTool<any>;

export function defineOpenClawTool<TParameters extends TSchema, TDetails = unknown>(
  tool: OpenClawTool<TParameters, TDetails>,
): OpenClawTool<TParameters, TDetails> {
  return tool;
}

export function createStrictEmptyObjectSchema(options?: { description?: string; title?: string }) {
  return Type.Object(
    {},
    {
      additionalProperties: false,
      ...(options?.description ? { description: options.description } : {}),
      ...(options?.title ? { title: options.title } : {}),
    },
  );
}

export function isToolEnabled(tool: AnyOpenClawTool, context: ToolAvailabilityContext): boolean {
  try {
    return tool.isEnabled?.(context) ?? true;
  } catch {
    return false;
  }
}

function getToolSchema(tool: AnyOpenClawTool): object | undefined {
  const schema = tool.inputSchema ?? tool.parameters;
  return schema && typeof schema === "object" ? (schema as object) : undefined;
}

function getValidator(schema: object): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }
  const compiled = ajv.compile(schema);
  validatorCache.set(schema, compiled);
  return compiled;
}

function formatValidationErrors(
  toolName: string,
  errors: ErrorObject[] | null | undefined,
): string {
  if (!errors || errors.length === 0) {
    return `Validation failed for tool "${toolName}".`;
  }
  const details = errors
    .map((err) => {
      const path = err.instancePath ? err.instancePath.slice(1) : "";
      const target =
        path ||
        (typeof err.params.missingProperty === "string" ? err.params.missingProperty : "root");
      return `- ${target}: ${err.message ?? "invalid value"}`;
    })
    .join("\n");
  return `Validation failed for tool "${toolName}":\n${details}`;
}

export function validateToolInputSchema<TParameters extends TSchema>(
  tool: OpenClawTool<TParameters>,
  input: unknown,
) {
  const schema = getToolSchema(tool as AnyOpenClawTool);
  if (!schema) {
    return input as Static<TParameters>;
  }
  const validate = getValidator(schema);
  const cloned = structuredClone(input ?? {});
  if (validate(cloned)) {
    return cloned as Static<TParameters>;
  }
  throw new Error(formatValidationErrors(tool.name || "tool", validate.errors));
}

function stringifyToolData(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized === "string") {
      return serialized;
    }
  } catch {
    // Fall through to a deterministic fallback.
  }
  return '[{"error":"Tool returned non-serializable data"}]';
}

function truncateDeterministically(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars <= TRUNCATION_MARKER.length) {
    return truncateUtf16Safe(TRUNCATION_MARKER, maxChars);
  }
  const budget = maxChars - TRUNCATION_MARKER.length;
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${truncateUtf16Safe(text, head)}${TRUNCATION_MARKER}${text.slice(-tail)}`;
}

function normalizeToolTextBlockText(text: unknown): string {
  const normalized = stringifyToolData(text);
  return normalized.trim() === "[object Object]"
    ? '{"error":"Tool returned unserialized object text"}'
    : normalized;
}

function isImageBlock(
  block: unknown,
): block is Extract<AgentToolResult<unknown>["content"][number], { type: "image" }> {
  if (!block || typeof block !== "object") {
    return false;
  }
  const record = block as Record<string, unknown>;
  return (
    record.type === "image" &&
    typeof record.data === "string" &&
    typeof record.mimeType === "string"
  );
}

function normalizeToolContent(
  content: unknown,
  maxResultSizeChars: number,
): AgentToolResult<unknown>["content"] {
  if (!Array.isArray(content)) {
    return [
      {
        type: "text",
        text: normalizeToolTextBlockText(content),
      },
    ];
  }
  return content.map((block) => {
    if (isImageBlock(block)) {
      return block;
    }
    const record =
      block && typeof block === "object" ? (block as Record<string, unknown>) : { text: block };
    return {
      type: "text",
      text: truncateDeterministically(
        normalizeToolTextBlockText(record.type === "text" ? record.text : record),
        maxResultSizeChars,
      ),
    } as const;
  });
}

export function coerceToolDataToResult(data: unknown): AgentToolResult<unknown> {
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { content?: unknown }).content) &&
    "details" in (data as Record<string, unknown>)
  ) {
    return data as AgentToolResult<unknown>;
  }
  return {
    content: [
      {
        type: "text",
        text: stringifyToolData(data),
      },
    ],
    details: data,
  };
}

async function finalizeToolResult<TDetails>(
  tool: OpenClawTool<TSchema, TDetails>,
  result: AgentToolResult<TDetails>,
  context: ToolExecutionContext,
): Promise<AgentToolResult<TDetails>> {
  const mapped = tool.mapToolResultToModelBlock
    ? await tool.mapToolResultToModelBlock(result, context.toolCallId, context)
    : result;
  const maxResultSizeChars = Math.max(
    1,
    Math.floor(tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS),
  );
  const normalized = {
    ...mapped,
    content: normalizeToolContent(mapped.content, maxResultSizeChars),
  } satisfies AgentToolResult<TDetails>;
  return (await sanitizeToolResultImages(
    normalized as AgentToolResult<unknown>,
    tool.name || "tool",
  )) as AgentToolResult<TDetails>;
}

async function resolvePermissionDecision<TParameters extends TSchema>(
  tool: OpenClawTool<TParameters>,
  input: Static<TParameters>,
  context: ToolExecutionContext,
): Promise<void> {
  const decision = tool.checkPermissions
    ? await tool.checkPermissions(input, context)
    : ({ behavior: "allow" } satisfies ToolPermissionDecision);
  if (decision.behavior === "allow") {
    return;
  }
  if (decision.behavior === "deny") {
    throw new Error(decision.message || `Tool "${tool.name}" denied.`);
  }
  if (!context.permissionResolver) {
    throw new Error(decision.message || `Tool "${tool.name}" requires permission.`);
  }
  const resolved = await context.permissionResolver({
    toolName: tool.name || "tool",
    input,
    toolCallId: context.toolCallId,
    message: decision.message,
    source: context.source,
    context: context.context,
  });
  if (resolved !== "allow") {
    throw new Error(decision.message || `Tool "${tool.name}" permission denied.`);
  }
}

export async function executeToolWithContract<TParameters extends TSchema, TDetails>(args: {
  tool: OpenClawTool<TParameters, TDetails>;
  rawInput: unknown;
  context: ToolExecutionContext;
  transformInput?: (input: Static<TParameters>) => Awaitable<unknown>;
  invoke: (input: Static<TParameters>) => Promise<AgentToolResult<TDetails>>;
}): Promise<AgentToolResult<TDetails>> {
  const { tool, rawInput, context, invoke } = args;
  let input = validateToolInputSchema(tool, rawInput);
  if (args.transformInput) {
    input = validateToolInputSchema(tool, await args.transformInput(input));
  }
  const validation = tool.validateInput
    ? await tool.validateInput(input, context)
    : { result: true };
  if (!validation.result) {
    throw new Error(validation.message);
  }
  await resolvePermissionDecision(tool, input, context);
  const result = await invoke(input);
  return await finalizeToolResult(tool as OpenClawTool<TSchema, TDetails>, result, context);
}
