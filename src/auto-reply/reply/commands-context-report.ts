import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { ReplyPayload } from "../types.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { buildContextInspectorData } from "../../agents/context-inspector.js";
import {
  loadContextReport as loadSharedContextReport,
  loadProjectedContextReport as loadSharedProjectedContextReport,
} from "../../agents/context-report.js";
import { estimateTokensFromChars } from "../../agents/token-estimate.js";

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCharsAndTokens(chars: number, tokens?: number): string {
  const resolvedTokens = typeof tokens === "number" ? tokens : estimateTokensFromChars(chars);
  return `${formatInt(chars)} chars (~${formatInt(resolvedTokens)} tok)`;
}

function formatTokenCount(tokens: number): string {
  return `${formatInt(tokens)} tok`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseContextArgs(commandBodyNormalized: string): string {
  if (commandBodyNormalized === "/context") {
    return "";
  }
  if (commandBodyNormalized.startsWith("/context ")) {
    return commandBodyNormalized.slice(8).trim();
  }
  return "";
}

function formatListTop(
  entries: Array<{ name: string; chars: number; tokens?: number }>,
  cap: number,
): { lines: string[]; omitted: number } {
  const sorted = [...entries].toSorted(
    (a, b) =>
      (b.tokens ?? estimateTokensFromChars(b.chars)) -
      (a.tokens ?? estimateTokensFromChars(a.chars)),
  );
  const top = sorted.slice(0, cap);
  const omitted = Math.max(0, sorted.length - top.length);
  const lines = top.map((e) => `- ${e.name}: ${formatCharsAndTokens(e.chars, e.tokens)}`);
  return { lines, omitted };
}

export async function loadContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  return await loadSharedContextReport({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    provider: params.provider,
    model: params.model,
    contextTokens: params.contextTokens,
    messageProvider: params.command.channel,
    senderIsOwner: params.command.senderIsOwner,
    resolvedThinkLevel: params.resolvedThinkLevel,
    resolvedReasoningLevel: params.resolvedReasoningLevel,
    resolvedElevatedLevel: params.resolvedElevatedLevel,
    elevatedAllowed: params.elevated.allowed,
  });
}

export async function buildContextReply(params: HandleCommandsParams): Promise<ReplyPayload> {
  const args = parseContextArgs(params.command.commandBodyNormalized);
  const sub = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? "";

  if (!sub || sub === "help") {
    return {
      text: [
        "🧠 /context",
        "",
        "What counts as context (high-level), plus a breakdown mode.",
        "",
        "Try:",
        "- /context list   (short breakdown)",
        "- /context detail (per-file + per-tool + per-skill + system prompt size)",
        "- /context json   (same, machine-readable)",
        "",
        "Inline shortcut = a command token inside a normal message (e.g. “hey /status”). It runs immediately (allowlisted senders only) and is stripped before the model sees the remaining text.",
      ].join("\n"),
    };
  }

  const report = await loadSharedProjectedContextReport({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    provider: params.provider,
    model: params.model,
    contextTokens: params.contextTokens,
    messageProvider: params.command.channel,
    senderIsOwner: params.command.senderIsOwner,
    resolvedThinkLevel: params.resolvedThinkLevel,
    resolvedReasoningLevel: params.resolvedReasoningLevel,
    resolvedElevatedLevel: params.resolvedElevatedLevel,
    elevatedAllowed: params.elevated.allowed,
  });
  const session = {
    totalTokens: params.sessionEntry?.totalTokens ?? null,
    inputTokens: params.sessionEntry?.inputTokens ?? null,
    outputTokens: params.sessionEntry?.outputTokens ?? null,
    contextTokens: params.contextTokens ?? null,
  } as const;
  const inspector = buildContextInspectorData({
    report,
    session,
    sessionEntry: params.sessionEntry,
  });

  if (sub === "json") {
    return { text: JSON.stringify({ report, session, inspector }, null, 2) };
  }

  if (sub !== "list" && sub !== "show" && sub !== "detail" && sub !== "deep") {
    return {
      text: [
        "Unknown /context mode.",
        "Use: /context, /context list, /context detail, or /context json",
      ].join("\n"),
    };
  }

  const fileLines = report.injectedWorkspaceFiles.map((f) => {
    const status = f.missing ? "MISSING" : f.truncated ? "TRUNCATED" : "OK";
    const raw = f.missing ? "0" : formatCharsAndTokens(f.rawChars, f.rawTokens);
    const injected = f.missing ? "0" : formatCharsAndTokens(f.injectedChars, f.injectedTokens);
    const extras = [
      f.sourceGroup ? `source=${f.sourceGroup}` : null,
      f.provenance && f.provenance.length > 1 ? `includes=${f.provenance.length - 1}` : null,
      f.synthetic ? "synthetic" : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return `- ${f.name}: ${status} | raw ${raw} | injected ${injected}${extras ? ` | ${extras}` : ""}`;
  });

  const sandboxLine = `Sandbox: mode=${report.sandbox?.mode ?? "unknown"} sandboxed=${report.sandbox?.sandboxed ?? false}`;
  const toolSchemaLine = `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars, report.tools.schemaTokens)} (counts toward context; not shown as text)`;
  const toolListLine = `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars, report.tools.listTokens)}`;
  const skillNameSet = new Set(report.skills.entries.map((s) => s.name));
  const skillNames = Array.from(skillNameSet);
  const toolNames = report.tools.entries.map((t) => t.name);
  const formatNameList = (names: string[], cap: number) =>
    names.length <= cap
      ? names.join(", ")
      : `${names.slice(0, cap).join(", ")}, … (+${names.length - cap} more)`;
  const skillsLine = `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars, report.skills.promptTokens)} (${inspector.skills.loadedCount}/${inspector.skills.availableCount} prompt-visible/eligible)`;
  const skillsNamesLine = skillNameSet.size
    ? `Skills: ${formatNameList(skillNames, 20)}`
    : "Skills: (none)";
  const toolsNamesLine = toolNames.length
    ? `Tools: ${formatNameList(toolNames, 30)}`
    : "Tools: (none)";
  const systemPromptLine = `System prompt (${report.source}): ${formatCharsAndTokens(report.systemPrompt.chars, report.systemPrompt.tokens)} (Project Context ${formatCharsAndTokens(report.systemPrompt.projectContextChars, report.systemPrompt.projectContextTokens)})`;
  const modelVisibleLine = report.modelView
    ? (() => {
        const pressure =
          typeof report.modelView.contextPressure === "number"
            ? ` (${formatPercent(report.modelView.contextPressure)})`
            : "";
        const windowSuffix =
          typeof report.modelView.contextWindowTokens === "number"
            ? ` / ${formatTokenCount(report.modelView.contextWindowTokens)} window`
            : "";
        const freeSuffix =
          typeof inspector.freeTokens === "number"
            ? ` · free ${formatTokenCount(inspector.freeTokens)}`
            : "";
        return `Model-visible payload: ${formatTokenCount(report.modelView.projectedTotalTokens)}${windowSuffix}${pressure}${freeSuffix}`;
      })()
    : null;
  const branchHistoryLine = report.modelView
    ? `Branch history: ${formatInt(report.modelView.branchHistoryMessages)} messages / ${formatTokenCount(report.modelView.branchHistoryTokens)}`
    : null;
  const scopedHistoryLine = report.modelView
    ? `Task-scoped history: ${formatInt(report.modelView.scopedHistoryMessages)} messages / ${formatTokenCount(report.modelView.scopedHistoryTokens)}${report.modelView.taskScoped ? " (active)" : " (full branch)"}`
    : null;
  const projectedHistoryLine = report.modelView
    ? `Model-visible history: ${formatInt(report.modelView.projectedHistoryMessages)} messages / ${formatTokenCount(report.modelView.projectedHistoryTokens)}`
    : null;
  const historyGuardsLine = report.modelView
    ? [
        report.modelView.taskScoped ? "task scope active" : "full branch visible",
        typeof report.modelView.dmHistoryLimit === "number"
          ? `DM limit=${report.modelView.dmHistoryLimit}`
          : null,
        report.modelView.truncatedToolResults > 0
          ? `truncated tool results=${report.modelView.truncatedToolResults}`
          : "truncated tool results=0",
        `compactions=${inspector.status.compactionCount}`,
      ]
        .filter(Boolean)
        .join(" | ")
    : null;
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
      stage.savingsTokens > 0 ? ` · saved ${formatTokenCount(stage.savingsTokens)}` : "";
    return [
      `- ${stage.label}: ${formatInt(previous.messages)} msg / ${formatTokenCount(previous.tokens)} -> ${formatInt(stage.messages)} msg / ${formatTokenCount(stage.tokens)}${delta}`,
    ];
  });
  const sourceSummaryLines = inspector.sourceBreakdown.map(
    (group) =>
      `- ${group.source}: ${formatTokenCount(group.totalTokens)} across ${formatInt(group.contributors.length)} contributor(s)`,
  );
  const sourceDetailLines = inspector.sourceBreakdown.flatMap((group) => {
    const header = `${group.source} (${formatTokenCount(group.totalTokens)})`;
    const contributors = group.contributors.map((contributor) => {
      const detail = contributor.detail ? ` | ${contributor.detail}` : "";
      return `- ${contributor.name}: ${formatTokenCount(contributor.tokens)}${detail}`;
    });
    return [header, ...contributors, ""];
  });
  const skillSourceLines = inspector.skills.sourceBreakdown.map(
    (group) =>
      `- ${group.source}: ${group.count} skill(s) / ${formatTokenCount(group.tokens)} (${formatNameList(group.names, 10)})`,
  );
  const suggestionLines = inspector.suggestions.map(
    (suggestion) =>
      `- ${suggestion.severity.toUpperCase()}: ${suggestion.title} (${formatTokenCount(suggestion.estimatedTokenSavings)} est.) — ${suggestion.detail}`,
  );
  const memoryLines =
    inspector.files.memoryFiles.length > 0
      ? inspector.files.memoryFiles.map(
          (file) =>
            `- ${file.name}: ${formatTokenCount(file.tokens)}${file.truncated ? " | truncated" : ""}${file.synthetic ? " | synthetic" : ""}`,
        )
      : ["- (none)"];
  const workspaceLabel = report.workspaceDir ?? params.workspaceDir;
  const bootstrapMaxLabel =
    typeof report.bootstrapMaxChars === "number"
      ? `${formatInt(report.bootstrapMaxChars)} chars`
      : "? chars";

  const totalsLine =
    session.totalTokens != null
      ? `Session tokens (cached): ${formatInt(session.totalTokens)} total / ctx=${session.contextTokens ?? "?"}`
      : `Session tokens (cached): unknown / ctx=${session.contextTokens ?? "?"}`;

  if (sub === "detail" || sub === "deep") {
    const perSkill = formatListTop(
      report.skills.entries.map((s) => ({
        name: s.name,
        chars: s.blockChars,
        tokens: s.blockTokens,
      })),
      30,
    );
    const perToolSchema = formatListTop(
      report.tools.entries.map((t) => ({
        name: t.name,
        chars: t.schemaChars,
        tokens: t.schemaTokens,
      })),
      30,
    );
    const perToolSummary = formatListTop(
      report.tools.entries.map((t) => ({
        name: t.name,
        chars: t.summaryChars,
        tokens: t.summaryTokens,
      })),
      30,
    );
    const toolPropsLines = report.tools.entries
      .filter((t) => t.propertiesCount != null)
      .toSorted((a, b) => (b.propertiesCount ?? 0) - (a.propertiesCount ?? 0))
      .slice(0, 30)
      .map((t) => `- ${t.name}: ${t.propertiesCount} params`);
    const cacheLine = report.cache
      ? `Prompt cache: ${report.cache.staticPrefixCacheStatus} | static ${formatCharsAndTokens(report.cache.staticPrefixChars)} | dynamic ${formatCharsAndTokens(report.cache.dynamicTailChars)}`
      : null;

    return {
      text: [
        "🧠 Context breakdown (detailed)",
        `Workspace: ${workspaceLabel}`,
        `Bootstrap max/file: ${bootstrapMaxLabel}`,
        sandboxLine,
        systemPromptLine,
        ...(cacheLine ? [cacheLine] : []),
        ...(modelVisibleLine
          ? [modelVisibleLine, branchHistoryLine, scopedHistoryLine, projectedHistoryLine]
          : []),
        ...(historyGuardsLine ? [historyGuardsLine] : []),
        ...(categoryLines.length ? ["", "Category breakdown:", ...categoryLines] : []),
        ...(rewriteLines.length ? ["", "Hidden context rewrites:", ...rewriteLines] : []),
        ...(sourceSummaryLines.length
          ? ["", "Known contributors by source:", ...sourceSummaryLines]
          : []),
        ...(suggestionLines.length ? ["", "Suggestions:", ...suggestionLines] : []),
        "",
        "Injected workspace files:",
        ...fileLines,
        "",
        "Memory files:",
        ...memoryLines,
        "",
        skillsLine,
        skillsNamesLine,
        ...(skillSourceLines.length ? ["Skill sources:", ...skillSourceLines] : []),
        ...(perSkill.lines.length ? ["Top skills (prompt entry size):", ...perSkill.lines] : []),
        ...(perSkill.omitted ? [`… (+${perSkill.omitted} more skills)`] : []),
        "",
        toolListLine,
        toolSchemaLine,
        toolsNamesLine,
        "Top tools (schema size):",
        ...perToolSchema.lines,
        ...(perToolSchema.omitted ? [`… (+${perToolSchema.omitted} more tools)`] : []),
        "",
        "Top tools (summary text size):",
        ...perToolSummary.lines,
        ...(perToolSummary.omitted ? [`… (+${perToolSummary.omitted} more tools)`] : []),
        ...(toolPropsLines.length ? ["", "Tools (param count):", ...toolPropsLines] : []),
        ...(sourceDetailLines.length ? ["", "Contributor details:", ...sourceDetailLines] : []),
        "",
        totalsLine,
        "",
        "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    text: [
      "🧠 Context breakdown",
      `Workspace: ${workspaceLabel}`,
      `Bootstrap max/file: ${bootstrapMaxLabel}`,
      sandboxLine,
      systemPromptLine,
      ...(modelVisibleLine
        ? [modelVisibleLine, branchHistoryLine, scopedHistoryLine, projectedHistoryLine]
        : []),
      ...(historyGuardsLine ? [historyGuardsLine] : []),
      ...(categoryLines.length ? ["", "Category breakdown:", ...categoryLines] : []),
      ...(rewriteLines.length ? ["", "Hidden context rewrites:", ...rewriteLines] : []),
      ...(sourceSummaryLines.length
        ? ["", "Known contributors by source:", ...sourceSummaryLines]
        : []),
      ...(suggestionLines.length ? ["", "Suggestions:", ...suggestionLines.slice(0, 3)] : []),
      "",
      "Injected workspace files:",
      ...fileLines,
      "",
      skillsLine,
      skillsNamesLine,
      toolListLine,
      toolSchemaLine,
      toolsNamesLine,
      "",
      totalsLine,
      "",
      "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
    ].join("\n"),
  };
}
