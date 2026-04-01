import type { SessionEntry, SessionSystemPromptReport } from "../config/sessions/types.js";
import { estimateTokensFromChars } from "./token-estimate.js";

export type ContextSuggestionSeverity = "info" | "warn" | "critical";

export type ContextSuggestion = {
  severity: ContextSuggestionSeverity;
  title: string;
  detail: string;
  estimatedTokenSavings: number;
};

export type ContextSourceGroup =
  | "project"
  | "project-local"
  | "user"
  | "managed"
  | "plugin"
  | "built-in"
  | "extra"
  | "unknown";

export type ContextSourceContributor = {
  name: string;
  tokens: number;
  detail?: string;
};

export type ContextSourceSummary = {
  source: ContextSourceGroup;
  totalTokens: number;
  contributors: ContextSourceContributor[];
};

export type ContextInspectorData = {
  totalTokens: number;
  maxTokens?: number;
  percentUsed?: number;
  freeTokens?: number;
  categoryBreakdown: Array<{ key: string; label: string; tokens: number; share?: number }>;
  sourceBreakdown: ContextSourceSummary[];
  rewrites: Array<{
    key: string;
    label: string;
    messages: number;
    tokens: number;
    changed: boolean;
    savingsTokens: number;
    reason?: string;
  }>;
  status: {
    taskScoped: boolean;
    dmHistoryLimit?: number;
    truncatedToolResults: number;
    compactionCount: number;
    activeRewrites: string[];
  };
  files: {
    totalInjectedTokens: number;
    memoryFiles: Array<{ name: string; tokens: number; synthetic: boolean; truncated: boolean }>;
  };
  skills: {
    availableCount: number;
    loadedCount: number;
    promptTokens: number;
    sourceBreakdown: Array<{ source: string; count: number; tokens: number; names: string[] }>;
  };
  tools: {
    loadedCount: number;
    listTokens: number;
    schemaTokens: number;
    names: string[];
  };
  suggestions: ContextSuggestion[];
};

function formatTokenCount(tokens: number): string {
  return `${new Intl.NumberFormat("en-US").format(tokens)} tok`;
}

function normalizeSkillSourceGroup(
  sourceCategory?: SessionSystemPromptReport["skills"]["entries"][number]["sourceCategory"],
): ContextSourceGroup {
  switch (sourceCategory) {
    case "workspace":
      return "project";
    case "managed":
      return "managed";
    case "plugin":
      return "plugin";
    case "bundled":
      return "built-in";
    case "extra":
      return "extra";
    default:
      return "unknown";
  }
}

function pushSourceContributor(
  groups: Map<ContextSourceGroup, ContextSourceContributor[]>,
  source: ContextSourceGroup,
  contributor: ContextSourceContributor,
) {
  const existing = groups.get(source) ?? [];
  existing.push(contributor);
  groups.set(source, existing);
}

function resolveTokenCount(tokens: number | undefined, chars: number): number {
  return typeof tokens === "number" ? tokens : estimateTokensFromChars(chars);
}

export function buildContextInspectorData(params: {
  report: SessionSystemPromptReport;
  session: { contextTokens: number | null };
  sessionEntry?: SessionEntry;
}): ContextInspectorData {
  const { report } = params;
  const systemPromptTokens =
    report.modelView?.systemPromptTokens ??
    resolveTokenCount(report.systemPrompt.tokens, report.systemPrompt.chars);
  const toolSchemaTokens =
    report.modelView?.toolSchemaTokens ??
    resolveTokenCount(report.tools.schemaTokens, report.tools.schemaChars);
  const projectedHistoryTokens = report.modelView?.projectedHistoryTokens ?? 0;
  const totalTokens =
    report.modelView?.projectedTotalTokens ??
    systemPromptTokens + toolSchemaTokens + projectedHistoryTokens;
  const maxTokens =
    report.modelView?.contextWindowTokens ??
    (typeof params.session.contextTokens === "number" && params.session.contextTokens > 0
      ? params.session.contextTokens
      : undefined);
  const percentUsed = maxTokens && maxTokens > 0 ? Math.min(1, totalTokens / maxTokens) : undefined;
  const freeTokens = maxTokens ? Math.max(0, maxTokens - totalTokens) : undefined;

  const projectContextTokens = Math.min(
    systemPromptTokens,
    resolveTokenCount(
      report.systemPrompt.projectContextTokens,
      report.systemPrompt.projectContextChars,
    ),
  );
  const nonProjectPromptTokens = Math.max(
    0,
    report.systemPrompt.nonProjectContextTokens ??
      Math.max(0, systemPromptTokens - projectContextTokens),
  );
  const listTokens = resolveTokenCount(report.tools.listTokens, report.tools.listChars);
  const skillPromptTokens = resolveTokenCount(
    report.skills.promptTokens,
    report.skills.promptChars,
  );

  const fileEntries = report.injectedWorkspaceFiles.map((file) => ({
    ...file,
    tokens: resolveTokenCount(file.injectedTokens, file.injectedChars),
  }));
  const totalInjectedTokens = fileEntries.reduce((sum, file) => sum + file.tokens, 0);
  const projectContextWrapperTokens = Math.max(0, projectContextTokens - totalInjectedTokens);
  const skillEntryTokens = report.skills.entries.reduce(
    (sum, entry) => sum + resolveTokenCount(entry.blockTokens, entry.blockChars),
    0,
  );
  const corePromptTokens = Math.max(0, nonProjectPromptTokens - listTokens - skillEntryTokens);

  const categoryBreakdown = [
    { key: "project_context", label: "Project context", tokens: projectContextTokens },
    { key: "non_project_prompt", label: "Non-project prompt", tokens: nonProjectPromptTokens },
    { key: "tool_schemas", label: "Tool schemas", tokens: toolSchemaTokens },
    { key: "model_history", label: "Model-visible history", tokens: projectedHistoryTokens },
  ]
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({
      ...entry,
      share: totalTokens > 0 ? entry.tokens / totalTokens : undefined,
    }));

  const sourceGroups = new Map<ContextSourceGroup, ContextSourceContributor[]>();
  for (const file of fileEntries) {
    pushSourceContributor(sourceGroups, file.sourceGroup ?? "unknown", {
      name: file.name,
      tokens: file.tokens,
      detail: [
        file.synthetic ? "synthetic" : null,
        file.truncated ? "truncated" : null,
        file.missing ? "missing" : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }
  for (const skill of report.skills.entries) {
    pushSourceContributor(sourceGroups, normalizeSkillSourceGroup(skill.sourceCategory), {
      name: `skill:${skill.name}`,
      tokens: resolveTokenCount(skill.blockTokens, skill.blockChars),
    });
  }
  if (projectedHistoryTokens > 0) {
    pushSourceContributor(sourceGroups, "managed", {
      name: "model-visible history",
      tokens: projectedHistoryTokens,
      detail: "post-rewrite transcript",
    });
  }
  if (projectContextWrapperTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "project context wrapper",
      tokens: projectContextWrapperTokens,
    });
  }
  if (listTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "tool list guidance",
      tokens: listTokens,
    });
  }
  if (corePromptTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "core system prompt",
      tokens: corePromptTokens,
    });
  }
  if (toolSchemaTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "tool schemas",
      tokens: toolSchemaTokens,
    });
  }

  const sourceBreakdown = [...sourceGroups.entries()]
    .map(([source, contributors]) => {
      const sorted = contributors.toSorted(
        (a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name),
      );
      return {
        source,
        totalTokens: sorted.reduce((sum, contributor) => sum + contributor.tokens, 0),
        contributors: sorted,
      };
    })
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.source.localeCompare(b.source));

  const skillSourceBreakdown = [
    ...new Map(
      report.skills.entries.map((entry) => [
        entry.sourceCategory ?? "unknown",
        {
          source: entry.sourceCategory ?? "unknown",
          count: 0,
          tokens: 0,
          names: [] as string[],
        },
      ]),
    ).values(),
  ];
  for (const entry of report.skills.entries) {
    const key = entry.sourceCategory ?? "unknown";
    const bucket = skillSourceBreakdown.find((candidate) => candidate.source === key);
    if (!bucket) {
      continue;
    }
    bucket.count += 1;
    bucket.tokens += resolveTokenCount(entry.blockTokens, entry.blockChars);
    bucket.names.push(entry.name);
  }
  skillSourceBreakdown.sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source));

  const rewrites =
    report.modelView?.historyStages?.map((stage) => ({
      key: stage.key,
      label: stage.label,
      messages: stage.messages,
      tokens: stage.tokens,
      changed: stage.changed,
      savingsTokens: stage.savingsTokens,
      reason: stage.reason,
    })) ?? [];
  const activeRewrites = rewrites.filter((stage) => stage.changed).map((stage) => stage.label);

  const suggestions: ContextSuggestion[] = [];
  if (typeof percentUsed === "number" && maxTokens && maxTokens > 0 && percentUsed >= 0.8) {
    const target = Math.floor(maxTokens * 0.7);
    suggestions.push({
      severity: percentUsed >= 0.92 ? "critical" : "warn",
      title: "Context window is tight",
      detail: `Only ${formatTokenCount(freeTokens ?? 0)} remain in the model-visible payload. Compact soon or trim prompt overhead before a large turn.`,
      estimatedTokenSavings: Math.max(0, totalTokens - target),
    });
  }
  if (toolSchemaTokens >= 400) {
    suggestions.push({
      severity: toolSchemaTokens >= 1200 ? "warn" : "info",
      title: "Tool schemas are consuming context",
      detail: `${report.tools.entries.length} loaded tools contribute ${formatTokenCount(toolSchemaTokens)} before conversation history. Tighten tool policies for this agent/session if the surface is broader than needed.`,
      estimatedTokenSavings: toolSchemaTokens,
    });
  }
  if (skillPromptTokens >= 250 && report.skills.entries.length > 0) {
    suggestions.push({
      severity: skillPromptTokens >= 800 ? "warn" : "info",
      title: "Skills prompt is sizable",
      detail: `${report.skills.loadedCount ?? report.skills.entries.length} prompt-visible skills consume ${formatTokenCount(skillPromptTokens)}. Narrow skill filters if this session only needs a smaller subset.`,
      estimatedTokenSavings: skillPromptTokens,
    });
  }
  if (totalInjectedTokens >= 250 && fileEntries.length > 0) {
    const heaviest = fileEntries
      .toSorted((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((file) => file.name)
      .join(", ");
    suggestions.push({
      severity: totalInjectedTokens >= 1000 ? "warn" : "info",
      title: "Injected project context is heavy",
      detail: `Injected files contribute ${formatTokenCount(totalInjectedTokens)} (${heaviest || "no named files"}). Trim large bootstrap files or move volatile detail into task-specific context.`,
      estimatedTokenSavings: totalInjectedTokens,
    });
  }
  if ((report.modelView?.truncatedToolResults ?? 0) > 0) {
    const limitedHistoryTokens = report.modelView?.limitedHistoryTokens ?? projectedHistoryTokens;
    suggestions.push({
      severity: "warn",
      title: "Oversized tool results were truncated",
      detail: `${report.modelView?.truncatedToolResults ?? 0} tool result(s) were shortened before the model call. Prefer narrower reads/searches so important details stay intact.`,
      estimatedTokenSavings: Math.max(0, limitedHistoryTokens - projectedHistoryTokens),
    });
  }

  return {
    totalTokens,
    maxTokens,
    percentUsed,
    freeTokens,
    categoryBreakdown,
    sourceBreakdown,
    rewrites,
    status: {
      taskScoped: report.modelView?.taskScoped ?? false,
      dmHistoryLimit: report.modelView?.dmHistoryLimit,
      truncatedToolResults: report.modelView?.truncatedToolResults ?? 0,
      compactionCount: params.sessionEntry?.compactionCount ?? 0,
      activeRewrites,
    },
    files: {
      totalInjectedTokens,
      memoryFiles: fileEntries
        .filter((file) => /^memory(?:\.md)?$/i.test(file.name))
        .map((file) => ({
          name: file.name,
          tokens: file.tokens,
          synthetic: Boolean(file.synthetic),
          truncated: file.truncated,
        })),
    },
    skills: {
      availableCount: report.skills.availableCount ?? report.skills.entries.length,
      loadedCount: report.skills.loadedCount ?? report.skills.entries.length,
      promptTokens: skillPromptTokens,
      sourceBreakdown: skillSourceBreakdown,
    },
    tools: {
      loadedCount: report.tools.entries.length,
      listTokens,
      schemaTokens: toolSchemaTokens,
      names: report.tools.entries.map((entry) => entry.name),
    },
    suggestions: suggestions.toSorted(
      (a, b) => b.estimatedTokenSavings - a.estimatedTokenSavings || a.title.localeCompare(b.title),
    ),
  };
}
