import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry, SessionSystemPromptReport } from "../config/sessions/types.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  buildContextInspectorData,
  type ContextInspectorData,
  type ContextSourceSummary,
} from "../agents/context-inspector.js";
import { loadProjectedContextReport } from "../agents/context-report.js";
import { resolveContextWindowInfo } from "../agents/context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "../agents/defaults.js";
import { loadModelCatalog, findModelInCatalog } from "../agents/model-catalog.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { estimateTokensFromChars } from "../agents/token-estimate.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";

export type DoctorContextMode = "list" | "detail" | "json";

type DoctorContextPayload = {
  agentId: string;
  workspaceDir: string;
  sessionKey: string;
  sessionEntry?: SessionEntry;
  provider: string;
  model: string;
  contextWindowTokens?: number;
  report: SessionSystemPromptReport;
  inspector: ContextInspectorData;
};

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatTokenCount(tokens: number): string {
  return `${formatInt(tokens)} tok`;
}

function formatCharsAndTokens(chars: number, tokens?: number): string {
  const resolvedTokens = typeof tokens === "number" ? tokens : estimateTokensFromChars(chars);
  return `${formatInt(chars)} chars (~${formatInt(resolvedTokens)} tok)`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNameList(names: string[], cap: number): string {
  return names.length <= cap
    ? names.join(", ")
    : `${names.slice(0, cap).join(", ")}, … (+${names.length - cap} more)`;
}

function flattenTopContributors(sourceBreakdown: ContextSourceSummary[]) {
  return sourceBreakdown
    .flatMap((group) =>
      group.contributors.map((contributor) => ({
        source: group.source,
        ...contributor,
      })),
    )
    .toSorted((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

function formatContextDoctorText(
  payload: DoctorContextPayload,
  mode: Exclude<DoctorContextMode, "json">,
): string {
  const { report, inspector } = payload;
  const topContributors = flattenTopContributors(inspector.sourceBreakdown);
  const contributorLines = topContributors.slice(0, mode === "detail" ? 12 : 5).map((entry) => {
    const detail = entry.detail ? ` | ${entry.detail}` : "";
    return `- ${entry.name}: ${formatTokenCount(entry.tokens)} | source=${entry.source}${detail}`;
  });
  const memoryLines =
    inspector.files.memoryFiles.length > 0
      ? inspector.files.memoryFiles.map(
          (file) =>
            `- ${file.name}: ${formatTokenCount(file.tokens)}${file.truncated ? " | truncated" : ""}${file.synthetic ? " | synthetic" : ""}`,
        )
      : ["- (none)"];
  const categoryLines = inspector.categoryBreakdown.map((entry) => {
    const share = typeof entry.share === "number" ? ` (${formatPercent(entry.share)})` : "";
    return `- ${entry.label}: ${formatTokenCount(entry.tokens)}${share}`;
  });
  const rewriteLines = inspector.rewrites.flatMap((stage, index) => {
    if (index === 0 || !stage.changed) {
      return [];
    }
    const previous = inspector.rewrites[index - 1];
    if (!previous) {
      return [];
    }
    const delta =
      stage.savingsTokens > 0 ? ` | saved ${formatTokenCount(stage.savingsTokens)}` : "";
    return [
      `- ${stage.label}: ${formatInt(previous.messages)} msg / ${formatTokenCount(previous.tokens)} -> ${formatInt(stage.messages)} msg / ${formatTokenCount(stage.tokens)}${delta}`,
    ];
  });
  const suggestionLines = inspector.suggestions.map(
    (suggestion) =>
      `- ${suggestion.severity.toUpperCase()}: ${suggestion.title} (${formatTokenCount(suggestion.estimatedTokenSavings)} est.) — ${suggestion.detail}`,
  );
  const toolNamesLine = report.tools.entries.length
    ? `Tools: ${formatNameList(
        report.tools.entries.map((entry) => entry.name),
        24,
      )}`
    : "Tools: (none)";
  const skillNames = Array.from(new Set(report.skills.entries.map((entry) => entry.name)));
  const skillNamesLine =
    skillNames.length > 0 ? `Skills: ${formatNameList(skillNames, 16)}` : "Skills: (none)";
  const modelVisibleLine = report.modelView
    ? (() => {
        const pressure =
          typeof report.modelView.contextPressure === "number"
            ? ` (${formatPercent(report.modelView.contextPressure)})`
            : "";
        const freeSuffix =
          typeof inspector.freeTokens === "number"
            ? ` | free ${formatTokenCount(inspector.freeTokens)}`
            : "";
        return `Model-visible payload: ${formatTokenCount(report.modelView.projectedTotalTokens)}${pressure}${freeSuffix}`;
      })()
    : "Model-visible payload: unavailable (no active session history found)";

  const lines = [
    "Context doctor",
    `Agent: ${payload.agentId}`,
    `Workspace: ${payload.workspaceDir}`,
    `Session: ${payload.sessionKey}${payload.sessionEntry?.sessionId ? ` (${payload.sessionEntry.sessionId})` : ""}`,
    `Model: ${payload.provider}/${payload.model}${payload.contextWindowTokens ? ` | window ${formatTokenCount(payload.contextWindowTokens)}` : ""}`,
    `System prompt: ${formatCharsAndTokens(report.systemPrompt.chars, report.systemPrompt.tokens)}`,
    `Project context: ${formatCharsAndTokens(report.systemPrompt.projectContextChars, report.systemPrompt.projectContextTokens)}`,
    `Skills prompt: ${formatCharsAndTokens(report.skills.promptChars, report.skills.promptTokens)} | ${inspector.skills.loadedCount}/${inspector.skills.availableCount} visible/eligible`,
    `Tool list: ${formatCharsAndTokens(report.tools.listChars, report.tools.listTokens)}`,
    `Tool schemas: ${formatCharsAndTokens(report.tools.schemaChars, report.tools.schemaTokens)}`,
    modelVisibleLine,
    skillNamesLine,
    toolNamesLine,
    "",
    "Top contributors:",
    ...(contributorLines.length > 0 ? contributorLines : ["- (none)"]),
  ];

  if (mode === "detail") {
    lines.push(
      "",
      "Category breakdown:",
      ...(categoryLines.length > 0 ? categoryLines : ["- (none)"]),
      "",
      "Memory files:",
      ...memoryLines,
      "",
      "Suggestions:",
      ...(suggestionLines.length > 0 ? suggestionLines : ["- (none)"]),
    );
    if (rewriteLines.length > 0) {
      lines.push("", "Hidden context rewrites:", ...rewriteLines);
    }
  } else {
    lines.push(
      "",
      "Suggestions:",
      ...(suggestionLines.length > 0 ? suggestionLines.slice(0, 3) : ["- (none)"]),
    );
  }

  return lines.join("\n");
}

async function loadDoctorContextPayload(cfg: OpenClawConfig): Promise<DoctorContextPayload> {
  const agentId = resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const sessionKey = buildAgentMainSessionKey({
    agentId,
    mainKey: cfg.session?.mainKey,
  });
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const sessionStore = loadSessionStore(storePath);
  const sessionEntry = sessionStore[sessionKey];
  const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
  const catalog = await loadModelCatalog({ config: cfg });
  const catalogEntry = findModelInCatalog(catalog, modelRef.provider, modelRef.model);
  const contextInfo = resolveContextWindowInfo({
    cfg,
    provider: modelRef.provider,
    modelId: modelRef.model,
    modelContextWindow: catalogEntry?.contextWindow,
    defaultTokens:
      typeof sessionEntry?.contextTokens === "number" && sessionEntry.contextTokens > 0
        ? sessionEntry.contextTokens
        : DEFAULT_CONTEXT_TOKENS,
  });

  const report = await loadProjectedContextReport({
    cfg,
    workspaceDir,
    sessionKey,
    sessionEntry,
    provider: modelRef.provider,
    model: modelRef.model,
    contextTokens: contextInfo.tokens,
    messageProvider: sessionEntry?.channel ?? sessionEntry?.lastChannel ?? undefined,
    senderIsOwner: true,
    resolvedThinkLevel: sessionEntry?.thinkingLevel as
      | "off"
      | "minimal"
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | undefined,
    resolvedReasoningLevel: sessionEntry?.reasoningLevel as "off" | "on" | "stream" | undefined,
    resolvedElevatedLevel: sessionEntry?.elevatedLevel as "off" | "on" | "ask" | "full" | undefined,
    elevatedAllowed: true,
  });
  const inspector = buildContextInspectorData({
    report,
    session: { contextTokens: contextInfo.tokens },
    sessionEntry,
  });

  return {
    agentId,
    workspaceDir,
    sessionKey,
    sessionEntry,
    provider: modelRef.provider,
    model: modelRef.model,
    contextWindowTokens: contextInfo.tokens,
    report,
    inspector,
  };
}

export function normalizeDoctorContextMode(value: unknown): DoctorContextMode | null {
  if (value === true || value === "" || value == null) {
    return "list";
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "list" || normalized === "show") {
    return "list";
  }
  if (normalized === "detail" || normalized === "deep") {
    return "detail";
  }
  if (normalized === "json") {
    return "json";
  }
  return null;
}

export async function doctorContextCommand(
  runtime: RuntimeEnv,
  params: {
    cfg: OpenClawConfig;
    mode: DoctorContextMode;
  },
): Promise<void> {
  const payload = await loadDoctorContextPayload(params.cfg);
  if (params.mode === "json") {
    runtime.log(JSON.stringify(payload, null, 2));
    return;
  }
  runtime.log(formatContextDoctorText(payload, params.mode));
}
