import type { SkillCommandSpec } from "../../agents/skills.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel, VerboseLevel } from "../thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import type { InlineDirectives } from "./directive-handling.js";
import type { createModelSelectionState } from "./model-selection.js";
import type { TypingController } from "./typing.js";
import { createOpenClawTools } from "../../agents/openclaw-tools.js";
import { processSkillFactoryEpisodeDetached } from "../../agents/skill-factory/orchestrator.js";
import { enforceSkillDispatchPolicy } from "../../agents/skill-factory/safety.js";
import {
  getOrCreateSkillRuntimeState,
  markSkillInvocationLifecycle,
  routeExplicitSkillInvocation,
} from "../../agents/skills.js";
import { getChannelDock } from "../../channels/dock.js";
import { logVerbose } from "../../globals.js";
import { resolveGatewayMessageChannel } from "../../utils/message-channel.js";
import {
  listSkillCommandsForWorkspace,
  parseExplicitSkillCommandReference,
  resolveSkillCommandInvocation,
} from "../skill-commands.js";
import { getAbortMemory } from "./abort.js";
import { buildStatusReply, handleCommands } from "./commands.js";
import { isDirectiveOnly } from "./directive-handling.js";
import { extractInlineSimpleCommand } from "./reply-inline.js";

export type InlineActionResult =
  | { kind: "reply"; reply: ReplyPayload | ReplyPayload[] | undefined }
  | {
      kind: "continue";
      directives: InlineDirectives;
      abortedLastRun: boolean;
    };

// oxlint-disable-next-line typescript/no-explicit-any
function extractTextFromToolResult(result: any): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const rec = block as { type?: unknown; text?: unknown };
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  const out = parts.join("");
  const trimmed = out.trim();
  return trimmed ? trimmed : null;
}

export async function handleInlineActions(params: {
  ctx: MsgContext;
  sessionCtx: TemplateContext;
  cfg: OpenClawConfig;
  agentId: string;
  agentDir?: string;
  sessionEntry?: SessionEntry;
  previousSessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
  sessionScope: Parameters<typeof buildStatusReply>[0]["sessionScope"];
  workspaceDir: string;
  isGroup: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  allowTextCommands: boolean;
  inlineStatusRequested: boolean;
  command: Parameters<typeof handleCommands>[0]["command"];
  skillCommands?: SkillCommandSpec[];
  directives: InlineDirectives;
  cleanedBody: string;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  elevatedFailures: Array<{ gate: string; key: string }>;
  defaultActivation: Parameters<typeof buildStatusReply>[0]["defaultGroupActivation"];
  resolvedThinkLevel: ThinkLevel | undefined;
  resolvedVerboseLevel: VerboseLevel | undefined;
  resolvedReasoningLevel: ReasoningLevel;
  resolvedElevatedLevel: ElevatedLevel;
  resolveDefaultThinkingLevel: Awaited<
    ReturnType<typeof createModelSelectionState>
  >["resolveDefaultThinkingLevel"];
  provider: string;
  model: string;
  contextTokens: number;
  directiveAck?: ReplyPayload;
  abortedLastRun: boolean;
  skillFilter?: string[];
}): Promise<InlineActionResult> {
  const {
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    isGroup,
    opts,
    typing,
    allowTextCommands,
    inlineStatusRequested,
    command,
    directives: initialDirectives,
    cleanedBody: initialCleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    directiveAck,
    abortedLastRun: initialAbortedLastRun,
    skillFilter,
  } = params;

  let directives = initialDirectives;
  let cleanedBody = initialCleanedBody;

  const shouldLoadSkillCommands = command.commandBodyNormalized.startsWith("/");
  const skillCommands =
    shouldLoadSkillCommands && params.skillCommands
      ? params.skillCommands
      : shouldLoadSkillCommands
        ? listSkillCommandsForWorkspace({
            workspaceDir,
            cfg,
            skillFilter,
          })
        : [];

  const skillInvocation =
    allowTextCommands && skillCommands.length > 0
      ? resolveSkillCommandInvocation({
          commandBodyNormalized: command.commandBodyNormalized,
          skillCommands,
        })
      : null;
  const explicitSkillReference = allowTextCommands
    ? parseExplicitSkillCommandReference(command.commandBodyNormalized)
    : null;
  const explicitSkillRequest = skillInvocation
    ? {
        skillName: skillInvocation.command.skillName,
        commandName: skillInvocation.command.name,
        args: skillInvocation.args,
        dispatch: skillInvocation.command.dispatch,
      }
    : explicitSkillReference
      ? {
          skillName: explicitSkillReference.requestedName,
          commandName: "skill",
          args: explicitSkillReference.args,
        }
      : null;
  if (explicitSkillRequest) {
    if (!command.isAuthorizedSender) {
      logVerbose(
        `Ignoring /${explicitSkillRequest.commandName} from unauthorized sender: ${command.senderId || "<unknown>"}`,
      );
      typing.cleanup();
      return { kind: "reply", reply: undefined };
    }

    const runtimeState = getOrCreateSkillRuntimeState(sessionCtx.SkillRuntimeState);
    sessionCtx.SkillRuntimeState = runtimeState;
    const routedSkill = await routeExplicitSkillInvocation({
      workspaceDir,
      config: cfg,
      state: runtimeState,
      skillName: explicitSkillRequest.skillName,
      commandName: explicitSkillRequest.commandName,
    });
    if (!routedSkill.ok) {
      typing.cleanup();
      return { kind: "reply", reply: { text: `❌ ${routedSkill.message}` } };
    }

    const dispatch = explicitSkillRequest.dispatch;
    if (dispatch?.kind === "tool") {
      const rawArgs = (explicitSkillRequest.args ?? "").trim();
      const channel =
        resolveGatewayMessageChannel(ctx.Surface) ??
        resolveGatewayMessageChannel(ctx.Provider) ??
        undefined;

      const tools = createOpenClawTools({
        agentSessionKey: sessionKey,
        agentChannel: channel,
        agentAccountId: (ctx as { AccountId?: string }).AccountId,
        agentTo: ctx.OriginatingTo ?? ctx.To,
        agentThreadId: ctx.MessageThreadId ?? undefined,
        agentDir,
        workspaceDir,
        config: cfg,
      });

      const tool = tools.find((candidate) => candidate.name === dispatch.toolName);
      if (!tool) {
        typing.cleanup();
        return { kind: "reply", reply: { text: `❌ Tool not available: ${dispatch.toolName}` } };
      }

      const policy = await enforceSkillDispatchPolicy({
        workspaceDir,
        skillName: routedSkill.record.skillName,
        toolName: dispatch.toolName,
        rawArgs,
        config: cfg,
      });
      if (!policy.ok) {
        typing.cleanup();
        return { kind: "reply", reply: { text: `❌ ${policy.reason}` } };
      }

      const safeArgs = (policy.normalizedArgs ?? rawArgs).trim();
      const execStartedAt = Date.now();
      const toolCallId = `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      markSkillInvocationLifecycle({
        state: runtimeState,
        skillName: routedSkill.record.skillName,
        lifecycle: "running",
      });
      try {
        const result = await tool.execute(toolCallId, {
          command: safeArgs,
          commandName: explicitSkillRequest.commandName,
          skillName: routedSkill.record.skillName,
          // oxlint-disable-next-line typescript/no-explicit-any
        } as any);
        markSkillInvocationLifecycle({
          state: runtimeState,
          skillName: routedSkill.record.skillName,
          lifecycle: "completed",
        });
        processSkillFactoryEpisodeDetached({
          agentId,
          workspaceDir,
          config: cfg,
          sessionKey,
          source: "skill-command",
          prompt: `/${explicitSkillRequest.commandName} ${safeArgs}`.trim(),
          taskTitle: routedSkill.record.skillName,
          toolNames: [dispatch.toolName],
          startedAt: execStartedAt,
          endedAt: Date.now(),
          provider,
          model,
          outcome: "success",
          generatedSkillKey: routedSkill.record.skillName,
        });
        const text = extractTextFromToolResult(result) ?? "✅ Done.";
        typing.cleanup();
        return { kind: "reply", reply: { text } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markSkillInvocationLifecycle({
          state: runtimeState,
          skillName: routedSkill.record.skillName,
          lifecycle: "error",
          error: message,
        });
        processSkillFactoryEpisodeDetached({
          agentId,
          workspaceDir,
          config: cfg,
          sessionKey,
          source: "skill-command",
          prompt: `/${explicitSkillRequest.commandName} ${safeArgs}`.trim(),
          taskTitle: routedSkill.record.skillName,
          toolNames: [dispatch.toolName],
          startedAt: execStartedAt,
          endedAt: Date.now(),
          provider,
          model,
          outcome: "error",
          errorKind: "tool_error",
          errorMessage: message,
          generatedSkillKey: routedSkill.record.skillName,
        });
        typing.cleanup();
        return { kind: "reply", reply: { text: `❌ ${message}` } };
      }
    }

    const alreadyInjected =
      typeof sessionCtx.InjectedSystemPrompt === "string" &&
      sessionCtx.InjectedSystemPrompt.includes(`<loaded_skill id="${routedSkill.record.id}"`);
    if (!alreadyInjected && routedSkill.record.loadedPrompt) {
      sessionCtx.InjectedSystemPrompt = [
        sessionCtx.InjectedSystemPrompt,
        routedSkill.record.loadedPrompt,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    const promptParts = [
      `The runtime already loaded the explicitly requested skill "${routedSkill.record.skillName}".`,
      explicitSkillRequest.args
        ? `User input:\n${explicitSkillRequest.args}`
        : "The user did not provide additional input beyond invoking the skill.",
    ].filter((entry): entry is string => Boolean(entry));
    const rewrittenBody = promptParts.join("\n\n");
    ctx.Body = rewrittenBody;
    ctx.BodyForAgent = rewrittenBody;
    sessionCtx.Body = rewrittenBody;
    sessionCtx.BodyForAgent = rewrittenBody;
    sessionCtx.BodyStripped = rewrittenBody;
    cleanedBody = rewrittenBody;
  }

  const sendInlineReply = async (reply?: ReplyPayload) => {
    if (!reply) {
      return;
    }
    if (!opts?.onBlockReply) {
      return;
    }
    await opts.onBlockReply(reply);
  };

  const inlineCommand =
    allowTextCommands && command.isAuthorizedSender
      ? extractInlineSimpleCommand(cleanedBody)
      : null;
  if (inlineCommand) {
    cleanedBody = inlineCommand.cleaned;
    sessionCtx.Body = cleanedBody;
    sessionCtx.BodyForAgent = cleanedBody;
    sessionCtx.BodyStripped = cleanedBody;
  }

  const handleInlineStatus =
    !isDirectiveOnly({
      directives,
      cleanedBody: directives.cleaned,
      ctx,
      cfg,
      agentId,
      isGroup,
    }) && inlineStatusRequested;
  if (handleInlineStatus) {
    const inlineStatusReply = await buildStatusReply({
      cfg,
      command,
      sessionEntry,
      sessionKey,
      sessionScope,
      provider,
      model,
      contextTokens,
      resolvedThinkLevel,
      resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
      resolvedReasoningLevel,
      resolvedElevatedLevel,
      resolveDefaultThinkingLevel,
      isGroup,
      defaultGroupActivation: defaultActivation,
      mediaDecisions: ctx.MediaUnderstandingDecisions,
    });
    await sendInlineReply(inlineStatusReply);
    directives = { ...directives, hasStatusDirective: false };
  }

  if (inlineCommand) {
    const inlineCommandContext = {
      ...command,
      rawBodyNormalized: inlineCommand.command,
      commandBodyNormalized: inlineCommand.command,
    };
    const inlineResult = await handleCommands({
      ctx,
      cfg,
      command: inlineCommandContext,
      agentId,
      directives,
      elevated: {
        enabled: elevatedEnabled,
        allowed: elevatedAllowed,
        failures: elevatedFailures,
      },
      sessionEntry,
      previousSessionEntry,
      sessionStore,
      sessionKey,
      storePath,
      sessionScope,
      workspaceDir,
      defaultGroupActivation: defaultActivation,
      resolvedThinkLevel,
      resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
      resolvedReasoningLevel,
      resolvedElevatedLevel,
      resolveDefaultThinkingLevel,
      provider,
      model,
      contextTokens,
      isGroup,
      skillCommands,
    });
    if (inlineResult.reply) {
      if (!inlineCommand.cleaned) {
        typing.cleanup();
        return { kind: "reply", reply: inlineResult.reply };
      }
      await sendInlineReply(inlineResult.reply);
    }
  }

  if (directiveAck) {
    await sendInlineReply(directiveAck);
  }

  const isEmptyConfig = Object.keys(cfg).length === 0;
  const skipWhenConfigEmpty = command.channelId
    ? Boolean(getChannelDock(command.channelId)?.commands?.skipWhenConfigEmpty)
    : false;
  if (
    skipWhenConfigEmpty &&
    isEmptyConfig &&
    command.from &&
    command.to &&
    command.from !== command.to
  ) {
    typing.cleanup();
    return { kind: "reply", reply: undefined };
  }

  let abortedLastRun = initialAbortedLastRun;
  if (!sessionEntry && command.abortKey) {
    abortedLastRun = getAbortMemory(command.abortKey) ?? false;
  }

  const commandResult = await handleCommands({
    ctx,
    cfg,
    command,
    agentId,
    directives,
    elevated: {
      enabled: elevatedEnabled,
      allowed: elevatedAllowed,
      failures: elevatedFailures,
    },
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    defaultGroupActivation: defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    isGroup,
    skillCommands,
  });
  if (!commandResult.shouldContinue) {
    typing.cleanup();
    return { kind: "reply", reply: commandResult.reply };
  }

  return {
    kind: "continue",
    directives,
    abortedLastRun,
  };
}
