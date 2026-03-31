import { createSubsystemLogger } from "../logging/subsystem.js";

export type Capability = "browser" | "image" | "web_search";
export type CapabilityMode = "render" | "runtime";
export type CapabilityReasonCode =
  | "build_flag_off"
  | "expired_credentials"
  | "host_control_disabled"
  | "missing_configuration"
  | "missing_credentials"
  | "runtime_unavailable"
  | "sandbox_bridge_missing";

export type CapabilityAuthStatus = {
  ok: boolean;
  reason?: CapabilityReasonCode;
};

export type CapabilityStatus = {
  capability: Capability;
  visible: boolean;
  enabled: boolean;
  reasons: CapabilityReasonCode[];
  auth: CapabilityAuthStatus;
  cacheState?: "fresh" | "missing";
};

type CapabilityEvaluation = {
  visible: boolean;
  auth?: CapabilityAuthStatus;
  reasons?: CapabilityReasonCode[];
};

const log = createSubsystemLogger("agents/capabilities");
const RENDER_CACHE_TTL_MS = 5_000;
const BLOCK_LOG_TTL_MS = 30_000;

const renderCache = new Map<string, { expiresAt: number; status: CapabilityStatus }>();
const blockLogCache = new Map<string, number>();

function dedupeReasonCodes(codes: CapabilityReasonCode[]): CapabilityReasonCode[] {
  return Array.from(new Set(codes.filter(Boolean)));
}

function normalizeAuthStatus(auth?: CapabilityAuthStatus): CapabilityAuthStatus {
  if (!auth) {
    return { ok: true };
  }
  if (auth.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    ...(auth.reason ? { reason: auth.reason } : {}),
  };
}

function buildStatus(params: {
  capability: Capability;
  evaluation: CapabilityEvaluation;
  cacheState?: "fresh" | "missing";
}): CapabilityStatus {
  const auth = normalizeAuthStatus(params.evaluation.auth);
  const reasons = dedupeReasonCodes([
    ...(params.evaluation.reasons ?? []),
    ...(!auth.ok && auth.reason ? [auth.reason] : []),
  ]);
  return {
    capability: params.capability,
    visible: params.evaluation.visible,
    enabled: params.evaluation.visible && auth.ok,
    reasons,
    auth,
    ...(params.cacheState ? { cacheState: params.cacheState } : {}),
  };
}

export function getCapabilityAuthStatus(params?: CapabilityAuthStatus): CapabilityAuthStatus {
  return normalizeAuthStatus(params);
}

export function getCapabilityStatus(params: {
  capability: Capability;
  mode?: CapabilityMode;
  cacheKey?: string;
  evaluate: () => CapabilityEvaluation;
}): CapabilityStatus {
  const mode = params.mode ?? "render";
  const cacheKey =
    mode === "render" && params.cacheKey ? `${params.capability}:${params.cacheKey}` : undefined;
  const now = Date.now();

  if (cacheKey) {
    const cached = renderCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ...cached.status, cacheState: "fresh" };
    }
  }

  const status = buildStatus({
    capability: params.capability,
    evaluation: params.evaluate(),
    cacheState: cacheKey ? "missing" : undefined,
  });

  if (cacheKey) {
    renderCache.set(cacheKey, {
      expiresAt: now + RENDER_CACHE_TTL_MS,
      status: { ...status, cacheState: "fresh" },
    });
  }

  return status;
}

export function isCapabilityVisible(status: CapabilityStatus): boolean {
  return status.visible;
}

export function isCapabilityEnabled(status: CapabilityStatus): boolean {
  return status.enabled;
}

function defaultBlockedMessage(status: CapabilityStatus): string {
  const reason = status.reasons[0];
  if (reason === "build_flag_off") {
    return `${status.capability} is disabled by config.`;
  }
  if (reason === "missing_configuration") {
    return `${status.capability} is missing required configuration.`;
  }
  if (reason === "missing_credentials") {
    return `${status.capability} is missing required credentials.`;
  }
  if (reason === "expired_credentials") {
    return `${status.capability} credentials are expired.`;
  }
  if (reason === "host_control_disabled") {
    return "Host browser control is disabled by policy.";
  }
  if (reason === "sandbox_bridge_missing") {
    return "Sandbox browser bridge is unavailable.";
  }
  return `${status.capability} is unavailable in the current runtime.`;
}

export function buildCapabilityBlockedPayload(
  status: CapabilityStatus,
  options?: {
    message?: string;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    error: "capability_blocked",
    capability: status.capability,
    visible: status.visible,
    enabled: status.enabled,
    reasonCode: status.reasons[0] ?? "runtime_unavailable",
    reasons: status.reasons,
    message: options?.message?.trim() || defaultBlockedMessage(status),
    ...options?.extra,
  };
}

export function logCapabilityBlocked(
  status: CapabilityStatus,
  meta?: Record<string, unknown>,
): void {
  const key = `${status.capability}:${status.reasons.join(",")}:${JSON.stringify(meta ?? {})}`;
  const now = Date.now();
  const last = blockLogCache.get(key) ?? 0;
  if (now - last < BLOCK_LOG_TTL_MS) {
    return;
  }
  blockLogCache.set(key, now);
  log.warn("capability blocked", {
    capability: status.capability,
    reasonCode: status.reasons[0] ?? "runtime_unavailable",
    reasons: status.reasons,
    visible: status.visible,
    enabled: status.enabled,
    ...meta,
  });
}

export const __testing = {
  clearCapabilityGateCache() {
    renderCache.clear();
    blockLogCache.clear();
  },
} as const;
