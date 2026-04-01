import type { ElevatedLevel, ReasoningLevel, ThinkLevel } from "../auto-reply/thinking.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry, SessionSystemPromptReport } from "../config/sessions/types.js";

export type ContextReportParams = {
  cfg: OpenClawConfig;
  workspaceDir: string;
  sessionKey: string;
  sessionEntry?: SessionEntry;
  provider: string;
  model: string;
  contextTokens?: number | null;
  messageProvider?: string;
  senderIsOwner?: boolean;
  resolvedThinkLevel?: ThinkLevel;
  resolvedReasoningLevel?: ReasoningLevel;
  resolvedElevatedLevel?: ElevatedLevel;
  elevatedAllowed?: boolean;
};

export async function loadContextReport(
  params: ContextReportParams,
): Promise<SessionSystemPromptReport> {
  const existing = params.sessionEntry?.systemPromptReport;
  if (existing && existing.source === "run") {
    return existing;
  }

  const [
    { getRemoteSkillEligibility },
    { resolveSessionAgentIds },
    { resolveBootstrapContextForRun },
    { resolveDefaultModelForAgent },
    { resolveBootstrapMaxChars },
    { createOpenClawCodingTools },
    { resolveSandboxRuntimeStatus },
    { buildWorkspaceSkillSnapshot },
    { getSkillsSnapshotVersion },
    { buildSystemPromptParams },
    { buildSystemPromptReport },
    { buildAgentSystemPromptArtifacts },
    { buildToolOperatorManualMap, buildToolSummaryMap },
    { buildTtsSystemPromptHint },
    { resolveAgentRuntimeCwd },
  ] = await Promise.all([
    import("../infra/skills-remote.js"),
    import("./agent-scope.js"),
    import("./bootstrap-files.js"),
    import("./model-selection.js"),
    import("./pi-embedded-helpers.js"),
    import("./pi-tools.js"),
    import("./sandbox.js"),
    import("./skills.js"),
    import("./skills/refresh.js"),
    import("./system-prompt-params.js"),
    import("./system-prompt-report.js"),
    import("./system-prompt.js"),
    import("./tool-summaries.js"),
    import("../tts/tts.js"),
    import("./runtime-context.js"),
  ]);

  const bootstrapMaxChars = resolveBootstrapMaxChars(params.cfg, params.provider);
  const { bootstrapFiles, contextFiles: injectedFiles } = await resolveBootstrapContextForRun({
    workspaceDir: params.workspaceDir,
    config: params.cfg,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry?.sessionId,
    provider: params.provider,
  });
  const skillsSnapshot = (() => {
    try {
      return buildWorkspaceSkillSnapshot(params.workspaceDir, {
        config: params.cfg,
        eligibility: { remote: getRemoteSkillEligibility() },
        snapshotVersion: getSkillsSnapshotVersion(params.workspaceDir),
      });
    } catch {
      return { prompt: "", skills: [], resolvedSkills: [] };
    }
  })();
  const skillsPrompt = skillsSnapshot.prompt ?? "";
  const sandboxRuntime = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
  const tools = (() => {
    try {
      return createOpenClawCodingTools({
        config: params.cfg,
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        messageProvider: params.messageProvider,
        senderIsOwner: params.senderIsOwner,
        modelProvider: params.provider,
        modelId: params.model,
      });
    } catch {
      return [];
    }
  })();
  const toolSummaries = buildToolSummaryMap(tools);
  const toolNames = tools.map((tool) => tool.name);
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
    workspaceDir: params.workspaceDir,
    cwd: resolveAgentRuntimeCwd(params.workspaceDir),
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
        workspaceDir: params.workspaceDir,
        workspaceAccess: "rw" as const,
        elevated: {
          allowed: params.elevatedAllowed ?? false,
          defaultLevel: (params.resolvedElevatedLevel ?? "off") as "on" | "off" | "ask" | "full",
        },
      }
    : { enabled: false };
  const ttsHint = buildTtsSystemPromptHint(params.cfg);

  const promptArtifacts = buildAgentSystemPromptArtifacts({
    workspaceDir: params.workspaceDir,
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
    memoryCitationsMode: params.cfg.memory?.citations,
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
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars,
    sandbox: { mode: sandboxRuntime.mode, sandboxed: sandboxRuntime.sandboxed },
    systemPrompt,
    promptAssembly: promptArtifacts,
    bootstrapFiles,
    injectedFiles,
    skillsPrompt,
    resolvedSkills: (skillsSnapshot.resolvedSkills ?? []).map((skill) => ({
      name: skill.name,
      source: (skill as { source?: string }).source,
    })),
    availableSkillsCount: skillsSnapshot.skills.length,
    loadedSkillsCount: skillsSnapshot.resolvedSkills?.length ?? 0,
    tools,
  });
}

export async function loadProjectedContextReport(
  params: ContextReportParams,
): Promise<SessionSystemPromptReport> {
  const [
    { SessionManager },
    { resolveSessionFilePath },
    { resolveSessionTaskId },
    { resolveSessionAgentIds },
    { attachModelViewToSystemPromptReport, projectConversationForModel },
  ] = await Promise.all([
    import("@mariozechner/pi-coding-agent"),
    import("../config/sessions.js"),
    import("../sessions/task-context.js"),
    import("./agent-scope.js"),
    import("./model-visible-context.js"),
  ]);

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
