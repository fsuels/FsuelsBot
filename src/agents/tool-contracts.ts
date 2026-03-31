import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv from "ajv";
import type {
  ToolExecutionContext,
  ToolFailureCode,
  ToolValidationResult,
} from "./tool-contract.js";
import type { AnyAgentTool } from "./tools/common.js";
import { normalizeToolName } from "./tool-policy.js";
import { jsonResult } from "./tools/common.js";

export type ToolFailurePayload = {
  ok: false;
  success: false;
  tool: string;
  code: ToolFailureCode;
  error: string;
  message: string;
  found?: false;
  issues?: Array<{ path: string; message: string; keyword?: string }>;
} & Record<string, unknown>;

export type ToolInputValidationResult =
  | { ok: true; params?: unknown }
  | {
      ok: false;
      code?: ToolFailureCode;
      message: string;
      details?: Record<string, unknown>;
    };

type LegacyValidateInput = (params: {
  input: unknown;
  toolCallId: string;
  signal?: AbortSignal;
}) =>
  | Promise<ToolInputValidationResult | ToolValidationResult<unknown>>
  | ToolInputValidationResult
  | ToolValidationResult<unknown>;

type OpenClawValidateInput = (
  input: unknown,
  context: ToolExecutionContext,
) => Promise<ToolValidationResult> | ToolValidationResult;

export type ContractAwareTool = AnyAgentTool & {
  validateInput?: LegacyValidateInput | OpenClawValidateInput;
};

const TOOL_CONTRACTS_APPLIED = Symbol("openclaw.tool-contracts.applied");
const ajv = new Ajv.default({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
const validatorCache = new WeakMap<object, ValidateFunction>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildStrictTopLevelSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) {
    return schema;
  }
  if ("additionalProperties" in schema) {
    return schema;
  }
  const type = typeof schema.type === "string" ? schema.type : undefined;
  const hasObjectShape =
    type === "object" ||
    "properties" in schema ||
    "required" in schema ||
    Object.keys(schema).length === 0;
  if (!hasObjectShape) {
    return schema;
  }
  return {
    ...schema,
    additionalProperties: false,
  };
}

function getValidator(schema: unknown): ValidateFunction | null {
  if (!isPlainObject(schema)) {
    return null;
  }
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }
  try {
    const compiled = ajv.compile(buildStrictTopLevelSchema(schema) as object);
    validatorCache.set(schema, compiled);
    return compiled;
  } catch {
    return null;
  }
}

function formatValidationPath(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const extra =
      err.params && typeof err.params === "object" && "additionalProperty" in err.params
        ? String((err.params as { additionalProperty?: unknown }).additionalProperty)
        : undefined;
    return extra ? `/${extra}` : "/";
  }
  return err.instancePath?.trim() || "/";
}

function formatValidationMessage(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const extra =
      err.params && typeof err.params === "object" && "additionalProperty" in err.params
        ? String((err.params as { additionalProperty?: unknown }).additionalProperty)
        : undefined;
    return extra ? `unexpected property "${extra}"` : "unexpected property";
  }
  return err.message?.trim() || "invalid value";
}

function buildValidationIssues(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((err) => ({
    path: formatValidationPath(err),
    message: formatValidationMessage(err),
    keyword: err.keyword,
  }));
}

function createToolFailureResult(params: {
  toolName: string;
  code: ToolFailureCode;
  message: string;
  details?: Record<string, unknown>;
}) {
  const payload: ToolFailurePayload = {
    ok: false,
    success: false,
    tool: normalizeToolName(params.toolName || "tool"),
    code: params.code,
    error: params.message,
    message: params.message,
    ...(params.code === "not_found" ? { found: false } : {}),
    ...params.details,
  };
  return jsonResult(payload);
}

function isToolInputValidationResult(value: unknown): value is ToolInputValidationResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "ok" in value;
}

function isToolValidationResult(value: unknown): value is ToolValidationResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "result" in value;
}

function mapToolValidationErrorCode(errorCode?: number): ToolFailureCode | undefined {
  if (errorCode === 404) {
    return "not_found";
  }
  if (errorCode === 400) {
    return "invalid_input";
  }
  return undefined;
}

async function runCustomValidation(args: {
  tool: ContractAwareTool;
  input: unknown;
  toolCallId: string;
  signal?: AbortSignal;
}): Promise<ToolInputValidationResult> {
  const validateInput = args.tool.validateInput;
  if (typeof validateInput !== "function") {
    return { ok: true };
  }

  if (validateInput.length > 1) {
    const result = await (validateInput as OpenClawValidateInput)(args.input, {
      toolCallId: args.toolCallId,
      source: "direct",
      signal: args.signal,
    });
    return result.result
      ? { ok: true, params: result.params }
      : {
          ok: false,
          code: result.code ?? mapToolValidationErrorCode(result.errorCode),
          message: result.message,
          details: result.details,
        };
  }

  const result = await (validateInput as LegacyValidateInput)({
    input: args.input,
    toolCallId: args.toolCallId,
    signal: args.signal,
  });
  if (isToolInputValidationResult(result)) {
    return result;
  }
  if (isToolValidationResult(result)) {
    return result.result
      ? { ok: true, params: result.params }
      : {
          ok: false,
          code: result.code ?? mapToolValidationErrorCode(result.errorCode),
          message: result.message,
          details: result.details,
        };
  }

  return { ok: true };
}

function validateSchemaInput(tool: AnyAgentTool, input: unknown) {
  const validator = getValidator(tool.parameters);
  if (!validator) {
    return { ok: true } as const;
  }
  const valid = validator(input);
  if (valid) {
    return { ok: true } as const;
  }
  const issues = buildValidationIssues(validator.errors);
  const message =
    issues.length > 0
      ? issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")
      : "input failed schema validation";
  return {
    ok: false,
    result: createToolFailureResult({
      toolName: tool.name,
      code: "invalid_input",
      message,
      details: { issues },
    }),
  } as const;
}

export function createStructuredToolFailureResult(params: {
  toolName: string;
  code: ToolFailureCode;
  message: string;
  details?: Record<string, unknown>;
}) {
  return createToolFailureResult(params);
}

export function applyToolContracts<T extends ContractAwareTool>(tool: T): T {
  if ((tool as Record<PropertyKey, unknown>)[TOOL_CONTRACTS_APPLIED]) {
    return tool;
  }
  const execute = tool.execute;
  if (typeof execute !== "function") {
    return tool;
  }

  const wrapped = {
    ...tool,
    [TOOL_CONTRACTS_APPLIED]: true,
    execute: async (
      toolCallId: string,
      input: unknown,
      signal?: AbortSignal,
      onUpdate?: Parameters<T["execute"]>[3],
    ) => {
      const schemaValidation = validateSchemaInput(tool, input);
      if (!schemaValidation.ok) {
        return schemaValidation.result;
      }

      let nextInput = input;
      if (typeof tool.validateInput === "function") {
        const validation = await runCustomValidation({
          tool,
          input,
          toolCallId,
          signal,
        });
        if (!validation.ok) {
          return createToolFailureResult({
            toolName: tool.name,
            code: validation.code ?? "precondition_failed",
            message: validation.message,
            details: validation.details,
          });
        }
        if (validation.params !== undefined) {
          nextInput = validation.params;
        }
      }

      return await execute(toolCallId, nextInput as Parameters<T["execute"]>[1], signal, onUpdate);
    },
  };
  return wrapped as T;
}
