import type { MoltbotConfig } from "../config/config.js";
import { z } from "zod";

export type DiagnosticSessionState = "idle" | "processing" | "waiting";
export const MEMORY_TURN_CONTROL_EVENT_VERSION = 1 as const;
export const MEMORY_GUIDANCE_EVENT_VERSION = 1 as const;
export const MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION = 1 as const;

type DiagnosticBaseEvent = {
  ts: number;
  seq: number;
};

export type DiagnosticUsageEvent = DiagnosticBaseEvent & {
  type: "model.usage";
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  provider?: string;
  model?: string;
  usage: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    promptTokens?: number;
    total?: number;
  };
  context?: {
    limit?: number;
    used?: number;
  };
  costUsd?: number;
  durationMs?: number;
};

export type DiagnosticWebhookReceivedEvent = DiagnosticBaseEvent & {
  type: "webhook.received";
  channel: string;
  updateType?: string;
  chatId?: number | string;
};

export type DiagnosticWebhookProcessedEvent = DiagnosticBaseEvent & {
  type: "webhook.processed";
  channel: string;
  updateType?: string;
  chatId?: number | string;
  durationMs?: number;
};

export type DiagnosticWebhookErrorEvent = DiagnosticBaseEvent & {
  type: "webhook.error";
  channel: string;
  updateType?: string;
  chatId?: number | string;
  error: string;
};

export type DiagnosticMessageQueuedEvent = DiagnosticBaseEvent & {
  type: "message.queued";
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  source: string;
  queueDepth?: number;
};

export type DiagnosticMessageProcessedEvent = DiagnosticBaseEvent & {
  type: "message.processed";
  channel: string;
  messageId?: number | string;
  chatId?: number | string;
  sessionKey?: string;
  sessionId?: string;
  durationMs?: number;
  outcome: "completed" | "skipped" | "error";
  reason?: string;
  error?: string;
};

export type DiagnosticSessionStateEvent = DiagnosticBaseEvent & {
  type: "session.state";
  sessionKey?: string;
  sessionId?: string;
  prevState?: DiagnosticSessionState;
  state: DiagnosticSessionState;
  reason?: string;
  queueDepth?: number;
};

export type DiagnosticSessionStuckEvent = DiagnosticBaseEvent & {
  type: "session.stuck";
  sessionKey?: string;
  sessionId?: string;
  state: DiagnosticSessionState;
  ageMs: number;
  queueDepth?: number;
};

export type DiagnosticLaneEnqueueEvent = DiagnosticBaseEvent & {
  type: "queue.lane.enqueue";
  lane: string;
  queueSize: number;
};

export type DiagnosticLaneDequeueEvent = DiagnosticBaseEvent & {
  type: "queue.lane.dequeue";
  lane: string;
  queueSize: number;
  waitMs: number;
};

export type DiagnosticRunAttemptEvent = DiagnosticBaseEvent & {
  type: "run.attempt";
  sessionKey?: string;
  sessionId?: string;
  runId: string;
  attempt: number;
};

export type DiagnosticHeartbeatEvent = DiagnosticBaseEvent & {
  type: "diagnostic.heartbeat";
  webhooks: {
    received: number;
    processed: number;
    errors: number;
  };
  active: number;
  waiting: number;
  queued: number;
};

export type DiagnosticMemoryGuidanceEvent = DiagnosticBaseEvent & {
  type: "memory.guidance";
  eventVersion: typeof MEMORY_GUIDANCE_EVENT_VERSION;
  sessionKey?: string;
  sessionId?: string;
  taskId?: string;
  mode: "supportive" | "minimal";
  shown: boolean;
  nudgeKind?: string;
  userSignal?: "explicit-task" | "none";
  inferredTaskId?: string;
  inferredTaskConfidence?: "low" | "medium" | "high";
  ambiguousCount?: number;
  hasConflict?: boolean;
};

export type DiagnosticMemoryGuidanceResponseEvent = DiagnosticBaseEvent & {
  type: "memory.guidance.response";
  eventVersion: typeof MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION;
  sessionKey?: string;
  sessionId?: string;
  taskId?: string;
  priorNudgeKind: string;
  response: "acknowledged" | "ignored";
  latencyMs?: number;
  userSignal?: "explicit-task" | "none";
};

export type DiagnosticMemoryTurnControlEvent = DiagnosticBaseEvent & {
  type: "memory.turn-control";
  eventVersion: typeof MEMORY_TURN_CONTROL_EVENT_VERSION;
  sessionKey?: string;
  sessionId?: string;
  activeTaskId?: string;
  inferredTaskId?: string;
  resolvedTaskId?: string;
  autoSwitchOptIn: boolean;
  autoSwitched: boolean;
  ambiguous: boolean;
  decisionMode: "ask" | "autoswitch" | "stay";
};

export type DiagnosticMemorySecurityEvent = DiagnosticBaseEvent & {
  type: "memory.security";
  severity: "ERROR" | "CRITICAL";
  code:
    | "invalid-security-mode"
    | "key-provider-failure"
    | "missing-signing-key"
    | "missing-verification-key"
    | "key-rotation-expired"
    | "unsupported-envelope-version"
    | "schema-validation-failure"
    | "verification-failure";
  mode?: "prod" | "dev";
  detail?: string;
  sessionKey?: string;
  sessionId?: string;
};

export type DiagnosticMemoryAlertEvent = DiagnosticBaseEvent & {
  type: "memory.alert";
  severity: "CRITICAL";
  category: "security";
  triggerCode: string;
  windowMs: number;
  threshold: number;
  criticalCount: number;
  breached: boolean;
};

export type DiagnosticMemoryRetrievalEvent = DiagnosticBaseEvent & {
  type: "memory.retrieval";
  sessionKey?: string;
  taskId?: string;
  namespace?: "auto" | "any" | "task" | "global";
  resultCount: number;
  configHash: string;
  embeddingModel: string;
  bm25ConfigVersion: string;
};

export type DiagnosticEventPayload =
  | DiagnosticUsageEvent
  | DiagnosticWebhookReceivedEvent
  | DiagnosticWebhookProcessedEvent
  | DiagnosticWebhookErrorEvent
  | DiagnosticMessageQueuedEvent
  | DiagnosticMessageProcessedEvent
  | DiagnosticSessionStateEvent
  | DiagnosticSessionStuckEvent
  | DiagnosticLaneEnqueueEvent
  | DiagnosticLaneDequeueEvent
  | DiagnosticRunAttemptEvent
  | DiagnosticHeartbeatEvent
  | DiagnosticMemoryGuidanceEvent
  | DiagnosticMemoryGuidanceResponseEvent
  | DiagnosticMemoryTurnControlEvent
  | DiagnosticMemorySecurityEvent
  | DiagnosticMemoryAlertEvent
  | DiagnosticMemoryRetrievalEvent;

export type DiagnosticEventInput = DiagnosticEventPayload extends infer Event
  ? Event extends DiagnosticEventPayload
    ? Omit<Event, "seq" | "ts">
    : never
  : never;

export const MemoryGuidanceDiagnosticEventSchema = z
  .object({
    type: z.literal("memory.guidance"),
    eventVersion: z.literal(MEMORY_GUIDANCE_EVENT_VERSION),
    ts: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    sessionKey: z.string().optional(),
    sessionId: z.string().optional(),
    taskId: z.string().optional(),
    mode: z.enum(["supportive", "minimal"]),
    shown: z.boolean(),
    nudgeKind: z.string().optional(),
    userSignal: z.enum(["explicit-task", "none"]).optional(),
    inferredTaskId: z.string().optional(),
    inferredTaskConfidence: z.enum(["low", "medium", "high"]).optional(),
    ambiguousCount: z.number().int().nonnegative().optional(),
    hasConflict: z.boolean().optional(),
  })
  .strict();

export const MemoryGuidanceResponseDiagnosticEventSchema = z
  .object({
    type: z.literal("memory.guidance.response"),
    eventVersion: z.literal(MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION),
    ts: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    sessionKey: z.string().optional(),
    sessionId: z.string().optional(),
    taskId: z.string().optional(),
    priorNudgeKind: z.string(),
    response: z.enum(["acknowledged", "ignored"]),
    latencyMs: z.number().int().nonnegative().optional(),
    userSignal: z.enum(["explicit-task", "none"]).optional(),
  })
  .strict();

export const MemoryTurnControlDiagnosticEventSchema = z
  .object({
    type: z.literal("memory.turn-control"),
    eventVersion: z.literal(MEMORY_TURN_CONTROL_EVENT_VERSION),
    ts: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    sessionKey: z.string().optional(),
    sessionId: z.string().optional(),
    activeTaskId: z.string().optional(),
    inferredTaskId: z.string().optional(),
    resolvedTaskId: z.string().optional(),
    autoSwitchOptIn: z.boolean(),
    autoSwitched: z.boolean(),
    ambiguous: z.boolean(),
    decisionMode: z.enum(["ask", "autoswitch", "stay"]),
  })
  .strict();

export const MemoryRetrievalDiagnosticEventSchema = z
  .object({
    type: z.literal("memory.retrieval"),
    ts: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    sessionKey: z.string().optional(),
    taskId: z.string().optional(),
    namespace: z.enum(["auto", "any", "task", "global"]).optional(),
    resultCount: z.number().int().nonnegative(),
    configHash: z.string().min(1),
    embeddingModel: z.string().min(1),
    bm25ConfigVersion: z.string().min(1),
  })
  .strict();

export const MemoryAlertDiagnosticEventSchema = z
  .object({
    type: z.literal("memory.alert"),
    ts: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    severity: z.literal("CRITICAL"),
    category: z.literal("security"),
    triggerCode: z.string().min(1),
    windowMs: z.number().int().positive(),
    threshold: z.number().int().positive(),
    criticalCount: z.number().int().nonnegative(),
    breached: z.boolean(),
  })
  .strict();

let seq = 0;
const listeners = new Set<(evt: DiagnosticEventPayload) => void>();
const memoryCriticalSecurityTimestamps: number[] = [];

function normalizeTransportNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function waitForTransportRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableTransportStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postAlertTransport(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  attempts: number,
  backoffMs: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      if (response.ok) return;
      if (!isRetryableTransportStatus(response.status) || attempt >= attempts) return;
    } catch {
      if (attempt >= attempts) return;
    } finally {
      clearTimeout(timer);
    }
    await waitForTransportRetry(backoffMs * attempt);
  }
}

async function dispatchMemoryAlertTransport(alert: DiagnosticMemoryAlertEvent): Promise<void> {
  if (!alert.breached) return;
  const timeoutMs = normalizeTransportNumber(
    process.env.MEMORY_ALERT_WEBHOOK_TIMEOUT_MS,
    5_000,
    500,
    60_000,
  );
  const attempts = normalizeTransportNumber(
    process.env.MEMORY_ALERT_WEBHOOK_MAX_ATTEMPTS,
    3,
    1,
    10,
  );
  const backoffMs = normalizeTransportNumber(
    process.env.MEMORY_ALERT_WEBHOOK_BACKOFF_MS,
    400,
    0,
    60_000,
  );
  const dispatches: Promise<void>[] = [];

  const webhookUrl = String(process.env.MEMORY_ALERT_WEBHOOK_URL ?? "").trim();
  if (webhookUrl) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const authHeader = String(process.env.MEMORY_ALERT_WEBHOOK_AUTH_HEADER ?? "").trim();
    if (authHeader) {
      headers.authorization = authHeader;
    }
    dispatches.push(
      postAlertTransport(
        webhookUrl,
        JSON.stringify(alert),
        headers,
        timeoutMs,
        attempts,
        backoffMs,
      ),
    );
  }

  const pagerDutyRoutingKey = String(process.env.MEMORY_ALERT_PAGERDUTY_ROUTING_KEY ?? "").trim();
  if (pagerDutyRoutingKey) {
    const pagerDutyUrl =
      String(process.env.MEMORY_ALERT_PAGERDUTY_URL ?? "").trim() ||
      "https://events.pagerduty.com/v2/enqueue";
    const pagerDutySource =
      String(process.env.MEMORY_ALERT_PAGERDUTY_SOURCE ?? "").trim() || "moltbot.memory";
    const dedupPrefix =
      String(process.env.MEMORY_ALERT_PAGERDUTY_DEDUP_PREFIX ?? "").trim() || "memory-alert";
    const windowBucket = Math.floor(alert.ts / Math.max(1, alert.windowMs));
    const pagerDutyBody = {
      routing_key: pagerDutyRoutingKey,
      event_action: "trigger",
      dedup_key: `${dedupPrefix}:${alert.triggerCode}:${windowBucket}`,
      payload: {
        summary: `Moltbot memory security alert breached (${alert.triggerCode})`,
        source: pagerDutySource,
        severity: "critical",
        timestamp: new Date(alert.ts).toISOString(),
        custom_details: alert,
      },
    };
    const pagerDutyTimeoutMs = normalizeTransportNumber(
      process.env.MEMORY_ALERT_PAGERDUTY_TIMEOUT_MS,
      timeoutMs,
      500,
      60_000,
    );
    const pagerDutyAttempts = normalizeTransportNumber(
      process.env.MEMORY_ALERT_PAGERDUTY_MAX_ATTEMPTS,
      attempts,
      1,
      10,
    );
    const pagerDutyBackoffMs = normalizeTransportNumber(
      process.env.MEMORY_ALERT_PAGERDUTY_BACKOFF_MS,
      backoffMs,
      0,
      60_000,
    );
    dispatches.push(
      postAlertTransport(
        pagerDutyUrl,
        JSON.stringify(pagerDutyBody),
        { "content-type": "application/json" },
        pagerDutyTimeoutMs,
        pagerDutyAttempts,
        pagerDutyBackoffMs,
      ),
    );
  }

  if (dispatches.length === 0) return;
  await Promise.allSettled(dispatches);
}

function assertDiagnosticEventSchema(event: DiagnosticEventPayload): void {
  if (event.type === "memory.guidance") {
    MemoryGuidanceDiagnosticEventSchema.parse(event);
    return;
  }
  if (event.type === "memory.guidance.response") {
    MemoryGuidanceResponseDiagnosticEventSchema.parse(event);
    return;
  }
  if (event.type === "memory.turn-control") {
    MemoryTurnControlDiagnosticEventSchema.parse(event);
    return;
  }
  if (event.type === "memory.retrieval") {
    MemoryRetrievalDiagnosticEventSchema.parse(event);
    return;
  }
  if (event.type === "memory.alert") {
    MemoryAlertDiagnosticEventSchema.parse(event);
    return;
  }
}

export function isDiagnosticsEnabled(config?: MoltbotConfig): boolean {
  return config?.diagnostics?.enabled === true;
}

export function emitDiagnosticEvent(event: DiagnosticEventInput) {
  const enriched = {
    ...event,
    seq: (seq += 1),
    ts: Date.now(),
  } satisfies DiagnosticEventPayload;
  assertDiagnosticEventSchema(enriched);
  if (enriched.type === "memory.security" && enriched.severity === "CRITICAL") {
    const windowMsRaw = Number(process.env.MEMORY_CRITICAL_ALERT_WINDOW_MS ?? 5 * 60 * 1000);
    const thresholdRaw = Number(process.env.MEMORY_CRITICAL_ALERT_THRESHOLD ?? 3);
    const windowMs = Number.isFinite(windowMsRaw)
      ? Math.max(60_000, Math.floor(windowMsRaw))
      : 300_000;
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 3;
    memoryCriticalSecurityTimestamps.push(enriched.ts);
    const cutoff = enriched.ts - windowMs;
    while (
      memoryCriticalSecurityTimestamps.length > 0 &&
      (memoryCriticalSecurityTimestamps[0] ?? 0) < cutoff
    ) {
      memoryCriticalSecurityTimestamps.shift();
    }
    const alert = {
      type: "memory.alert",
      severity: "CRITICAL",
      category: "security",
      triggerCode: enriched.code,
      windowMs,
      threshold,
      criticalCount: memoryCriticalSecurityTimestamps.length,
      breached: memoryCriticalSecurityTimestamps.length >= threshold,
      seq: (seq += 1),
      ts: Date.now(),
    } satisfies DiagnosticMemoryAlertEvent;
    assertDiagnosticEventSchema(alert);
    for (const listener of listeners) {
      try {
        listener(alert);
      } catch {
        // Ignore listener failures.
      }
    }
    void dispatchMemoryAlertTransport(alert);
  }
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      // Ignore listener failures.
    }
  }
}

export function onDiagnosticEvent(listener: (evt: DiagnosticEventPayload) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDiagnosticEventsForTest(): void {
  seq = 0;
  listeners.clear();
  memoryCriticalSecurityTimestamps.length = 0;
}
