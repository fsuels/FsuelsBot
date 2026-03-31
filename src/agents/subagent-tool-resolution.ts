import type { OpenClawConfig } from "../config/config.js";
import type { SandboxToolPolicy } from "./sandbox.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { resolveAgentDir, resolveAgentWorkspaceDir } from "./agent-scope.js";
import { isToolAllowedByPolicies, resolveSubagentToolPolicy } from "./pi-tools.policy.js";
import { CORE_TOOL_IDS, normalizeToolName } from "./tool-policy.js";

type ToolSpecSource = "requiredTools" | "toolAllow" | "toolDeny";

type ToolSpecValidation = {
  matchedTools: string[];
  invalidSpecs: string[];
};

export type SubagentToolResolution = {
  availableTools: string[];
  resolvedTools: string[];
  validTools: string[];
  invalidTools: string[];
  invalidByField: Record<ToolSpecSource, string[]>;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesToolSpec(spec: string, toolName: string): boolean {
  if (spec === "*") {
    return true;
  }
  if (!spec.includes("*")) {
    return toolName === spec;
  }
  const pattern = new RegExp(`^${escapeRegex(spec).replaceAll("\\*", ".*")}$`);
  return pattern.test(toolName);
}

function validateToolSpecs(params: {
  availableTools: string[];
  specs?: string[];
  allowWildcards: boolean;
}): ToolSpecValidation {
  const matchedTools = new Set<string>();
  const invalidSpecs = new Set<string>();

  for (const rawSpec of params.specs ?? []) {
    const spec = normalizeToolName(rawSpec);
    if (!spec) {
      continue;
    }
    if (!params.allowWildcards && spec.includes("*")) {
      invalidSpecs.add(spec);
      continue;
    }
    const matches = params.availableTools.filter((toolName) => matchesToolSpec(spec, toolName));
    if (matches.length === 0) {
      invalidSpecs.add(spec);
      continue;
    }
    for (const toolName of matches) {
      matchedTools.add(toolName);
    }
  }

  return {
    matchedTools: Array.from(matchedTools).toSorted(),
    invalidSpecs: Array.from(invalidSpecs).toSorted(),
  };
}

function resolveAvailableSubagentTools(params: {
  config: OpenClawConfig;
  targetAgentId: string;
  sessionKey?: string;
}) {
  const coreTools = Array.from(
    new Set(CORE_TOOL_IDS.map((toolId) => normalizeToolName(toolId))),
  ).toSorted();
  const pluginTools = resolvePluginTools({
    context: {
      config: params.config,
      workspaceDir: resolveAgentWorkspaceDir(params.config, params.targetAgentId),
      agentDir: resolveAgentDir(params.config, params.targetAgentId),
      agentId: params.targetAgentId,
      sessionKey: params.sessionKey,
    },
    existingToolNames: new Set(coreTools),
  })
    .map((tool) => normalizeToolName(tool.name))
    .filter(Boolean);

  return Array.from(new Set([...coreTools, ...pluginTools])).toSorted();
}

export function resolveSubagentToolSurface(params: {
  config: OpenClawConfig;
  targetAgentId: string;
  sessionKey?: string;
  sessionToolPolicy?: SandboxToolPolicy;
  requiredTools?: string[];
  toolAllow?: string[];
  toolDeny?: string[];
}): SubagentToolResolution {
  const availableTools = resolveAvailableSubagentTools({
    config: params.config,
    targetAgentId: params.targetAgentId,
    sessionKey: params.sessionKey,
  });
  const requiredValidation = validateToolSpecs({
    availableTools,
    specs: params.requiredTools,
    allowWildcards: false,
  });
  const allowValidation = validateToolSpecs({
    availableTools,
    specs: params.toolAllow,
    allowWildcards: true,
  });
  const denyValidation = validateToolSpecs({
    availableTools,
    specs: params.toolDeny,
    allowWildcards: true,
  });

  const resolvedTools = availableTools.filter((toolName) =>
    isToolAllowedByPolicies(toolName, [
      resolveSubagentToolPolicy(params.config),
      params.sessionToolPolicy,
    ]),
  );

  return {
    availableTools,
    resolvedTools,
    validTools: Array.from(
      new Set([
        ...requiredValidation.matchedTools,
        ...allowValidation.matchedTools,
        ...denyValidation.matchedTools,
      ]),
    ).toSorted(),
    invalidTools: Array.from(
      new Set([
        ...requiredValidation.invalidSpecs,
        ...allowValidation.invalidSpecs,
        ...denyValidation.invalidSpecs,
      ]),
    ).toSorted(),
    invalidByField: {
      requiredTools: requiredValidation.invalidSpecs,
      toolAllow: allowValidation.invalidSpecs,
      toolDeny: denyValidation.invalidSpecs,
    },
  };
}
