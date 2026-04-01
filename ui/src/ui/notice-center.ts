export type AgentReaction = {
  text: string;
  createdAt: number;
  ttlMs: number;
  channel: "observer" | "system" | "tool";
  style: "idle" | "success" | "warning" | "error";
};

export type NoticeLevel = "info" | "success" | "warning" | "error";

export type Notice = {
  key: string;
  text: string;
  level: NoticeLevel;
  ttlMs: number;
  createdAt?: number;
  invalidates?: string[];
  detail?: string;
  scope?: string;
  channel?: AgentReaction["channel"];
  count?: number;
  diagnosticKey?: string;
  stickyDiagnostic?: boolean;
  fold?: (existing: Notice, incoming: Notice) => Notice;
};

export type RuntimeDiagnostic = {
  key: string;
  title: string;
  detail?: string;
  level: NoticeLevel;
  scope: string;
  active: boolean;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

type ActiveNotice = Notice & {
  createdAt: number;
  expiresAt: number;
  fingerprint: string;
  scope: string;
  channel: AgentReaction["channel"];
  diagnosticKey?: string;
  stickyDiagnostic: boolean;
};

type HealthNoticeState = "never_connected" | "connected" | "failed" | "needs_auth" | "degraded";

export type NoticeCenterState = {
  activeByKey: Map<string, ActiveNotice>;
  healthLastStateByKey: Map<string, HealthNoticeState>;
  healthEverConnected: Record<string, boolean>;
  healthHintGraceUntilMs: number;
};

export type NoticeCenterHost = {
  chatReaction: AgentReaction | null;
  chatReactionClearTimer: number | null;
  noticeCenterState: NoticeCenterState;
  runtimeDiagnostics: RuntimeDiagnostic[];
  runtimeDiagnosticsByKey: Map<string, RuntimeDiagnostic>;
};

const HEALTH_PERSISTENCE_KEY = "openclaw.control.notice-center.v1";
const DEFAULT_HEALTH_HINT_GRACE_MS = 15_000;

function readHealthPersistence(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(HEALTH_PERSISTENCE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as { everConnected?: Record<string, boolean> };
    return parsed?.everConnected && typeof parsed.everConnected === "object"
      ? parsed.everConnected
      : {};
  } catch {
    return {};
  }
}

function writeHealthPersistence(everConnected: Record<string, boolean>) {
  try {
    localStorage.setItem(
      HEALTH_PERSISTENCE_KEY,
      JSON.stringify({
        everConnected,
      }),
    );
  } catch {
    // ignore storage failures
  }
}

export function createNoticeCenterState(params?: {
  now?: number;
  healthHintGraceMs?: number;
  everConnected?: Record<string, boolean>;
}): NoticeCenterState {
  const now = params?.now ?? Date.now();
  return {
    activeByKey: new Map(),
    healthLastStateByKey: new Map(),
    healthEverConnected: { ...(params?.everConnected ?? readHealthPersistence()) },
    healthHintGraceUntilMs: now + (params?.healthHintGraceMs ?? DEFAULT_HEALTH_HINT_GRACE_MS),
  };
}

function ensureHostState(host: Partial<NoticeCenterHost>): NoticeCenterHost {
  const nextHost = host as NoticeCenterHost;
  if (!nextHost.noticeCenterState) {
    nextHost.noticeCenterState = createNoticeCenterState();
  }
  if (!nextHost.runtimeDiagnosticsByKey) {
    nextHost.runtimeDiagnosticsByKey = new Map();
  }
  if (!Array.isArray(nextHost.runtimeDiagnostics)) {
    nextHost.runtimeDiagnostics = [];
  }
  if (nextHost.chatReaction === undefined) {
    nextHost.chatReaction = null;
  }
  if (nextHost.chatReactionClearTimer === undefined) {
    nextHost.chatReactionClearTimer = null;
  }
  return nextHost;
}

function noticeFingerprint(notice: Notice): string {
  const invalidates = [...(notice.invalidates ?? [])].toSorted();
  return JSON.stringify({
    level: notice.level,
    text: notice.text,
    detail: notice.detail,
    invalidates,
    count: notice.count ?? 1,
  });
}

function reactionStyle(level: NoticeLevel): AgentReaction["style"] {
  switch (level) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function toReaction(notice: ActiveNotice): AgentReaction {
  return {
    text: notice.text,
    createdAt: notice.createdAt,
    ttlMs: Math.max(0, notice.expiresAt - notice.createdAt),
    channel: notice.channel,
    style: reactionStyle(notice.level),
  };
}

function syncDiagnostics(host: NoticeCenterHost) {
  host.runtimeDiagnostics = [...host.runtimeDiagnosticsByKey.values()].toSorted((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    return right.lastSeenAt - left.lastSeenAt;
  });
}

function upsertDiagnostic(
  host: NoticeCenterHost,
  input: {
    key: string;
    title: string;
    detail?: string;
    level: NoticeLevel;
    scope: string;
    active: boolean;
    now: number;
  },
) {
  const existing = host.runtimeDiagnosticsByKey.get(input.key);
  if (existing) {
    existing.title = input.title;
    existing.detail = input.detail;
    existing.level = input.level;
    existing.scope = input.scope;
    existing.active = input.active;
    existing.count += 1;
    existing.lastSeenAt = input.now;
  } else {
    host.runtimeDiagnosticsByKey.set(input.key, {
      key: input.key,
      title: input.title,
      detail: input.detail,
      level: input.level,
      scope: input.scope,
      active: input.active,
      count: 1,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
    });
  }
  syncDiagnostics(host);
}

function markDiagnosticInactive(host: NoticeCenterHost, key: string, now: number) {
  const existing = host.runtimeDiagnosticsByKey.get(key);
  if (!existing) {
    return;
  }
  existing.active = false;
  existing.lastSeenAt = now;
  syncDiagnostics(host);
}

function removeNotice(host: NoticeCenterHost, key: string, now: number) {
  const existing = host.noticeCenterState.activeByKey.get(key);
  if (!existing) {
    return;
  }
  host.noticeCenterState.activeByKey.delete(key);
  if (existing.diagnosticKey && !existing.stickyDiagnostic) {
    markDiagnosticInactive(host, existing.diagnosticKey, now);
  }
}

function pruneExpiredNotices(host: NoticeCenterHost, now: number) {
  for (const [key, notice] of host.noticeCenterState.activeByKey) {
    if (notice.expiresAt > now) {
      continue;
    }
    removeNotice(host, key, now);
  }
}

function clearReactionTimer(host: NoticeCenterHost) {
  if (host.chatReactionClearTimer == null) {
    return;
  }
  window.clearTimeout(host.chatReactionClearTimer);
  host.chatReactionClearTimer = null;
}

function syncDisplayedReaction(host: NoticeCenterHost, now: number) {
  pruneExpiredNotices(host, now);
  clearReactionTimer(host);
  const active = [...host.noticeCenterState.activeByKey.values()].toSorted(
    (left, right) => right.createdAt - left.createdAt,
  );
  const current = active[0];
  host.chatReaction = current ? toReaction(current) : null;
  const nextExpiry = active.reduce<number | null>((soonest, notice) => {
    if (soonest == null) {
      return notice.expiresAt;
    }
    return Math.min(soonest, notice.expiresAt);
  }, null);
  if (nextExpiry == null) {
    return;
  }
  host.chatReactionClearTimer = window.setTimeout(
    () => syncDisplayedReaction(host, Date.now()),
    Math.max(0, nextExpiry - now),
  );
}

export function dismissNoticeKeys(host: NoticeCenterHost, keys: string[], now = Date.now()) {
  host = ensureHostState(host);
  for (const key of keys) {
    removeNotice(host, key, now);
  }
  syncDisplayedReaction(host, now);
}

export function dismissNoticesByScope(host: NoticeCenterHost, scope: string, now = Date.now()) {
  host = ensureHostState(host);
  const keys = [...host.noticeCenterState.activeByKey.values()]
    .filter((notice) => notice.scope === scope)
    .map((notice) => notice.key);
  dismissNoticeKeys(host, keys, now);
}

export function publishNotices(host: NoticeCenterHost, notices: Notice[], now = Date.now()) {
  host = ensureHostState(host);
  for (const notice of notices) {
    publishNotice(host, notice, now);
  }
}

export function publishNotice(host: NoticeCenterHost, notice: Notice, now = Date.now()) {
  host = ensureHostState(host);
  for (const key of notice.invalidates ?? []) {
    removeNotice(host, key, now);
  }

  const existing = host.noticeCenterState.activeByKey.get(notice.key);
  const baseCreatedAt = notice.createdAt ?? now;
  const nextNotice =
    existing && notice.fold
      ? notice.fold(
          {
            ...existing,
            ttlMs: Math.max(0, existing.expiresAt - existing.createdAt),
          },
          { ...notice, createdAt: baseCreatedAt },
        )
      : { ...notice, createdAt: baseCreatedAt };
  const fingerprint = noticeFingerprint(nextNotice);
  const diagnosticKey = nextNotice.diagnosticKey;
  const scope = nextNotice.scope ?? "system";
  const stickyDiagnostic = nextNotice.stickyDiagnostic === true;

  if (diagnosticKey) {
    upsertDiagnostic(host, {
      key: diagnosticKey,
      title: nextNotice.text,
      detail: nextNotice.detail,
      level: nextNotice.level,
      scope,
      active: true,
      now,
    });
  }

  if (existing && !notice.fold && existing.fingerprint === fingerprint) {
    syncDisplayedReaction(host, now);
    return;
  }

  host.noticeCenterState.activeByKey.set(nextNotice.key, {
    ...nextNotice,
    createdAt: nextNotice.createdAt ?? now,
    expiresAt: (nextNotice.createdAt ?? now) + Math.max(0, nextNotice.ttlMs),
    fingerprint,
    scope,
    channel: nextNotice.channel ?? "system",
    diagnosticKey,
    stickyDiagnostic,
  });
  syncDisplayedReaction(host, now);
}

export function beginHealthNoticeGrace(host: NoticeCenterHost, now = Date.now()) {
  host = ensureHostState(host);
  host.noticeCenterState.healthHintGraceUntilMs = now + DEFAULT_HEALTH_HINT_GRACE_MS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatHealthLabel(channelLabel: string, accountId: string): string {
  return accountId && accountId !== "default" ? `${channelLabel} (${accountId})` : channelLabel;
}

function healthDiagnosticDetail(account: Record<string, unknown>): string | undefined {
  const probe = asRecord(account.probe);
  const status = typeof probe?.status === "number" ? probe.status : undefined;
  const error = typeof probe?.error === "string" ? probe.error.trim() : "";
  if (error && status) {
    return `HTTP ${status}: ${error}`;
  }
  if (error) {
    return error;
  }
  if (status) {
    return `HTTP ${status}`;
  }
  if (account.linked === false) {
    return "The connector is configured but not linked/authenticated.";
  }
  if (account.configured === true) {
    return "The connector is configured but has not reported a successful health check yet.";
  }
  return undefined;
}

function resolveHealthState(account: Record<string, unknown>): {
  state: HealthNoticeState;
  title: string;
  level: NoticeLevel;
} | null {
  const probe = asRecord(account.probe);
  const probeOk = typeof probe?.ok === "boolean" ? probe.ok : undefined;
  const probeStatus = typeof probe?.status === "number" ? probe.status : undefined;
  const probeError = typeof probe?.error === "string" ? probe.error.toLowerCase() : "";

  if (account.linked === false) {
    return {
      state: "needs_auth",
      title: "needs authentication",
      level: "warning",
    };
  }

  if (probeOk === true) {
    return {
      state: "connected",
      title: "connected",
      level: "success",
    };
  }

  if (
    probeOk === false &&
    (probeStatus === 401 ||
      probeStatus === 403 ||
      probeError.includes("unauthorized") ||
      probeError.includes("forbidden") ||
      probeError.includes("auth") ||
      probeError.includes("login") ||
      probeError.includes("token"))
  ) {
    return {
      state: "needs_auth",
      title: "needs authentication",
      level: "warning",
    };
  }

  if (probeOk === false) {
    return {
      state: "failed",
      title: "health check failed",
      level: "error",
    };
  }

  if (account.configured === true) {
    return {
      state: "never_connected",
      title: "has not connected yet",
      level: "info",
    };
  }

  return null;
}

function healthNoticeKeys(baseKey: string): string[] {
  return [
    `${baseKey}:connected`,
    `${baseKey}:failed`,
    `${baseKey}:needs_auth`,
    `${baseKey}:never_connected`,
    `${baseKey}:degraded`,
  ];
}

export function ingestHealthSnapshot(host: NoticeCenterHost, snapshot: unknown, now = Date.now()) {
  host = ensureHostState(host);
  const root = asRecord(snapshot);
  const channels = asRecord(root?.channels);
  const labels = asRecord(root?.channelLabels);
  if (!channels) {
    return;
  }

  for (const [channelId, channelValue] of Object.entries(channels)) {
    const channel = asRecord(channelValue);
    if (!channel) {
      continue;
    }
    const channelLabel =
      (typeof labels?.[channelId] === "string" && String(labels[channelId])) || channelId;
    const accounts = asRecord(channel.accounts);
    const accountEntries: Array<[string, unknown]> = accounts
      ? Object.entries(accounts)
      : [["default", channelValue]];

    for (const [entryAccountId, accountValue] of accountEntries) {
      const account = asRecord(accountValue);
      if (!account) {
        continue;
      }
      const accountId =
        typeof account.accountId === "string" && account.accountId.trim()
          ? account.accountId.trim()
          : entryAccountId;
      const baseKey = `health:${channelId}:${accountId}`;
      const label = formatHealthLabel(channelLabel, accountId);
      const resolved = resolveHealthState(account);
      if (!resolved) {
        continue;
      }

      const previousState = host.noticeCenterState.healthLastStateByKey.get(baseKey);
      const hasEverConnected = host.noticeCenterState.healthEverConnected[baseKey];
      const detail = healthDiagnosticDetail(account);

      if (resolved.state === "connected") {
        if (!hasEverConnected) {
          host.noticeCenterState.healthEverConnected[baseKey] = true;
          writeHealthPersistence(host.noticeCenterState.healthEverConnected);
        }
        host.noticeCenterState.healthLastStateByKey.set(baseKey, resolved.state);
        markDiagnosticInactive(host, baseKey, now);
        if (hasEverConnected && previousState && previousState !== "connected") {
          publishNotice(
            host,
            {
              key: `${baseKey}:connected`,
              text: `${label} recovered`,
              level: "success",
              ttlMs: 5_000,
              scope: "health",
              channel: "observer",
              invalidates: healthNoticeKeys(baseKey).filter(
                (key) => key !== `${baseKey}:connected`,
              ),
            },
            now,
          );
        } else {
          dismissNoticeKeys(
            host,
            healthNoticeKeys(baseKey).filter((key) => key !== `${baseKey}:connected`),
            now,
          );
        }
        continue;
      }

      const beyondGrace = now >= host.noticeCenterState.healthHintGraceUntilMs;
      const shouldTrackDiagnostic = resolved.state !== "never_connected" || beyondGrace;
      if (shouldTrackDiagnostic) {
        upsertDiagnostic(host, {
          key: baseKey,
          title: `${label} ${resolved.title}`,
          detail,
          level: resolved.level,
          scope: "health",
          active: true,
          now,
        });
      }

      const shouldAlert =
        resolved.state === "never_connected"
          ? false
          : hasEverConnected || previousState === "connected";
      if (shouldAlert && previousState !== resolved.state) {
        publishNotice(
          host,
          {
            key: `${baseKey}:${resolved.state}`,
            text: `${label} ${resolved.title}`,
            level: resolved.level,
            ttlMs: 7_000,
            scope: "health",
            channel: "observer",
            detail,
            invalidates: healthNoticeKeys(baseKey).filter(
              (key) => key !== `${baseKey}:${resolved.state}`,
            ),
          },
          now,
        );
      }
      host.noticeCenterState.healthLastStateByKey.set(baseKey, resolved.state);
    }
  }
}
