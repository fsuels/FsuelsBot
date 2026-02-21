import crypto from "node:crypto";
import type { ExecToolDefaults } from "../../agents/bash-tools.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import type { buildCommandContext } from "./commands.js";
import type { InlineDirectives } from "./directive-handling.js";
import type { createModelSelectionState } from "./model-selection.js";
import type { TypingController } from "./typing.js";
import { resolveSessionAuthProfileOverride } from "../../agents/auth-profiles/session-override.js";
import {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  resolveEmbeddedSessionLane,
} from "../../agents/pi-embedded.js";
import { resolveBoardActiveTaskId, updateBotCurrentTask } from "../../agents/task-checkpoint.js";
import {
  resolveGroupSessionKey,
  resolveSessionFilePath,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import {
  emitDiagnosticEvent,
  isDiagnosticsEnabled,
  MEMORY_GUIDANCE_EVENT_VERSION,
  MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION,
  MEMORY_TURN_CONTROL_EVENT_VERSION,
} from "../../infra/diagnostic-events.js";
import { listConstraintPinsForInjection } from "../../memory/pins.js";
import { commitMemoryEvents } from "../../memory/task-memory-system.js";
import { clearCommandLane, getQueueSize } from "../../process/command-queue.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import {
  applySessionTaskUpdate,
  DEFAULT_SESSION_TASK_ID,
  resolveSessionTaskView,
} from "../../sessions/task-context.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import { hasControlCommand } from "../command-detection.js";
import { buildInboundMediaNote } from "../media-note.js";
import {
  type ElevatedLevel,
  formatXHighModelHint,
  normalizeThinkLevel,
  type ReasoningLevel,
  supportsXHighThinking,
  type ThinkLevel,
  type VerboseLevel,
} from "../thinking.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import { runReplyAgent } from "./agent-runner.js";
import { applySessionHints } from "./body.js";
import { buildGroupIntro } from "./groups.js";
import { resolveQueueSettings } from "./queue.js";
import { routeReply } from "./route-reply.js";
import { ensureSkillSnapshot, prependSystemEvents } from "./session-updates.js";
import { inferTaskHintFromMessage } from "./task-hints.js";
import {
  applyMemoryGuidanceTurn,
  detectMemoryGuidanceUserSignal,
  resolveMemoryGuidanceState,
  selectTaskMemoryNudge,
} from "./task-memory-guidance.js";
import { resolveTypingMode } from "./typing-mode.js";
import { appendUntrustedContext } from "./untrusted-context.js";

type AgentDefaults = NonNullable<OpenClawConfig["agents"]>["defaults"];
type ExecOverrides = Pick<ExecToolDefaults, "host" | "security" | "ask" | "node">;

const BARE_SESSION_RESET_PROMPT =
  "A new session was started via /new or /reset. Greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

type RunPreparedReplyParams = {
  ctx: MsgContext;
  sessionCtx: TemplateContext;
  cfg: OpenClawConfig;
  agentId: string;
  agentDir: string;
  agentCfg: AgentDefaults;
  sessionCfg: OpenClawConfig["session"];
  commandAuthorized: boolean;
  command: ReturnType<typeof buildCommandContext>;
  commandSource: string;
  allowTextCommands: boolean;
  directives: InlineDirectives;
  defaultActivation: Parameters<typeof buildGroupIntro>[0]["defaultActivation"];
  resolvedThinkLevel: ThinkLevel | undefined;
  resolvedVerboseLevel: VerboseLevel | undefined;
  resolvedReasoningLevel: ReasoningLevel;
  resolvedElevatedLevel: ElevatedLevel;
  execOverrides?: ExecOverrides;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  modelState: Awaited<ReturnType<typeof createModelSelectionState>>;
  provider: string;
  model: string;
  perMessageQueueMode?: InlineDirectives["queueMode"];
  perMessageQueueOptions?: {
    debounceMs?: number;
    cap?: number;
    dropPolicy?: InlineDirectives["dropPolicy"];
  };
  typing: TypingController;
  opts?: GetReplyOptions;
  defaultProvider: string;
  defaultModel: string;
  timeoutMs: number;
  isNewSession: boolean;
  resetTriggered: boolean;
  systemSent: boolean;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  sessionId?: string;
  storePath?: string;
  workspaceDir: string;
  abortedLastRun: boolean;
};

export async function runPreparedReply(
  params: RunPreparedReplyParams,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    agentCfg,
    sessionCfg,
    commandAuthorized,
    command,
    commandSource,
    allowTextCommands,
    directives,
    defaultActivation,
    elevatedEnabled,
    elevatedAllowed,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    modelState,
    provider,
    model,
    perMessageQueueMode,
    perMessageQueueOptions,
    typing,
    opts,
    defaultProvider,
    defaultModel,
    timeoutMs,
    isNewSession,
    resetTriggered,
    systemSent,
    sessionKey,
    sessionId,
    storePath,
    workspaceDir,
    sessionStore,
  } = params;
  let {
    sessionEntry,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    abortedLastRun,
  } = params;
  let currentSystemSent = systemSent;

  const isFirstTurnInSession = isNewSession || !currentSystemSent;
  const isGroupChat = sessionCtx.ChatType === "group";
  const wasMentioned = ctx.WasMentioned === true;
  const isHeartbeat = opts?.isHeartbeat === true;
  const typingMode = resolveTypingMode({
    configured: sessionCfg?.typingMode ?? agentCfg?.typingMode,
    isGroupChat,
    wasMentioned,
    isHeartbeat,
  });
  const shouldInjectGroupIntro = Boolean(
    isGroupChat && (isFirstTurnInSession || sessionEntry?.groupActivationNeedsSystemIntro),
  );
  const groupIntro = shouldInjectGroupIntro
    ? buildGroupIntro({
        cfg,
        sessionCtx,
        sessionEntry,
        defaultActivation,
        silentToken: SILENT_REPLY_TOKEN,
      })
    : "";
  const groupSystemPrompt = sessionCtx.GroupSystemPrompt?.trim() ?? "";
  const extraSystemPrompt = [groupIntro, groupSystemPrompt].filter(Boolean).join("\n\n");
  const baseBody = sessionCtx.BodyStripped ?? sessionCtx.Body ?? "";
  // Use CommandBody/RawBody for bare reset detection (clean message without structural context).
  const rawBodyTrimmed = (ctx.CommandBody ?? ctx.RawBody ?? ctx.Body ?? "").trim();
  const baseBodyTrimmedRaw = baseBody.trim();
  if (
    allowTextCommands &&
    (!commandAuthorized || !command.isAuthorizedSender) &&
    !baseBodyTrimmedRaw &&
    hasControlCommand(commandSource, cfg)
  ) {
    typing.cleanup();
    return undefined;
  }
  const isBareNewOrReset = rawBodyTrimmed === "/new" || rawBodyTrimmed === "/reset";
  const isBareSessionReset =
    isNewSession &&
    ((baseBodyTrimmedRaw.length === 0 && rawBodyTrimmed.length > 0) || isBareNewOrReset);
  const baseBodyFinal = isBareSessionReset ? BARE_SESSION_RESET_PROMPT : baseBody;
  const baseBodyTrimmed = baseBodyFinal.trim();
  if (!baseBodyTrimmed) {
    await typing.onReplyStart();
    logVerbose("Inbound body empty after normalization; skipping agent run");
    typing.cleanup();
    return {
      text: "I didn't receive any text in your message. Please resend or add a caption.",
    };
  }
  let prefixedBodyBase = await applySessionHints({
    baseBody: baseBodyFinal,
    abortedLastRun,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    abortKey: command.abortKey,
    messageId: sessionCtx.MessageSid,
  });
  const isGroupSession = sessionEntry?.chatType === "group" || sessionEntry?.chatType === "channel";
  const isMainSession = !isGroupSession && sessionKey === normalizeMainKey(sessionCfg?.mainKey);
  prefixedBodyBase = await prependSystemEvents({
    cfg,
    sessionKey,
    isMainSession,
    isNewSession,
    prefixedBodyBase,
  });
  prefixedBodyBase = appendUntrustedContext(prefixedBodyBase, sessionCtx.UntrustedContext);
  const threadStarterBody = ctx.ThreadStarterBody?.trim();
  const threadStarterNote =
    isNewSession && threadStarterBody
      ? `[Thread starter - for context]\n${threadStarterBody}`
      : undefined;
  const skillResult = await ensureSkillSnapshot({
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionId,
    isFirstTurnInSession,
    workspaceDir,
    cfg,
    skillFilter: opts?.skillFilter,
  });
  sessionEntry = skillResult.sessionEntry ?? sessionEntry;
  currentSystemSent = skillResult.systemSent;
  const skillsSnapshot = skillResult.skillsSnapshot;
  const prefixedBody = [threadStarterNote, prefixedBodyBase].filter(Boolean).join("\n\n");
  const mediaNote = buildInboundMediaNote(ctx);
  const mediaReplyHint = mediaNote
    ? "To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Avoid absolute paths (MEDIA:/...) and ~ paths — they are blocked for security. Keep caption in the text body."
    : undefined;
  let prefixedCommandBody = mediaNote
    ? [mediaNote, mediaReplyHint, prefixedBody ?? ""].filter(Boolean).join("\n").trim()
    : prefixedBody;
  if (!resolvedThinkLevel && prefixedCommandBody) {
    const parts = prefixedCommandBody.split(/\s+/);
    const maybeLevel = normalizeThinkLevel(parts[0]);
    if (maybeLevel && (maybeLevel !== "xhigh" || supportsXHighThinking(provider, model))) {
      resolvedThinkLevel = maybeLevel;
      prefixedCommandBody = parts.slice(1).join(" ").trim();
    }
  }
  if (!resolvedThinkLevel) {
    resolvedThinkLevel = await modelState.resolveDefaultThinkingLevel();
  }
  if (resolvedThinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
    const explicitThink = directives.hasThinkDirective && directives.thinkLevel !== undefined;
    if (explicitThink) {
      typing.cleanup();
      return {
        text: `Thinking level "xhigh" is only supported for ${formatXHighModelHint()}. Use /think high or switch to one of those models.`,
      };
    }
    resolvedThinkLevel = "high";
    if (sessionEntry && sessionStore && sessionKey && sessionEntry.thinkingLevel === "xhigh") {
      const updatedSessionEntry: SessionEntry = {
        ...sessionEntry,
        thinkingLevel: "high",
        updatedAt: Date.now(),
      };
      sessionEntry = updatedSessionEntry;
      sessionStore[sessionKey] = updatedSessionEntry;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[sessionKey] = updatedSessionEntry;
        });
      }
    }
  }
  if (resetTriggered && command.isAuthorizedSender) {
    // oxlint-disable-next-line typescript/no-explicit-any
    const channel = ctx.OriginatingChannel || (command.channel as any);
    const to = ctx.OriginatingTo || command.from || command.to;
    if (channel && to) {
      const normalizedResetBody = rawBodyTrimmed.toLowerCase();
      const isTelegramChannel = channel === "telegram" || command.surface === "telegram";
      const text = (() => {
        if (isTelegramChannel && normalizedResetBody.startsWith("/new")) {
          return [
            "I have started fresh.",
            "",
            "Your saved work and important details are still remembered.",
            "What would you like to work on now?",
          ].join("\n");
        }
        if (isTelegramChannel && normalizedResetBody.startsWith("/reset")) {
          return [
            "I am clearing the recent conversation now.",
            "",
            "Saved work is still safe.",
            "What would you like to work on next?",
          ].join("\n");
        }
        const modelLabel = `${provider}/${model}`;
        const defaultLabel = `${defaultProvider}/${defaultModel}`;
        return modelLabel === defaultLabel
          ? `New session started - model: ${modelLabel}`
          : `New session started - model: ${modelLabel} (default: ${defaultLabel})`;
      })();
      await routeReply({
        payload: { text },
        channel,
        to,
        sessionKey,
        accountId: ctx.AccountId,
        threadId: ctx.MessageThreadId,
        cfg,
      });
    }
  }
  const sessionIdFinal = sessionId ?? crypto.randomUUID();
  const sessionFile = resolveSessionFilePath(sessionIdFinal, sessionEntry);
  const queueBodyBase = [threadStarterNote, baseBodyFinal].filter(Boolean).join("\n\n");
  const queueMessageId = sessionCtx.MessageSid?.trim();
  const queueMessageIdHint = queueMessageId ? `[message_id: ${queueMessageId}]` : "";
  const queueBodyWithId = queueMessageIdHint
    ? `${queueBodyBase}\n${queueMessageIdHint}`
    : queueBodyBase;
  const queuedBody = mediaNote
    ? [mediaNote, mediaReplyHint, queueBodyWithId].filter(Boolean).join("\n").trim()
    : queueBodyWithId;
  const resolvedQueue = resolveQueueSettings({
    cfg,
    channel: sessionCtx.Provider,
    sessionEntry,
    inlineMode: perMessageQueueMode,
    inlineOptions: perMessageQueueOptions,
  });
  const sessionLaneKey = resolveEmbeddedSessionLane(sessionKey ?? sessionIdFinal);
  const laneSize = getQueueSize(sessionLaneKey);
  if (resolvedQueue.mode === "interrupt" && laneSize > 0) {
    const cleared = clearCommandLane(sessionLaneKey);
    const aborted = abortEmbeddedPiRun(sessionIdFinal);
    logVerbose(`Interrupting ${sessionLaneKey} (cleared ${cleared}, aborted=${aborted})`);
  }
  const queueKey = sessionKey ?? sessionIdFinal;
  const isActive = isEmbeddedPiRunActive(sessionIdFinal);
  const isStreaming = isEmbeddedPiRunStreaming(sessionIdFinal);
  const shouldSteer = resolvedQueue.mode === "steer" || resolvedQueue.mode === "steer-backlog";
  const shouldFollowup =
    resolvedQueue.mode === "followup" ||
    resolvedQueue.mode === "collect" ||
    resolvedQueue.mode === "steer-backlog";
  const authProfileId = await resolveSessionAuthProfileOverride({
    cfg,
    provider,
    agentDir,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    isNewSession,
  });
  const authProfileIdSource = sessionEntry?.authProfileOverrideSource;
  let activeTask = resolveSessionTaskView({ entry: sessionEntry });
  try {
    const boardActiveTaskId = await resolveBoardActiveTaskId(workspaceDir);
    const sessionActiveTaskId = activeTask.taskId;
    if (
      sessionActiveTaskId !== DEFAULT_SESSION_TASK_ID &&
      boardActiveTaskId !== sessionActiveTaskId
    ) {
      await updateBotCurrentTask({
        workspaceDir,
        taskId: sessionActiveTaskId,
        title: activeTask.title,
        previousTaskId: boardActiveTaskId,
        previousStatus: "paused",
      });
      logVerbose(
        `task integrity reconcile: board active "${boardActiveTaskId ?? "<none>"}" -> "${sessionActiveTaskId}"`,
      );
    } else if (sessionActiveTaskId === DEFAULT_SESSION_TASK_ID && boardActiveTaskId) {
      const updatedAt = Date.now();
      const currentEntry = sessionEntry ??
        sessionStore?.[sessionKey] ?? {
          sessionId: sessionIdFinal,
          updatedAt,
        };
      const nextEntry = applySessionTaskUpdate(currentEntry, {
        taskId: boardActiveTaskId,
        status: "active",
        updatedAt,
        source: "task.integrity.board",
      });
      if (sessionStore && sessionKey) {
        sessionStore[sessionKey] = nextEntry;
      }
      sessionEntry = nextEntry;
      activeTask = resolveSessionTaskView({ entry: nextEntry });
      if (storePath && sessionKey) {
        await updateSessionStore(storePath, (store) => {
          const existing = store[sessionKey] ?? currentEntry;
          store[sessionKey] = applySessionTaskUpdate(existing, {
            taskId: boardActiveTaskId,
            status: "active",
            updatedAt,
            source: "task.integrity.board",
          });
        });
      }
      logVerbose(
        `task integrity reconcile: session active "${sessionActiveTaskId}" -> board "${boardActiveTaskId}"`,
      );
    }
  } catch (err) {
    logVerbose(`task integrity reconcile skipped: ${String(err)}`);
  }
  const activeTaskIdBeforeInference = activeTask.taskId;
  const inferredTaskHint = inferTaskHintFromMessage({
    entry: sessionEntry,
    message: rawBodyTrimmed || baseBodyTrimmed,
  });
  const inferredTaskId = inferredTaskHint?.taskId;
  const inferredDiffersFromActive =
    Boolean(inferredTaskId) &&
    inferredTaskId !== DEFAULT_SESSION_TASK_ID &&
    inferredTaskId !== activeTask.taskId;
  const nowMs = Date.now();
  const priorMismatchCounter = Math.max(0, sessionEntry?.taskMismatchCounter ?? 0);
  const priorThrashCounter = Math.max(0, sessionEntry?.taskSwitchThrashCounter ?? 0);
  const thrashWindowMs = 5 * 60 * 1000;
  const mismatchGateThreshold = 3;
  const thrashGateThreshold = 3;
  const recentSwitch =
    typeof sessionEntry?.lastTaskSwitchAt === "number" &&
    nowMs - sessionEntry.lastTaskSwitchAt <= thrashWindowMs;
  const nextMismatchCounter = inferredDiffersFromActive ? priorMismatchCounter + 1 : 0;
  const nextThrashCounter =
    inferredDiffersFromActive && recentSwitch
      ? priorThrashCounter + 1
      : Math.max(0, priorThrashCounter - 1);
  const autoSwitchGuardedByCounters =
    nextMismatchCounter >= mismatchGateThreshold || nextThrashCounter >= thrashGateThreshold;
  if (sessionStore && sessionKey) {
    const currentEntry = sessionEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionIdFinal,
        updatedAt: nowMs,
      };
    const nextEntry: SessionEntry = {
      ...currentEntry,
      taskMismatchCounter: nextMismatchCounter,
      taskSwitchThrashCounter: nextThrashCounter,
      lastRetrievalRejectAt: inferredDiffersFromActive ? nowMs : currentEntry.lastRetrievalRejectAt,
      updatedAt: nowMs,
    };
    sessionStore[sessionKey] = nextEntry;
    sessionEntry = nextEntry;
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        const existing = store[sessionKey] ?? currentEntry;
        store[sessionKey] = {
          ...existing,
          taskMismatchCounter: nextMismatchCounter,
          taskSwitchThrashCounter: nextThrashCounter,
          lastRetrievalRejectAt: inferredDiffersFromActive ? nowMs : existing.lastRetrievalRejectAt,
          updatedAt: nowMs,
        };
      });
    }
  }
  const autoSwitchOptIn = sessionEntry?.autoSwitchOptIn === true;
  const canAutoSwitch =
    command.isAuthorizedSender &&
    autoSwitchOptIn &&
    !autoSwitchGuardedByCounters &&
    Boolean(inferredTaskHint?.taskId) &&
    inferredTaskHint?.taskId !== DEFAULT_SESSION_TASK_ID &&
    inferredTaskHint?.taskId !== activeTask.taskId &&
    (inferredTaskHint?.ambiguousTaskIds?.length ?? 0) === 0 &&
    (inferredTaskHint?.confidence === "high" || (inferredTaskHint?.score ?? 0) >= 0.8);
  if (canAutoSwitch && inferredTaskHint?.taskId && sessionStore && sessionKey) {
    const updatedAt = Date.now();
    const previousTaskId = activeTask.taskId;
    const currentEntry = sessionEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionIdFinal,
        updatedAt,
      };
    const nextEntry = applySessionTaskUpdate(currentEntry, {
      taskId: inferredTaskHint.taskId,
      status: "active",
      updatedAt,
      source: "autoswitch",
    });
    sessionStore[sessionKey] = nextEntry;
    sessionEntry = nextEntry;
    activeTask = resolveSessionTaskView({ entry: nextEntry });
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        const existing = store[sessionKey] ?? currentEntry;
        store[sessionKey] = applySessionTaskUpdate(existing, {
          taskId: inferredTaskHint.taskId,
          status: "active",
          updatedAt,
          source: "autoswitch",
        });
      });
    }
    try {
      await updateBotCurrentTask({
        workspaceDir,
        taskId: inferredTaskHint.taskId,
        title: activeTask.title,
        previousTaskId,
        previousStatus: "paused",
      });
    } catch (err) {
      logVerbose(`autoswitch board sync skipped: ${String(err)}`);
    }
    try {
      await commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: inferredTaskHint.taskId,
        actor: "system",
        events: [
          {
            type: "STATE_PATCH_APPLIED",
            payload: { patch: { status: "active", autoSwitchedFrom: previousTaskId } },
          },
        ],
        now: updatedAt,
      });
    } catch (err) {
      logVerbose(`autoswitch memory event skipped: ${String(err)}`);
    }
  }
  const effectiveTask = activeTask;
  const taskHintSystemPrompt =
    !autoSwitchOptIn &&
    Boolean(inferredTaskHint?.taskId) &&
    inferredTaskHint?.taskId !== DEFAULT_SESSION_TASK_ID &&
    inferredTaskHint?.taskId !== activeTask.taskId
      ? `Potential task switch detected to "${inferredTaskHint?.taskId}". Do not switch automatically. Ask the user to confirm with /switch <taskId> or /newtask <title>.`
      : autoSwitchGuardedByCounters && inferredTaskHint?.taskId
        ? `Potential task switch to "${inferredTaskHint.taskId}" is currently gated due to recent mismatch/thrash signals. Do not autoswitch; ask the user to confirm with /switch <taskId> or /newtask <title>.`
        : "";
  const normalizedUserReply = (rawBodyTrimmed || baseBodyTrimmed).trim().toLowerCase();
  const isConfirmationReply = /^(yes|yep|correct|agreed|that'?s right|thats right)\b/.test(
    normalizedUserReply,
  );
  if (isConfirmationReply && effectiveTask.taskId !== DEFAULT_SESSION_TASK_ID) {
    try {
      await commitMemoryEvents({
        workspaceDir,
        writeScope: "task",
        taskId: effectiveTask.taskId,
        actor: "user",
        events: [{ type: "USER_CONFIRMED", payload: { source: "affirmation" } }],
      });
    } catch (err) {
      logVerbose(`USER_CONFIRMED commit skipped: ${String(err)}`);
    }
  }
  let constraintSystemPrompt = "";
  let hasImportantConflict = false;
  try {
    const constraintPins = await listConstraintPinsForInjection({
      workspaceDir,
      taskId: effectiveTask.taskId,
    });
    if (constraintPins.length > 0) {
      const lines = constraintPins.slice(0, 20).map((pin) => {
        const scope = pin.scope === "task" && pin.taskId ? ` (task:${pin.taskId})` : "";
        return `- ${pin.text}${scope}`;
      });
      constraintSystemPrompt = [
        "Pinned constraints (must be followed unless user explicitly overrides):",
        ...lines,
      ].join("\n");
    }
    const normalizedMessage = (rawBodyTrimmed || baseBodyTrimmed).toLowerCase();
    const indicatesChange = /\b(actually|instead|change|override|update|newer)\b/.test(
      normalizedMessage,
    );
    if (indicatesChange && constraintPins.length > 0) {
      hasImportantConflict = constraintPins.some((pin) => {
        const tokens =
          pin.text
            .toLowerCase()
            .match(/[a-z0-9]+/g)
            ?.filter((token) => token.length >= 4)
            .slice(0, 6) ?? [];
        if (tokens.length === 0) {
          return false;
        }
        const overlaps = tokens.filter((token) => normalizedMessage.includes(token)).length;
        return overlaps >= Math.min(2, tokens.length);
      });
    }
  } catch (err) {
    logVerbose(`failed to load constraint pins: ${String(err)}`);
  }
  const memoryGuidanceState = resolveMemoryGuidanceState(sessionEntry);
  const memoryGuidanceUserSignal = detectMemoryGuidanceUserSignal(
    rawBodyTrimmed || baseBodyTrimmed,
  );
  const memoryNudgeDecision = selectTaskMemoryNudge({
    message: rawBodyTrimmed || baseBodyTrimmed,
    isNewSession,
    sessionEntry,
    activeTaskId: activeTask.taskId,
    autoSwitchOptIn,
    guidanceMode: memoryGuidanceState.mode,
    inferredTaskId: inferredTaskHint?.taskId,
    inferredTaskScore: inferredTaskHint?.score,
    inferredTaskConfidence: inferredTaskHint?.confidence,
    ambiguousTaskIds: inferredTaskHint?.ambiguousTaskIds,
    taskCompactionCount: effectiveTask.compactionCount,
    taskTotalTokens: effectiveTask.totalTokens,
    hasImportantConflict,
  });
  const memoryGuidanceUpdate = applyMemoryGuidanceTurn({
    state: memoryGuidanceState,
    userSignal: memoryGuidanceUserSignal,
    shownNudgeKind: memoryNudgeDecision?.kind,
  });
  if (sessionStore && sessionKey) {
    const currentEntry = sessionEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionIdFinal,
        updatedAt: Date.now(),
      };
    if (memoryGuidanceUpdate.changed) {
      const updatedAt = Date.now();
      const nextEntry: SessionEntry = {
        ...currentEntry,
        memoryGuidanceMode: memoryGuidanceUpdate.next.mode,
        memoryGuidancePromptCount: memoryGuidanceUpdate.next.promptCount,
        memoryGuidanceExplicitCount: memoryGuidanceUpdate.next.explicitCount,
        memoryGuidanceIgnoredCount: memoryGuidanceUpdate.next.ignoredCount,
        memoryGuidanceLastNudgeKind: memoryGuidanceUpdate.next.lastNudgeKind,
        memoryGuidanceLastNudgeAt: memoryGuidanceUpdate.next.lastNudgeAt,
        updatedAt,
      };
      sessionStore[sessionKey] = nextEntry;
      sessionEntry = nextEntry;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          const existing = store[sessionKey] ?? currentEntry;
          store[sessionKey] = {
            ...existing,
            memoryGuidanceMode: memoryGuidanceUpdate.next.mode,
            memoryGuidancePromptCount: memoryGuidanceUpdate.next.promptCount,
            memoryGuidanceExplicitCount: memoryGuidanceUpdate.next.explicitCount,
            memoryGuidanceIgnoredCount: memoryGuidanceUpdate.next.ignoredCount,
            memoryGuidanceLastNudgeKind: memoryGuidanceUpdate.next.lastNudgeKind,
            memoryGuidanceLastNudgeAt: memoryGuidanceUpdate.next.lastNudgeAt,
            updatedAt,
          };
        });
      }
    }
  }
  if (isDiagnosticsEnabled(cfg)) {
    const inferredTaskId = inferredTaskHint?.taskId;
    emitDiagnosticEvent({
      type: "memory.turn-control",
      eventVersion: MEMORY_TURN_CONTROL_EVENT_VERSION,
      sessionKey,
      sessionId: sessionEntry?.sessionId ?? sessionIdFinal,
      activeTaskId: activeTaskIdBeforeInference,
      inferredTaskId,
      resolvedTaskId: effectiveTask.taskId,
      autoSwitchOptIn,
      autoSwitched:
        Boolean(inferredTaskId) &&
        inferredTaskId !== activeTaskIdBeforeInference &&
        effectiveTask.taskId === inferredTaskId,
      ambiguous: (inferredTaskHint?.ambiguousTaskIds?.length ?? 0) > 0,
      decisionMode: (() => {
        if (!inferredTaskId || inferredTaskId === activeTaskIdBeforeInference) {
          return "stay";
        }
        if (effectiveTask.taskId === inferredTaskId) {
          return "autoswitch";
        }
        return "ask";
      })(),
    });
    emitDiagnosticEvent({
      type: "memory.guidance",
      eventVersion: MEMORY_GUIDANCE_EVENT_VERSION,
      sessionKey,
      sessionId: sessionEntry?.sessionId ?? sessionIdFinal,
      taskId: effectiveTask.taskId,
      mode: memoryGuidanceUpdate.next.mode,
      shown: Boolean(memoryNudgeDecision),
      nudgeKind: memoryNudgeDecision?.kind,
      userSignal: memoryGuidanceUserSignal,
      inferredTaskId: inferredTaskHint?.taskId,
      inferredTaskConfidence: inferredTaskHint?.confidence,
      ambiguousCount: inferredTaskHint?.ambiguousTaskIds?.length ?? 0,
      hasConflict: hasImportantConflict,
    });
    if (memoryGuidanceUpdate.response) {
      emitDiagnosticEvent({
        type: "memory.guidance.response",
        eventVersion: MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION,
        sessionKey,
        sessionId: sessionEntry?.sessionId ?? sessionIdFinal,
        taskId: effectiveTask.taskId,
        priorNudgeKind: memoryGuidanceUpdate.response.priorNudgeKind,
        response: memoryGuidanceUpdate.response.response,
        latencyMs: memoryGuidanceUpdate.response.latencyMs,
        userSignal: memoryGuidanceUserSignal,
      });
    }
  }
  const memoryNudgeSystemPrompt = memoryNudgeDecision
    ? `Start this reply with exactly: "${memoryNudgeDecision.text}" Then continue with the rest of your response naturally in plain language.`
    : "";
  const runExtraSystemPrompt = [
    extraSystemPrompt,
    taskHintSystemPrompt,
    memoryNudgeSystemPrompt,
    constraintSystemPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  const followupRun = {
    prompt: queuedBody,
    messageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
    summaryLine: baseBodyTrimmedRaw,
    enqueuedAt: Date.now(),
    // Originating channel for reply routing.
    originatingChannel: ctx.OriginatingChannel,
    originatingTo: ctx.OriginatingTo,
    originatingAccountId: ctx.AccountId,
    originatingThreadId: ctx.MessageThreadId,
    originatingChatType: ctx.ChatType,
    run: {
      agentId,
      agentDir,
      sessionId: sessionIdFinal,
      sessionKey,
      taskId: effectiveTask.taskId,
      taskTitle: effectiveTask.title,
      messageProvider: sessionCtx.Provider?.trim().toLowerCase() || undefined,
      agentAccountId: sessionCtx.AccountId,
      groupId: resolveGroupSessionKey(sessionCtx)?.id ?? undefined,
      groupChannel: sessionCtx.GroupChannel?.trim() ?? sessionCtx.GroupSubject?.trim(),
      groupSpace: sessionCtx.GroupSpace?.trim() ?? undefined,
      senderId: sessionCtx.SenderId?.trim() || undefined,
      senderName: sessionCtx.SenderName?.trim() || undefined,
      senderUsername: sessionCtx.SenderUsername?.trim() || undefined,
      senderE164: sessionCtx.SenderE164?.trim() || undefined,
      senderIsOwner: command.senderIsOwner,
      sessionFile,
      workspaceDir,
      config: cfg,
      skillsSnapshot,
      provider,
      model,
      authProfileId,
      authProfileIdSource,
      thinkLevel: resolvedThinkLevel,
      verboseLevel: resolvedVerboseLevel,
      reasoningLevel: resolvedReasoningLevel,
      elevatedLevel: resolvedElevatedLevel,
      execOverrides,
      bashElevated: {
        enabled: elevatedEnabled,
        allowed: elevatedAllowed,
        defaultLevel: resolvedElevatedLevel ?? "off",
      },
      timeoutMs,
      blockReplyBreak: resolvedBlockStreamingBreak,
      ownerNumbers: command.ownerList.length > 0 ? command.ownerList : undefined,
      extraSystemPrompt: runExtraSystemPrompt || undefined,
      ...(isReasoningTagProvider(provider) ? { enforceFinalTag: true } : {}),
    },
  };

  return runReplyAgent({
    commandBody: prefixedCommandBody,
    followupRun,
    queueKey,
    resolvedQueue,
    shouldSteer,
    shouldFollowup,
    isActive,
    isStreaming,
    opts,
    typing,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens: agentCfg?.contextTokens,
    resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
    isNewSession,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    sessionCtx,
    shouldInjectGroupIntro,
    typingMode,
  });
}
