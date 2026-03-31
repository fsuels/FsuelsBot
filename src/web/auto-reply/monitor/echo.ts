export type EchoTracker = {
  rememberText: (
    text: string | undefined,
    opts: {
      combinedBody?: string;
      combinedBodySessionKey?: string;
      logVerboseMessage?: boolean;
    },
  ) => void;
  rememberMessageIds: (messageIds: Array<string | undefined>) => void;
  has: (key: string) => boolean;
  hasMessageId: (messageId: string | undefined) => boolean;
  forget: (key: string) => void;
  buildCombinedKey: (params: { sessionKey: string; combinedBody: string }) => string;
};

export function createEchoTracker(params: {
  maxItems?: number;
  logVerbose?: (msg: string) => void;
}): EchoTracker {
  const recentlySent = new Set<string>();
  const recentMessageIds = new Set<string>();
  const maxItems = Math.max(1, params.maxItems ?? 100);

  const buildCombinedKey = (p: { sessionKey: string; combinedBody: string }) =>
    `combined:${p.sessionKey}:${p.combinedBody}`;

  const trim = (entries: Set<string>) => {
    while (entries.size > maxItems) {
      const firstKey = entries.values().next().value;
      if (!firstKey) {
        break;
      }
      entries.delete(firstKey);
    }
  };

  const rememberText: EchoTracker["rememberText"] = (text, opts) => {
    if (!text) {
      return;
    }
    recentlySent.add(text);
    if (opts.combinedBody && opts.combinedBodySessionKey) {
      recentlySent.add(
        buildCombinedKey({
          sessionKey: opts.combinedBodySessionKey,
          combinedBody: opts.combinedBody,
        }),
      );
    }
    if (opts.logVerboseMessage) {
      params.logVerbose?.(
        `Added to echo detection set (size now: ${recentlySent.size}): ${text.substring(0, 50)}...`,
      );
    }
    trim(recentlySent);
  };

  return {
    rememberText,
    rememberMessageIds: (messageIds) => {
      for (const rawMessageId of messageIds) {
        const messageId = rawMessageId?.trim();
        if (!messageId) {
          continue;
        }
        recentMessageIds.add(messageId);
      }
      trim(recentMessageIds);
    },
    has: (key) => recentlySent.has(key),
    hasMessageId: (messageId) => {
      const trimmed = messageId?.trim();
      if (!trimmed) {
        return false;
      }
      return recentMessageIds.has(trimmed);
    },
    forget: (key) => {
      recentlySent.delete(key);
    },
    buildCombinedKey,
  };
}
