import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { ReplyPayload } from "../types.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { resolveSessionAgentIds } from "../../agents/agent-scope.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import {
  attachModelViewToSystemPromptReport,
  estimateTokensFromChars,
  projectConversationForModel,
} from "../../agents/model-visible-context.js";
import { resolveBootstrapMaxChars } from "../../agents/pi-embedded-helpers.js";
import { createOpenClawCodingTools } from "../../agents/pi-tools.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import { buildWorkspaceSkillSnapshot } from "../../agents/skills.js";
import { getSkillsSnapshotVersion } from "../../agents/skills/refresh.js";
import { buildSystemPromptParams } from "../../agents/system-prompt-params.js";
import { buildSystemPromptReport } from "../../agents/system-prompt-report.js";
import { buildAgentSystemPromptArtifacts } from "../../agents/system-prompt.js";
import { buildToolOperatorManualMap, buildToolSummaryMap } from "../../agents/tool-summaries.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { resolveSessionTaskId } from "../../sessions/task-context.js";
import { buildTtsSystemPromptHint } from "../../tts/tts.js";

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCharsAndTokens(chars: number): string {
  return `${formatInt(chars)} chars (~${formatInt(estimateTokensFromChars(chars))} tok)`;
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
  entries: Array<{ name: string; value: number }>,
  cap: number,
): { lines: string[]; omitted: number } {
  const sorted = [...entries].toSorted((a, b) => b.value - a.value);
  const top = sorted.slice(0, cap);
  const omitted = Math.max(0, sorted.length - top.length);
  const lines = top.map((e) => `- ${e.name}: ${formatCharsAndTokens(e.value)}`);
  return { lines, omitted };
}

export async function loadContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  const existing = params.sessionEntry?.systemPromptReport;
  if (existing && existing.source === "run") {
    return existing;
  }

  const workspaceDir = params.workspaceDir;
  const bootstrapMaxChars = resolveBootstrapMaxChars(params.cfg, params.provider);
  const { bootstrapFiles, contextFiles: injectedFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.cfg,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry?.sessionId,
    provider: params.provider,
  });
  const skillsSnapshot = (() => {
    try {
      return buildWorkspaceSkillSnapshot(workspaceDir, {
        config: params.cfg,
        eligibility: { remote: getRemoteSkillEligibility() },
        snapshotVersion: getSkillsSnapshotVersion(workspaceDir),
      });
    } catch {
      return { prompt: "", skills: [], resolvedSkills: [] };
    }
  })();
  const skillsPrompt = skillsSnapshot.prompt ?? "";
  const sandboxRuntime = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.ctx.SessionKey ?? params.sessionKey,
  });
  const tools = (() => {
    try {
      return createOpenClawCodingTools({
        config: params.cfg,
        workspaceDir,
        sessionKey: params.sessionKey,
        messageProvider: params.command.channel,
        groupId: params.sessionEntry?.groupId ?? undefined,
        groupChannel: params.sessionEntry?.groupChannel ?? undefined,
        groupSpace: params.sessionEntry?.space ?? undefined,
        spawnedBy: params.sessionEntry?.spawnedBy ?? undefined,
        senderIsOwner: params.command.senderIsOwner,
        modelProvider: params.provider,
        modelId: params.model,
      });
    } catch {
      return [];
    }
  })();
  const toolSummaries = buildToolSummaryMap(tools);
  const toolNames = tools.map((t) => t.name);
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: sessionAgentId,
  });
  const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: params.cfg,
    agentId: sessionAgentId,
    workspaceDir,
    cwd: process.cwd(),
    runtime: {
      host: "unknown",
      os: "unknown",
      arch: "unknown",
      node: process.version,
      model: `${params.provider}/${params.model}`,
      defaultModel: defaultModelLabel,
    },
  });
  const sandboxInfo = sandboxRuntime.sandboxed
    ? {
        enabled: true,
        workspaceDir,
        workspaceAccess: "rw" as const,
        elevated: {
          allowed: params.elevated.allowed,
          defaultLevel: (params.resolvedElevatedLevel ?? "off") as "on" | "off" | "ask" | "full",
        },
      }
    : { enabled: false };
  const ttsHint = params.cfg ? buildTtsSystemPromptHint(params.cfg) : undefined;

  const promptArtifacts = buildAgentSystemPromptArtifacts({
    workspaceDir,
    defaultThinkLevel: params.resolvedThinkLevel,
    reasoningLevel: params.resolvedReasoningLevel,
    extraSystemPrompt: undefined,
    ownerNumbers: undefined,
    reasoningTagHint: false,
    toolNames,
    toolSummaries,
    modelAliasLines: [],
    userTimezone,
    userTime,
    userTimeFormat,
    contextFiles: injectedFiles,
    skillsPrompt,
    heartbeatPrompt: undefined,
    ttsHint,
    runtimeInfo,
    sandboxInfo,
    memoryCitationsMode: params.cfg?.memory?.citations,
    toolManuals: buildToolOperatorManualMap(tools),
  });
  const systemPrompt = promptArtifacts.prompt;

  return buildSystemPromptReport({
    source: "estimate",
    generatedAt: Date.now(),
    sessionId: params.sessionEntry?.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir,
    bootstrapMaxChars,
    sandbox: { mode: sandboxRuntime.mode, sandboxed: sandboxRuntime.sandboxed },
    systemPrompt,
    promptAssembly: promptArtifacts,
    bootstrapFiles,
    injectedFiles,
    skillsPrompt,
    tools,
  });
}

async function loadProjectedContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  const report = await loadContextReport(params);
  const sessionId = params.sessionEntry?.sessionId?.trim();
  if (!sessionId) {
    return report;
  }

  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const sessionFile = resolveSessionFilePath(sessionId, params.sessionEntry, {
    agentId: sessionAgentId,
  });

  try {
    const sessionManager = SessionManager.open(sessionFile);
    const projection = await projectConversationForModel({
      sessionManager,
      sessionId,
      sessionKey: params.sessionKey,
      taskId: resolveSessionTaskId({ entry: params.sessionEntry }),
      config: params.cfg,
      provider: params.provider,
      modelId: params.model,
      contextWindowTokens:
        typeof params.contextTokens === "number" && params.contextTokens > 0
          ? params.contextTokens
          : undefined,
      systemPromptReport: report,
      sanitizeOptions: { recordModelSnapshot: false },
    });
    return attachModelViewToSystemPromptReport(report, projection.usage);
  } catch {
    return report;
  }
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

  const report = await loadProjectedContextReport(params);
  const session = {
    totalTokens: params.sessionEntry?.totalTokens ?? null,
    inputTokens: params.sessionEntry?.inputTokens ?? null,
    outputTokens: params.sessionEntry?.outputTokens ?? null,
    contextTokens: params.contextTokens ?? null,
  } as const;

  if (sub === "json") {
    return { text: JSON.stringify({ report, session }, null, 2) };
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
    const raw = f.missing ? "0" : formatCharsAndTokens(f.rawChars);
    const injected = f.missing ? "0" : formatCharsAndTokens(f.injectedChars);
    return `- ${f.name}: ${status} | raw ${raw} | injected ${injected}`;
  });

  const sandboxLine = `Sandbox: mode=${report.sandbox?.mode ?? "unknown"} sandboxed=${report.sandbox?.sandboxed ?? false}`;
  const toolSchemaLine = `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars)} (counts toward context; not shown as text)`;
  const toolListLine = `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars)}`;
  const skillNameSet = new Set(report.skills.entries.map((s) => s.name));
  const skillNames = Array.from(skillNameSet);
  const toolNames = report.tools.entries.map((t) => t.name);
  const formatNameList = (names: string[], cap: number) =>
    names.length <= cap
      ? names.join(", ")
      : `${names.slice(0, cap).join(", ")}, … (+${names.length - cap} more)`;
  const skillsLine = `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars)} (${skillNameSet.size} skills)`;
  const skillsNamesLine = skillNameSet.size
    ? `Skills: ${formatNameList(skillNames, 20)}`
    : "Skills: (none)";
  const toolsNamesLine = toolNames.length
    ? `Tools: ${formatNameList(toolNames, 30)}`
    : "Tools: (none)";
  const systemPromptLine = `System prompt (${report.source}): ${formatCharsAndTokens(report.systemPrompt.chars)} (Project Context ${formatCharsAndTokens(report.systemPrompt.projectContextChars)})`;
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
        return `Model-visible payload: ${formatTokenCount(report.modelView.projectedTotalTokens)}${windowSuffix}${pressure}`;
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
        typeof report.modelView.dmHistoryLimit === "number"
          ? `DM limit=${report.modelView.dmHistoryLimit}`
          : null,
        report.modelView.truncatedToolResults > 0
          ? `truncated tool results=${report.modelView.truncatedToolResults}`
          : null,
      ]
        .filter(Boolean)
        .join(" | ")
    : null;
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
      report.skills.entries.map((s) => ({ name: s.name, value: s.blockChars })),
      30,
    );
    const perToolSchema = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.schemaChars })),
      30,
    );
    const perToolSummary = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.summaryChars })),
      30,
    );
    const toolPropsLines = report.tools.entries
      .filter((t) => t.propertiesCount != null)
      .toSorted((a, b) => (b.propertiesCount ?? 0) - (a.propertiesCount ?? 0))
      .slice(0, 30)
      .map((t) => `- ${t.name}: ${t.propertiesCount} params`);

    return {
      text: [
        "🧠 Context breakdown (detailed)",
        `Workspace: ${workspaceLabel}`,
        `Bootstrap max/file: ${bootstrapMaxLabel}`,
        sandboxLine,
        systemPromptLine,
        ...(modelVisibleLine
          ? [modelVisibleLine, branchHistoryLine, scopedHistoryLine, projectedHistoryLine]
          : []),
        ...(historyGuardsLine ? [historyGuardsLine] : []),
        "",
        "Injected workspace files:",
        ...fileLines,
        "",
        skillsLine,
        skillsNamesLine,
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
