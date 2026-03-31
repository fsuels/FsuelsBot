import type { OpenClawConfig } from "../config/config.js";
import type { AnyOpenClawTool } from "./tool-contract.js";
import {
  extractAssistantToolCallRecords,
  extractToolResultCorrelationId,
} from "../utils/tool-call-correlation.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { createOpenClawFindTool } from "./pi-tools.find.js";
import { validateToolOutputDetails } from "./tool-contract.js";
import { normalizeToolName } from "./tool-policy.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createGrepTool } from "./tools/grep-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createTaskGetTool } from "./tools/task-get-tool.js";
import { createTaskPlanTool } from "./tools/task-plan-tool.js";
import { createTasksListTool } from "./tools/tasks-list-tool.js";

type ReplayWarningPayload = {
  status: "replay_warning";
  replayWarning: true;
  tool: string;
  message: string;
  schemaError: string;
};

type ReplayWarningMeta = {
  kind: "tool_result_schema_mismatch";
  toolName: string;
  toolCallId?: string;
  schemaError: string;
};

type ReplaySanitizationResult = {
  messages: unknown[];
  warningCount: number;
};

const replayToolCache = new Map<string, Map<string, AnyOpenClawTool>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildReplayToolCacheKey(cfg: OpenClawConfig, sessionKey?: string): string {
  const agentId = resolveSessionAgentId({ config: cfg, sessionKey });
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  return `${agentId}:${workspaceDir}`;
}

function getReplayToolsByName(
  cfg: OpenClawConfig,
  sessionKey?: string,
): Map<string, AnyOpenClawTool> {
  const cacheKey = buildReplayToolCacheKey(cfg, sessionKey);
  const cached = replayToolCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const agentId = resolveSessionAgentId({ config: cfg, sessionKey });
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const tools: AnyOpenClawTool[] = [
    createAgentsListTool({
      agentSessionKey: sessionKey,
    }) as AnyOpenClawTool,
    createCronTool({
      agentSessionKey: sessionKey,
    }) as AnyOpenClawTool,
    createGrepTool({
      cwd: workspaceDir,
    }) as AnyOpenClawTool,
    createOpenClawFindTool({
      workspaceRoot: workspaceDir,
    }) as AnyOpenClawTool,
    createSessionsListTool({
      agentSessionKey: sessionKey,
    }) as AnyOpenClawTool,
    createTaskGetTool({
      agentSessionKey: sessionKey,
      workspaceDir,
      config: cfg,
    }) as AnyOpenClawTool,
    createTaskPlanTool({
      agentSessionKey: sessionKey,
      workspaceDir,
      config: cfg,
    }) as AnyOpenClawTool,
    createTasksListTool({
      agentSessionKey: sessionKey,
      workspaceDir,
      config: cfg,
    }) as AnyOpenClawTool,
  ];

  const byName = new Map<string, AnyOpenClawTool>();
  for (const tool of tools) {
    if (!tool.outputSchema) {
      continue;
    }
    byName.set(normalizeToolName(tool.name || "tool"), tool as AnyOpenClawTool);
  }
  replayToolCache.set(cacheKey, byName);
  return byName;
}

function buildReplayWarningDetails(toolName: string, schemaError: string): ReplayWarningPayload {
  return {
    status: "replay_warning",
    replayWarning: true,
    tool: toolName,
    message:
      `Persisted ${toolName} result details no longer match the current output schema. ` +
      "Original details were omitted during transcript replay.",
    schemaError,
  };
}

function buildReplayWarningMeta(toolName: string, toolCallId: string | null, schemaError: string) {
  return {
    kind: "tool_result_schema_mismatch",
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    schemaError,
  } satisfies ReplayWarningMeta;
}

export function sanitizeTranscriptMessagesForReplay(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  messages: unknown[];
}): ReplaySanitizationResult {
  const toolsByName = getReplayToolsByName(params.cfg, params.sessionKey);
  const toolNameByCallId = new Map<string, string>();
  let warningCount = 0;

  const messages = params.messages.map((message) => {
    if (!isRecord(message)) {
      return message;
    }

    if (message.role === "assistant") {
      for (const record of extractAssistantToolCallRecords(message as never)) {
        const toolName = trimOptionalString(record.toolName);
        if (!toolName) {
          continue;
        }
        toolNameByCallId.set(record.toolCallId, normalizeToolName(toolName));
      }
      return message;
    }

    if (message.role !== "toolResult") {
      return message;
    }

    const toolCallId = extractToolResultCorrelationId(message);
    const toolName =
      trimOptionalString(message.toolName) ??
      trimOptionalString(message.tool_name) ??
      (toolCallId ? toolNameByCallId.get(toolCallId) : undefined);
    if (!toolName) {
      return message;
    }

    const normalizedToolName = normalizeToolName(toolName);
    const tool = toolsByName.get(normalizedToolName);
    if (!tool) {
      return message.toolName === normalizedToolName
        ? message
        : { ...message, toolName: normalizedToolName };
    }

    const validated = validateToolOutputDetails(tool, message.details);
    if (validated.ok) {
      return message.toolName === normalizedToolName
        ? message
        : { ...message, toolName: normalizedToolName };
    }

    warningCount += 1;
    const currentMeta = isRecord(message.__openclaw) ? message.__openclaw : undefined;
    return {
      ...message,
      toolName: normalizedToolName,
      details: buildReplayWarningDetails(normalizedToolName, validated.error),
      __openclaw: {
        ...currentMeta,
        replayWarning: buildReplayWarningMeta(normalizedToolName, toolCallId, validated.error),
      },
    };
  });

  return {
    messages,
    warningCount,
  };
}
