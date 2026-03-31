import type { OpenClawConfig } from "../../config/config.js";
import type { InlineDirectives } from "./directive-handling.parse.js";
import type { ElevatedLevel, ReasoningLevel } from "./directives.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import {
  buildModelAliasIndex,
  type ModelAliasIndex,
  resolveDefaultModelForAgent,
} from "../../agents/model-selection.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { applyVerboseOverride } from "../../sessions/level-overrides.js";
import { formatElevatedEvent, formatReasoningEvent } from "./directive-handling.shared.js";
import { switchLmStudioModelIfNeeded } from "./lmstudio-switch.js";
import { type ModelDirectiveSelection } from "./model-selection.js";
import { applySessionModelSelectionTransition } from "./model-transition.js";

export async function persistInlineDirectives(params: {
  directives: InlineDirectives;
  effectiveModelDirective?: string;
  modelSelection?: ModelDirectiveSelection;
  profileOverride?: string;
  cfg: OpenClawConfig;
  agentDir?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  defaultProvider: string;
  defaultModel: string;
  aliasIndex: ModelAliasIndex;
  allowedModelKeys: Set<string>;
  provider: string;
  model: string;
  initialModelLabel: string;
  formatModelSwitchEvent: (label: string, alias?: string) => string;
  agentCfg: NonNullable<OpenClawConfig["agents"]>["defaults"] | undefined;
}): Promise<{ provider: string; model: string; contextTokens: number }> {
  const {
    directives,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    elevatedEnabled,
    elevatedAllowed,
    initialModelLabel,
    formatModelSwitchEvent,
    agentCfg,
  } = params;
  let { provider, model } = params;
  let pendingModelEvent:
    | { nextLabel: string; contextKey: string; alias?: string; provider: string; model: string }
    | undefined;

  if (sessionEntry && sessionStore && sessionKey) {
    const prevElevatedLevel =
      (sessionEntry.elevatedLevel as ElevatedLevel | undefined) ??
      (agentCfg?.elevatedDefault as ElevatedLevel | undefined) ??
      (elevatedAllowed ? ("on" as ElevatedLevel) : ("off" as ElevatedLevel));
    const prevReasoningLevel = (sessionEntry.reasoningLevel as ReasoningLevel | undefined) ?? "off";
    let elevatedChanged =
      directives.hasElevatedDirective &&
      directives.elevatedLevel !== undefined &&
      elevatedEnabled &&
      elevatedAllowed;
    let reasoningChanged =
      directives.hasReasoningDirective && directives.reasoningLevel !== undefined;
    let updated = false;

    if (directives.hasThinkDirective && directives.thinkLevel) {
      if (directives.thinkLevel === "off") {
        delete sessionEntry.thinkingLevel;
      } else {
        sessionEntry.thinkingLevel = directives.thinkLevel;
      }
      updated = true;
    }
    if (directives.hasVerboseDirective && directives.verboseLevel) {
      applyVerboseOverride(sessionEntry, directives.verboseLevel);
      updated = true;
    }
    if (directives.hasReasoningDirective && directives.reasoningLevel) {
      if (directives.reasoningLevel === "off") {
        delete sessionEntry.reasoningLevel;
      } else {
        sessionEntry.reasoningLevel = directives.reasoningLevel;
      }
      reasoningChanged =
        reasoningChanged ||
        (directives.reasoningLevel !== prevReasoningLevel &&
          directives.reasoningLevel !== undefined);
      updated = true;
    }
    if (
      directives.hasElevatedDirective &&
      directives.elevatedLevel &&
      elevatedEnabled &&
      elevatedAllowed
    ) {
      // Persist "off" explicitly so inline `/elevated off` overrides defaults.
      sessionEntry.elevatedLevel = directives.elevatedLevel;
      elevatedChanged =
        elevatedChanged ||
        (directives.elevatedLevel !== prevElevatedLevel && directives.elevatedLevel !== undefined);
      updated = true;
    }
    if (directives.hasExecDirective && directives.hasExecOptions) {
      if (directives.execHost) {
        sessionEntry.execHost = directives.execHost;
        updated = true;
      }
      if (directives.execSecurity) {
        sessionEntry.execSecurity = directives.execSecurity;
        updated = true;
      }
      if (directives.execAsk) {
        sessionEntry.execAsk = directives.execAsk;
        updated = true;
      }
      if (directives.execNode) {
        sessionEntry.execNode = directives.execNode;
        updated = true;
      }
    }

    const resolvedSelection =
      directives.hasModelDirective && params.effectiveModelDirective
        ? params.modelSelection
        : undefined;
    if (resolvedSelection) {
      const transition = applySessionModelSelectionTransition({
        entry: sessionEntry,
        selection: resolvedSelection,
        profileOverride: params.profileOverride,
        currentProvider: provider,
        currentModel: model,
      });
      provider = transition.provider;
      model = transition.model;
      if (transition.modelChanged && transition.nextLabel !== initialModelLabel) {
        pendingModelEvent = {
          nextLabel: transition.nextLabel,
          contextKey: `model:${transition.nextLabel}`,
          alias: resolvedSelection.alias,
          provider: transition.provider,
          model: transition.model,
        };
      }
      updated = updated || transition.updated;
    }
    if (directives.hasQueueDirective && directives.queueReset) {
      delete sessionEntry.queueMode;
      delete sessionEntry.queueDebounceMs;
      delete sessionEntry.queueCap;
      delete sessionEntry.queueDrop;
      updated = true;
    } else if (directives.hasQueueDirective) {
      if (directives.queueMode) {
        sessionEntry.queueMode = directives.queueMode;
        updated = true;
      }
      if (typeof directives.debounceMs === "number") {
        sessionEntry.queueDebounceMs = directives.debounceMs;
        updated = true;
      }
      if (typeof directives.cap === "number") {
        sessionEntry.queueCap = directives.cap;
        updated = true;
      }
      if (directives.dropPolicy) {
        sessionEntry.queueDrop = directives.dropPolicy;
        updated = true;
      }
    }

    if (updated) {
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[sessionKey] = sessionEntry;
        });
      }
      if (pendingModelEvent) {
        if (pendingModelEvent.provider === "lmstudio") {
          switchLmStudioModelIfNeeded(pendingModelEvent.model);
        }
        enqueueSystemEvent(
          formatModelSwitchEvent(pendingModelEvent.nextLabel, pendingModelEvent.alias),
          {
            sessionKey,
            contextKey: pendingModelEvent.contextKey,
          },
        );
      }
      if (elevatedChanged) {
        const nextElevated = (sessionEntry.elevatedLevel ?? "off") as ElevatedLevel;
        enqueueSystemEvent(formatElevatedEvent(nextElevated), {
          sessionKey,
          contextKey: "mode:elevated",
        });
      }
      if (reasoningChanged) {
        const nextReasoning = (sessionEntry.reasoningLevel ?? "off") as ReasoningLevel;
        enqueueSystemEvent(formatReasoningEvent(nextReasoning), {
          sessionKey,
          contextKey: "mode:reasoning",
        });
      }
    }
  }

  return {
    provider,
    model,
    contextTokens: agentCfg?.contextTokens ?? lookupContextTokens(model) ?? DEFAULT_CONTEXT_TOKENS,
  };
}

export function resolveDefaultModel(params: { cfg: OpenClawConfig; agentId?: string }): {
  defaultProvider: string;
  defaultModel: string;
  aliasIndex: ModelAliasIndex;
} {
  const mainModel = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const defaultProvider = mainModel.provider;
  const defaultModel = mainModel.model;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider,
  });
  return { defaultProvider, defaultModel, aliasIndex };
}
