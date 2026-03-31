import crypto from "node:crypto";
import type { MsgContext } from "../../auto-reply/templating.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  normalizeThinkLevel,
  normalizeVerboseLevel,
  type ThinkLevel,
  type VerboseLevel,
} from "../../auto-reply/thinking.js";
import {
  classifySessionWorkspaceMatch,
  evaluateSessionFreshness,
  formatSessionWorkspaceSummary,
  loadSessionStore,
  type SessionWorkspaceFingerprint,
  type SessionWorkspaceRelation,
  resolveAgentIdFromSessionKey,
  resolveChannelResetConfig,
  resolveExplicitAgentSessionKey,
  resolveSessionResetPolicy,
  resolveSessionResetType,
  resolveSessionKey,
  resolveStorePath,
  type SessionEntry,
} from "../../config/sessions.js";
import { normalizeMainKey } from "../../routing/session-key.js";

export type SessionResolution = {
  sessionId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath: string;
  isNewSession: boolean;
  persistedThinking?: ThinkLevel;
  persistedVerbose?: VerboseLevel;
  resumeNotice?: string;
  workspaceRelation?: SessionWorkspaceRelation;
};

type SessionKeyResolution = {
  sessionKey?: string;
  sessionStore: Record<string, SessionEntry>;
  storePath: string;
};

export function resolveSessionKeyForRequest(opts: {
  cfg: OpenClawConfig;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
}): SessionKeyResolution {
  const sessionCfg = opts.cfg.session;
  const scope = sessionCfg?.scope ?? "per-sender";
  const mainKey = normalizeMainKey(sessionCfg?.mainKey);
  const explicitSessionKey =
    opts.sessionKey?.trim() ||
    resolveExplicitAgentSessionKey({
      cfg: opts.cfg,
      agentId: opts.agentId,
    });
  const storeAgentId = resolveAgentIdFromSessionKey(explicitSessionKey);
  const storePath = resolveStorePath(sessionCfg?.store, {
    agentId: storeAgentId,
  });
  const sessionStore = loadSessionStore(storePath);

  const ctx: MsgContext | undefined = opts.to?.trim() ? { From: opts.to } : undefined;
  let sessionKey: string | undefined =
    explicitSessionKey ?? (ctx ? resolveSessionKey(scope, ctx, mainKey) : undefined);

  // If a session id was provided, prefer to re-use its entry (by id) even when no key was derived.
  if (
    !explicitSessionKey &&
    opts.sessionId &&
    (!sessionKey || sessionStore[sessionKey]?.sessionId !== opts.sessionId)
  ) {
    const foundKey = Object.keys(sessionStore).find(
      (key) => sessionStore[key]?.sessionId === opts.sessionId,
    );
    if (foundKey) {
      sessionKey = foundKey;
    }
  }

  return { sessionKey, sessionStore, storePath };
}

export function resolveSession(opts: {
  cfg: OpenClawConfig;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  workspaceFingerprint?: SessionWorkspaceFingerprint;
}): SessionResolution {
  const sessionCfg = opts.cfg.session;
  const { sessionKey, sessionStore, storePath } = resolveSessionKeyForRequest({
    cfg: opts.cfg,
    to: opts.to,
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
    agentId: opts.agentId,
  });
  const now = Date.now();
  const explicitSessionSelector = Boolean(opts.sessionId?.trim() || opts.sessionKey?.trim());

  const storedSessionEntry = sessionKey ? sessionStore[sessionKey] : undefined;
  const workspaceMatch = classifySessionWorkspaceMatch({
    current: opts.workspaceFingerprint,
    stored: storedSessionEntry?.workspaceFingerprint,
  });
  const storedWorkspaceSummary = formatSessionWorkspaceSummary(
    storedSessionEntry?.workspaceFingerprint,
  );
  const currentWorkspaceSummary = formatSessionWorkspaceSummary(opts.workspaceFingerprint);

  let sessionEntry = storedSessionEntry;
  let resumeNotice: string | undefined;
  if (storedSessionEntry) {
    if (workspaceMatch.relation === "different") {
      const detail = [
        `Stored: ${storedWorkspaceSummary}`,
        `Current: ${currentWorkspaceSummary}`,
      ].join("\n");
      if (explicitSessionSelector) {
        throw new Error(
          [
            `Refusing to resume session "${storedSessionEntry.sessionId}" from a different workspace.`,
            detail,
            "Run the command from the original workspace, or start a fresh session in the current workspace.",
          ].join("\n"),
        );
      }
      sessionEntry = undefined;
      resumeNotice = [
        "Starting a fresh session because the previous session belongs to a different workspace.",
        detail,
      ].join("\n");
    } else if (workspaceMatch.relation === "same_repo") {
      resumeNotice = [
        "Resuming a session from the same repository but a different workspace or worktree.",
        `Stored: ${storedWorkspaceSummary}`,
        `Current: ${currentWorkspaceSummary}`,
      ].join("\n");
    }
  }

  const resetType = resolveSessionResetType({ sessionKey });
  const channelReset = resolveChannelResetConfig({
    sessionCfg,
    channel: sessionEntry?.lastChannel ?? sessionEntry?.channel,
  });
  const resetPolicy = resolveSessionResetPolicy({
    sessionCfg,
    resetType,
    resetOverride: channelReset,
  });
  const fresh = sessionEntry
    ? evaluateSessionFreshness({ updatedAt: sessionEntry.updatedAt, now, policy: resetPolicy })
        .fresh
    : false;
  const sessionId =
    opts.sessionId?.trim() || (fresh ? sessionEntry?.sessionId : undefined) || crypto.randomUUID();
  const isNewSession = !fresh && !opts.sessionId;

  const persistedThinking =
    fresh && sessionEntry?.thinkingLevel
      ? normalizeThinkLevel(sessionEntry.thinkingLevel)
      : undefined;
  const persistedVerbose =
    fresh && sessionEntry?.verboseLevel
      ? normalizeVerboseLevel(sessionEntry.verboseLevel)
      : undefined;

  return {
    sessionId,
    sessionKey,
    sessionEntry,
    sessionStore,
    storePath,
    isNewSession,
    persistedThinking,
    persistedVerbose,
    resumeNotice,
    workspaceRelation: workspaceMatch.relation,
  };
}
