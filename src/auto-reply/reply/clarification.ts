import type { TemplateContext } from "../templating.js";
import {
  buildClarificationModelInjection,
  parseClarificationResponse,
  resolvePendingClarification,
} from "../../agents/clarification.js";
import { loadSessionStore, type SessionEntry } from "../../config/sessions.js";

export async function resolveInboundClarification(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
  sessionCtx: TemplateContext;
}): Promise<{
  sessionEntry?: SessionEntry;
  injectedBody?: string;
}> {
  const pending = params.sessionEntry?.pendingClarification;
  if (!pending || !params.storePath) {
    return {
      sessionEntry: params.sessionEntry,
    };
  }

  const inboundBody =
    params.sessionCtx.BodyStripped ??
    params.sessionCtx.BodyForCommands ??
    params.sessionCtx.CommandBody ??
    params.sessionCtx.RawBody ??
    params.sessionCtx.Body ??
    "";
  const resolution = parseClarificationResponse({
    pending,
    message: inboundBody,
  });
  if (!resolution) {
    return {
      sessionEntry: params.sessionEntry,
    };
  }

  await resolvePendingClarification({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    pending,
    resolution,
  });

  const refreshedStore = loadSessionStore(params.storePath);
  if (params.sessionStore) {
    params.sessionStore[params.sessionKey] = refreshedStore[params.sessionKey];
  }
  const nextEntry = refreshedStore[params.sessionKey] ?? params.sessionEntry;
  const injection = buildClarificationModelInjection({
    pending,
    resolution,
  });
  const bodyLines = [
    injection.summary,
    "Treat this JSON as authoritative clarification state:",
    "```json",
    injection.json,
    "```",
  ];
  const originalReply = inboundBody.trim();
  if (originalReply && !originalReply.startsWith("clarify:")) {
    bodyLines.push("", "Original user reply:", originalReply);
  }

  return {
    sessionEntry: nextEntry,
    injectedBody: bodyLines.join("\n"),
  };
}
