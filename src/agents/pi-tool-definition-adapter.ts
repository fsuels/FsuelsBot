import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ClientToolDefinition } from "./pi-embedded-runner/run/params.js";
import type {
  AnyOpenClawTool,
  ToolExecutionContext,
  ToolPermissionResolver,
} from "./tool-contract.js";
import { logDebug, logError } from "../logger.js";
import { runBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import { coerceToolDataToResult, executeToolWithContract, isToolEnabled } from "./tool-contract.js";
import { normalizeToolName } from "./tool-policy.js";
import { jsonResult } from "./tools/common.js";

type ToolExecuteArgsCurrent = [
  string,
  unknown,
  AgentToolUpdateCallback<unknown> | undefined,
  unknown,
  AbortSignal | undefined,
];
type ToolExecuteArgsLegacy = [
  string,
  unknown,
  AbortSignal | undefined,
  AgentToolUpdateCallback<unknown> | undefined,
  unknown,
];
type ToolExecuteArgs = ToolDefinition["execute"] extends (...args: infer P) => unknown
  ? P
  : ToolExecuteArgsCurrent;
type ToolExecuteArgsAny = ToolExecuteArgs | ToolExecuteArgsLegacy | ToolExecuteArgsCurrent;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object" && value !== null && "aborted" in value;
}

function isLegacyToolExecuteArgs(args: ToolExecuteArgsAny): args is ToolExecuteArgsLegacy {
  const third = args[2];
  const fourth = args[3];
  return isAbortSignal(third) || typeof fourth === "function";
}

function describeToolExecutionError(err: unknown): {
  message: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const message = err.message?.trim() ? err.message : String(err);
    return { message, stack: err.stack };
  }
  return { message: String(err) };
}

function splitToolExecuteArgs(args: ToolExecuteArgsAny): {
  toolCallId: string;
  params: unknown;
  onUpdate: AgentToolUpdateCallback<unknown> | undefined;
  context: unknown;
  signal: AbortSignal | undefined;
} {
  if (isLegacyToolExecuteArgs(args)) {
    const [toolCallId, params, signal, onUpdate, context] = args;
    return {
      toolCallId,
      params,
      onUpdate,
      context,
      signal,
    };
  }
  const [toolCallId, params, onUpdate, context, signal] = args;
  return {
    toolCallId,
    params,
    onUpdate,
    context,
    signal,
  };
}

function resolvePermissionResolver(context: unknown): ToolPermissionResolver | undefined {
  if (
    context &&
    typeof context === "object" &&
    "resolveToolPermission" in context &&
    typeof (context as { resolveToolPermission?: unknown }).resolveToolPermission === "function"
  ) {
    return (context as { resolveToolPermission: ToolPermissionResolver }).resolveToolPermission;
  }
  return undefined;
}

function buildExecutionContext(params: {
  toolCallId: string;
  signal: AbortSignal | undefined;
  onUpdate: AgentToolUpdateCallback<unknown> | undefined;
  context: unknown;
}): ToolExecutionContext {
  return {
    toolCallId: params.toolCallId,
    source: "embedded",
    signal: params.signal,
    onUpdate: params.onUpdate,
    context: params.context,
    permissionResolver: resolvePermissionResolver(params.context),
  };
}

export function toToolDefinitions(tools: AnyOpenClawTool[]): ToolDefinition[] {
  return tools
    .filter((tool) => isToolEnabled(tool, { source: "embedded" }))
    .map((tool) => {
      const name = tool.name || "tool";
      const normalizedName = normalizeToolName(name);
      return {
        name,
        label: tool.label ?? name,
        description: tool.description ?? "",
        parameters: tool.inputSchema ?? tool.parameters,
        execute: async (...args: ToolExecuteArgs): Promise<AgentToolResult<unknown>> => {
          const { toolCallId, params, onUpdate, signal, context } = splitToolExecuteArgs(args);
          const executionContext = buildExecutionContext({
            toolCallId,
            signal,
            onUpdate,
            context,
          });
          try {
            return await executeToolWithContract({
              tool,
              rawInput: params,
              context: executionContext,
              invoke: async (input) => {
                if (tool.call) {
                  const output = await tool.call(input, executionContext);
                  return coerceToolDataToResult(output.data);
                }
                return await tool.execute(toolCallId, input, signal, onUpdate);
              },
            });
          } catch (err) {
            if (signal?.aborted) {
              throw err;
            }
            const name =
              err && typeof err === "object" && "name" in err
                ? String((err as { name?: unknown }).name)
                : "";
            if (name === "AbortError") {
              throw err;
            }
            const described = describeToolExecutionError(err);
            if (described.stack && described.stack !== described.message) {
              logDebug(`tools: ${normalizedName} failed stack:\n${described.stack}`);
            }
            logError(`[tools] ${normalizedName} failed: ${described.message}`);
            return jsonResult({
              status: "error",
              tool: normalizedName,
              error: described.message,
            });
          }
        },
      } satisfies ToolDefinition;
    });
}

// Convert client tools (OpenResponses hosted tools) to ToolDefinition format
// These tools are intercepted to return a "pending" result instead of executing
export function toClientToolDefinitions(
  tools: ClientToolDefinition[],
  onClientToolCall?: (toolName: string, params: Record<string, unknown>) => void,
  hookContext?: { agentId?: string; sessionKey?: string },
): ToolDefinition[] {
  return tools.map((tool) => {
    const func = tool.function;
    const clientTool = {
      name: func.name,
      label: func.name,
      description: func.description ?? "",
      // oxlint-disable-next-line typescript/no-explicit-any
      parameters: (func.parameters as any) ?? {},
      execute: async () => jsonResult({ status: "pending", tool: func.name }),
    } as AnyOpenClawTool;
    return {
      name: func.name,
      label: func.name,
      description: func.description ?? "",
      // oxlint-disable-next-line typescript/no-explicit-any
      parameters: func.parameters as any,
      execute: async (...args: ToolExecuteArgs): Promise<AgentToolResult<unknown>> => {
        const { toolCallId, params, onUpdate, signal, context } = splitToolExecuteArgs(args);
        const executionContext = buildExecutionContext({
          toolCallId,
          signal,
          onUpdate,
          context,
        });
        return await executeToolWithContract({
          tool: clientTool,
          rawInput: params,
          context: executionContext,
          transformInput: async (input) => {
            const outcome = await runBeforeToolCallHook({
              toolName: func.name,
              params: input,
              toolCallId,
              ctx: hookContext,
            });
            if (outcome.blocked) {
              throw new Error(outcome.reason);
            }
            return outcome.params;
          },
          invoke: async (input) => {
            const paramsRecord = isPlainObject(input) ? input : {};
            if (onClientToolCall) {
              onClientToolCall(func.name, paramsRecord);
            }
            return jsonResult({
              status: "pending",
              tool: func.name,
              message: "Tool execution delegated to client",
            });
          },
        });
      },
    } satisfies ToolDefinition;
  });
}
