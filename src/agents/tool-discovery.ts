import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AnyOpenClawTool } from "./tool-contract.js";
import { createSubsystemLogger, type SubsystemLogger } from "../logging/subsystem.js";
import { normalizeToolName } from "./tool-policy.js";

const log = createSubsystemLogger("agents/tool-discovery");

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

const ALWAYS_LOAD_TOOL_NAMES = new Set([
  "tool_discovery",
  "read",
  "write",
  "edit",
  "apply_patch",
  "grep",
  "find",
  "ls",
  "exec",
  "process",
  "get_task_output",
  "sleep",
  "ask_user_question",
  "message",
  "tasks_list",
  "task_get",
  "task_plan",
  "agents_list",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "session_status",
  "verification_gate",
  "task_tracker",
  "delegate",
]);

const PROVIDER_BACKED_TOOL_NAMES = new Set([
  "browser",
  "canvas",
  "nodes",
  "cron",
  "gateway",
  "tts",
  "web_search",
  "web_fetch",
  "image",
]);

const DEFERRED_BY_DEFAULT_TOOL_NAMES = new Set([
  "browser",
  "canvas",
  "nodes",
  "cron",
  "gateway",
  "tts",
  "web_search",
  "web_fetch",
  "image",
]);

type IndexedTool = {
  tool: AnyOpenClawTool;
  name: string;
  normalizedName: string;
  nameParts: string[];
  searchSummary: string;
  description: string;
};

type ToolDiscoveryLogger = Pick<SubsystemLogger, "info">;

export type ToolDiscoveryQueryType = "select" | "exact" | "prefix" | "keyword";

export type ToolDiscoveryResolution = {
  matches: string[];
  matchTools: AnyOpenClawTool[];
  query: string;
  queryType: ToolDiscoveryQueryType;
  totalDeferredTools: number;
  pendingProviders?: string[];
  message?: string;
};

export type ToolDiscoveryActivationResult = {
  activated: string[];
  alreadyLoaded: string[];
  activeToolNames: string[];
};

export type ToolDiscoveryActivationRuntime = {
  getActiveToolNames: () => string[];
  replaceActiveToolNames: (toolNames: string[]) => ToolDiscoveryActivationResult;
  activateToolNames: (toolNames: string[]) => ToolDiscoveryActivationResult;
  getPendingProviders?: () => string[];
};

const indexedDeferredToolCache = new Map<string, IndexedTool[]>();

function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function tokenizeText(value: string): string[] {
  return splitCamelCase(value)
    .toLowerCase()
    .replace(/__/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenizeToolName(name: string): string[] {
  const parts = tokenizeText(name);
  const normalizedName = normalizeToolName(name);
  if (!parts.includes(normalizedName)) {
    parts.push(normalizedName);
  }
  return Array.from(new Set(parts));
}

function buildIndexedTool(tool: AnyOpenClawTool): IndexedTool {
  return {
    tool,
    name: tool.name,
    normalizedName: normalizeToolName(tool.name),
    nameParts: tokenizeToolName(tool.name),
    searchSummary: resolveToolSearchSummary(tool),
    description: tool.description?.trim() ?? "",
  };
}

function buildDeferredToolCacheKey(tools: AnyOpenClawTool[]): string {
  return tools
    .map((tool) => {
      const normalizedName = normalizeToolName(tool.name);
      const searchSummary = resolveToolSearchSummary(tool);
      const description = tool.description?.trim() ?? "";
      return `${normalizedName}\u0000${searchSummary}\u0000${description}`;
    })
    .toSorted((left, right) => left.localeCompare(right))
    .join("\u0001");
}

function getIndexedDeferredTools(tools: AnyOpenClawTool[]): IndexedTool[] {
  const cacheKey = buildDeferredToolCacheKey(tools);
  const cached = indexedDeferredToolCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const indexed = tools.map(buildIndexedTool);
  indexedDeferredToolCache.set(cacheKey, indexed);
  return indexed;
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizeToolName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(value);
  }
  return unique;
}

function clampMaxResults(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.trunc(value as number)));
}

function resolveQueryType(query: string, indexedTools: IndexedTool[]): ToolDiscoveryQueryType {
  const trimmed = query.trim();
  if (trimmed.toLowerCase().startsWith("select:")) {
    return "select";
  }
  const normalized = normalizeToolName(trimmed);
  if (indexedTools.some((tool) => tool.normalizedName === normalized)) {
    return "exact";
  }
  if (trimmed.includes("__") || trimmed.startsWith("mcp__") || trimmed.startsWith("provider__")) {
    return "prefix";
  }
  return "keyword";
}

function matchesRequiredTerms(tool: IndexedTool, requiredTerms: string[]): boolean {
  if (requiredTerms.length === 0) {
    return true;
  }
  const haystacks = [
    tool.nameParts.join(" "),
    tool.searchSummary.toLowerCase(),
    tool.description.toLowerCase(),
  ];
  return requiredTerms.every((term) => haystacks.some((haystack) => haystack.includes(term)));
}

function scoreToolForTerms(tool: IndexedTool, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  let score = 0;
  for (const term of terms) {
    if (tool.nameParts.includes(term)) {
      score += 12;
      continue;
    }
    if (tool.nameParts.some((part) => part.includes(term))) {
      score += 8;
      continue;
    }
    if (tool.searchSummary.toLowerCase().includes(term)) {
      score += 5;
      continue;
    }
    if (tool.description.toLowerCase().includes(term)) {
      score += 2;
    }
  }
  return score;
}

function resolveSelectedToolNames(query: string): string[] {
  return uniqueNames(
    query
      .slice("select:".length)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function resolveToolSearchSummary(
  tool: Pick<AnyOpenClawTool, "searchSummary" | "description" | "label">,
): string {
  return tool.searchSummary?.trim() || tool.description?.trim() || tool.label?.trim() || "";
}

export function applyToolDiscoveryMetadata(
  tool: AnyOpenClawTool,
  options?: { isPluginTool?: boolean },
): AnyOpenClawTool {
  const normalizedName = normalizeToolName(tool.name);
  const alwaysLoad = tool.alwaysLoad ?? ALWAYS_LOAD_TOOL_NAMES.has(normalizedName);
  const isProviderTool =
    tool.isProviderTool ??
    (options?.isPluginTool === true || PROVIDER_BACKED_TOOL_NAMES.has(normalizedName));
  const shouldDefer = alwaysLoad
    ? false
    : (tool.shouldDefer ?? (isProviderTool || DEFERRED_BY_DEFAULT_TOOL_NAMES.has(normalizedName)));
  const searchSummary = resolveToolSearchSummary(tool);

  return {
    ...tool,
    alwaysLoad,
    shouldDefer,
    isProviderTool,
    ...(searchSummary ? { searchSummary } : {}),
  };
}

export function partitionToolDiscoverySurface(tools: AnyOpenClawTool[]): {
  bootstrapTools: AnyOpenClawTool[];
  deferredTools: AnyOpenClawTool[];
} {
  const bootstrapTools: AnyOpenClawTool[] = [];
  const deferredTools: AnyOpenClawTool[] = [];

  for (const tool of tools) {
    if (tool.alwaysLoad === true || tool.shouldDefer !== true) {
      bootstrapTools.push(tool);
      continue;
    }
    deferredTools.push(tool);
  }

  return { bootstrapTools, deferredTools };
}

export function resolveDeferredToolQuery(params: {
  query: string;
  maxResults?: number;
  deferredTools: AnyOpenClawTool[];
  activeTools?: AnyOpenClawTool[];
  pendingProviders?: string[];
  logger?: ToolDiscoveryLogger;
}): ToolDiscoveryResolution {
  const logger = params.logger ?? log;
  const query = params.query.trim();
  const maxResults = clampMaxResults(params.maxResults);
  const deferredIndex = getIndexedDeferredTools(params.deferredTools);
  const activeIndex = (params.activeTools ?? []).map(buildIndexedTool);
  const allIndexedTools = [...activeIndex, ...deferredIndex];
  const queryType = resolveQueryType(query, allIndexedTools);

  const exactByName = new Map(allIndexedTools.map((tool) => [tool.normalizedName, tool]));
  let matches: IndexedTool[] = [];

  if (queryType === "select") {
    matches = resolveSelectedToolNames(query)
      .map((name) => exactByName.get(normalizeToolName(name)))
      .filter((tool): tool is IndexedTool => Boolean(tool));
  } else if (queryType === "exact") {
    const match = exactByName.get(normalizeToolName(query));
    matches = match ? [match] : [];
  } else if (queryType === "prefix") {
    const normalizedPrefix = normalizeToolName(query);
    matches = allIndexedTools
      .filter((tool) => tool.normalizedName.startsWith(normalizedPrefix))
      .slice(0, maxResults);
  } else {
    const terms = query
      .split(/\s+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const requiredTerms = terms
      .filter((term) => term.startsWith("+"))
      .map((term) => term.slice(1))
      .filter(Boolean);
    const rankingTerms = terms.filter((term) => !term.startsWith("+"));

    matches = allIndexedTools
      .filter((tool) => matchesRequiredTerms(tool, requiredTerms))
      .map((tool) => ({ tool, score: scoreToolForTerms(tool, rankingTerms) }))
      .filter(({ score }) => score > 0 || rankingTerms.length === 0 || requiredTerms.length > 0)
      .toSorted((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.tool.name.localeCompare(right.tool.name);
      })
      .slice(0, maxResults)
      .map(({ tool }) => tool);
  }

  const uniqueMatches = uniqueNames(matches.map((tool) => tool.name))
    .map((name) => exactByName.get(normalizeToolName(name)))
    .filter((tool): tool is IndexedTool => Boolean(tool));

  const hasMatches = uniqueMatches.length > 0;
  logger.info("tool discovery resolved", {
    query,
    queryType,
    matchCount: uniqueMatches.length,
    totalDeferredTools: params.deferredTools.length,
    maxResults,
    hasMatches,
  });

  const pendingProviders =
    !hasMatches && (params.pendingProviders?.length ?? 0) > 0 ? params.pendingProviders : undefined;

  return {
    matches: uniqueMatches.map((tool) => tool.name),
    matchTools: uniqueMatches.map((tool) => tool.tool),
    query,
    queryType,
    totalDeferredTools: params.deferredTools.length,
    ...(pendingProviders ? { pendingProviders } : {}),
    ...(!hasMatches
      ? {
          message: pendingProviders
            ? `No tools matched yet. Providers still connecting: ${pendingProviders.join(", ")}`
            : `No deferred tools matched "${query}".`,
        }
      : {}),
  };
}

function resolveSessionToolRegistry(session: AgentSession): Map<string, AgentTool> {
  const registry = (session as unknown as { _toolRegistry?: Map<string, AgentTool> })._toolRegistry;
  return registry instanceof Map ? registry : new Map();
}

function syncActiveToolNames(params: {
  session: AgentSession;
  requestedToolNames: string[];
  buildSystemPrompt: (toolNames: string[]) => string;
  mode: "replace" | "union";
}): ToolDiscoveryActivationResult {
  const registry = resolveSessionToolRegistry(params.session);
  const currentTools = params.session.agent.state.tools;
  const currentToolNames = currentTools.map((tool) => tool.name);
  const currentToolNameSet = new Set(currentToolNames.map(normalizeToolName));
  const requestedToolNames = uniqueNames(params.requestedToolNames)
    .map((name) => registry.get(name)?.name ?? name)
    .filter((name) => registry.has(name));

  const alreadyLoaded = requestedToolNames.filter((name) =>
    currentToolNameSet.has(normalizeToolName(name)),
  );
  const nextToolNames =
    params.mode === "replace"
      ? requestedToolNames
      : uniqueNames([...currentToolNames, ...requestedToolNames]);
  const nextTools = nextToolNames
    .map((name) => registry.get(name))
    .filter((tool): tool is AgentTool => Boolean(tool));

  currentTools.splice(0, currentTools.length, ...nextTools);

  const nextPrompt = params.buildSystemPrompt(nextToolNames);
  const mutableSession = params.session as unknown as {
    _baseSystemPrompt?: string;
  };
  mutableSession._baseSystemPrompt = nextPrompt;
  params.session.agent.setSystemPrompt(nextPrompt);

  const nextToolNameSet = new Set(currentToolNames.map(normalizeToolName));
  const activated = nextToolNames.filter((name) => !nextToolNameSet.has(normalizeToolName(name)));

  log.info("tool discovery activated", {
    mode: params.mode,
    requestedToolNames,
    activated,
    alreadyLoaded,
    activeToolCount: nextToolNames.length,
  });

  return {
    activated,
    alreadyLoaded,
    activeToolNames: nextToolNames,
  };
}

export function createToolDiscoveryActivationRuntime(params: {
  session: AgentSession;
  buildSystemPrompt: (toolNames: string[]) => string;
  getPendingProviders?: () => string[];
}): ToolDiscoveryActivationRuntime {
  return {
    getActiveToolNames: () => params.session.agent.state.tools.map((tool) => tool.name),
    replaceActiveToolNames: (toolNames) =>
      syncActiveToolNames({
        session: params.session,
        requestedToolNames: toolNames,
        buildSystemPrompt: params.buildSystemPrompt,
        mode: "replace",
      }),
    activateToolNames: (toolNames) =>
      syncActiveToolNames({
        session: params.session,
        requestedToolNames: toolNames,
        buildSystemPrompt: params.buildSystemPrompt,
        mode: "union",
      }),
    getPendingProviders: params.getPendingProviders,
  };
}

export const __testing = {
  ALWAYS_LOAD_TOOL_NAMES,
  PROVIDER_BACKED_TOOL_NAMES,
  DEFERRED_BY_DEFAULT_TOOL_NAMES,
  tokenizeToolName,
  tokenizeText,
  buildDeferredToolCacheKey,
  clearDeferredToolCache: () => indexedDeferredToolCache.clear(),
  getDeferredToolCacheSize: () => indexedDeferredToolCache.size,
  defaultLogger: log,
};
