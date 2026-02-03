import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  emitDiagnosticEvent,
  MEMORY_GUIDANCE_EVENT_VERSION,
  MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION,
  MEMORY_TURN_CONTROL_EVENT_VERSION,
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "./diagnostic-events.js";

function toRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return "";
}

function toJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return {};
  return JSON.parse(body) as Record<string, unknown>;
}

describe("diagnostic-events", () => {
  const alertEnvKeys = [
    "MEMORY_CRITICAL_ALERT_WINDOW_MS",
    "MEMORY_CRITICAL_ALERT_THRESHOLD",
    "MEMORY_ALERT_WEBHOOK_URL",
    "MEMORY_ALERT_WEBHOOK_AUTH_HEADER",
    "MEMORY_ALERT_WEBHOOK_TIMEOUT_MS",
    "MEMORY_ALERT_WEBHOOK_MAX_ATTEMPTS",
    "MEMORY_ALERT_WEBHOOK_BACKOFF_MS",
    "MEMORY_ALERT_PAGERDUTY_ROUTING_KEY",
    "MEMORY_ALERT_PAGERDUTY_URL",
    "MEMORY_ALERT_PAGERDUTY_SOURCE",
    "MEMORY_ALERT_PAGERDUTY_DEDUP_PREFIX",
    "MEMORY_ALERT_PAGERDUTY_TIMEOUT_MS",
    "MEMORY_ALERT_PAGERDUTY_MAX_ATTEMPTS",
    "MEMORY_ALERT_PAGERDUTY_BACKOFF_MS",
  ] as const;
  const previousAlertEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    for (const key of alertEnvKeys) {
      previousAlertEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of alertEnvKeys) {
      const prev = previousAlertEnv[key];
      if (prev == null) delete process.env[key];
      else process.env[key] = prev;
    }
    globalThis.fetch = originalFetch;
  });

  test("emits monotonic seq", async () => {
    resetDiagnosticEventsForTest();
    const seqs: number[] = [];
    const stop = onDiagnosticEvent((evt) => seqs.push(evt.seq));

    emitDiagnosticEvent({
      type: "model.usage",
      usage: { total: 1 },
    });
    emitDiagnosticEvent({
      type: "model.usage",
      usage: { total: 2 },
    });

    stop();

    expect(seqs).toEqual([1, 2]);
  });

  test("emits message-flow events", async () => {
    resetDiagnosticEventsForTest();
    const types: string[] = [];
    const stop = onDiagnosticEvent((evt) => types.push(evt.type));

    emitDiagnosticEvent({
      type: "webhook.received",
      channel: "telegram",
      updateType: "telegram-post",
    });
    emitDiagnosticEvent({
      type: "message.queued",
      channel: "telegram",
      source: "telegram",
      queueDepth: 1,
    });
    emitDiagnosticEvent({
      type: "session.state",
      state: "processing",
      reason: "run_started",
    });

    stop();

    expect(types).toEqual(["webhook.received", "message.queued", "session.state"]);
  });

  test("emits memory guidance telemetry events", async () => {
    resetDiagnosticEventsForTest();
    const types: string[] = [];
    const stop = onDiagnosticEvent((evt) => types.push(evt.type));

    emitDiagnosticEvent({
      type: "memory.guidance",
      eventVersion: MEMORY_GUIDANCE_EVENT_VERSION,
      mode: "supportive",
      shown: true,
      nudgeKind: "topic-switch",
      userSignal: "none",
      inferredTaskConfidence: "low",
      ambiguousCount: 2,
      hasConflict: false,
    });
    emitDiagnosticEvent({
      type: "memory.guidance.response",
      eventVersion: MEMORY_GUIDANCE_RESPONSE_EVENT_VERSION,
      priorNudgeKind: "topic-switch",
      response: "acknowledged",
      latencyMs: 1200,
      userSignal: "explicit-task",
    });

    stop();

    expect(types).toEqual(["memory.guidance", "memory.guidance.response"]);
  });

  test("emits versioned memory.turn-control diagnostics", async () => {
    resetDiagnosticEventsForTest();
    const events: Array<Record<string, unknown>> = [];
    const stop = onDiagnosticEvent((evt) => events.push(evt as unknown as Record<string, unknown>));

    emitDiagnosticEvent({
      type: "memory.turn-control",
      eventVersion: MEMORY_TURN_CONTROL_EVENT_VERSION,
      autoSwitchOptIn: false,
      autoSwitched: false,
      ambiguous: false,
      decisionMode: "ask",
    });

    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: "memory.turn-control",
        eventVersion: MEMORY_TURN_CONTROL_EVENT_VERSION,
        autoSwitchOptIn: false,
        autoSwitched: false,
        ambiguous: false,
        decisionMode: "ask",
      }),
    );
  });

  test("rejects invalid memory.turn-control payload versions", async () => {
    resetDiagnosticEventsForTest();
    const types: string[] = [];
    const stop = onDiagnosticEvent((evt) => types.push(evt.type));

    expect(() =>
      emitDiagnosticEvent({
        type: "memory.turn-control",
        eventVersion: 999,
        autoSwitchOptIn: false,
        autoSwitched: false,
        ambiguous: false,
        decisionMode: "ask",
      } as any),
    ).toThrow(/expected 1/i);

    stop();
    expect(types).toEqual([]);
  });

  test("rejects invalid memory.guidance payload versions", async () => {
    resetDiagnosticEventsForTest();
    const types: string[] = [];
    const stop = onDiagnosticEvent((evt) => types.push(evt.type));

    expect(() =>
      emitDiagnosticEvent({
        type: "memory.guidance",
        eventVersion: 999,
        mode: "supportive",
        shown: false,
      } as any),
    ).toThrow(/expected 1/i);

    stop();
    expect(types).toEqual([]);
  });

  test("rejects invalid memory.guidance.response payload versions", async () => {
    resetDiagnosticEventsForTest();
    const types: string[] = [];
    const stop = onDiagnosticEvent((evt) => types.push(evt.type));

    expect(() =>
      emitDiagnosticEvent({
        type: "memory.guidance.response",
        eventVersion: 999,
        priorNudgeKind: "topic-switch",
        response: "acknowledged",
      } as any),
    ).toThrow(/expected 1/i);

    stop();
    expect(types).toEqual([]);
  });

  test("emits memory retrieval diagnostics with retrieval version fields", async () => {
    resetDiagnosticEventsForTest();
    const events: Array<Record<string, unknown>> = [];
    const stop = onDiagnosticEvent((evt) => events.push(evt as any));

    emitDiagnosticEvent({
      type: "memory.retrieval",
      sessionKey: "agent:main:main",
      taskId: "task-a",
      namespace: "task",
      resultCount: 2,
      configHash: "abc123",
      embeddingModel: "text-embedding-3-small",
      bm25ConfigVersion: "bm25-v1",
    });

    stop();
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: "memory.retrieval",
        sessionKey: "agent:main:main",
        taskId: "task-a",
        namespace: "task",
        resultCount: 2,
        configHash: "abc123",
      }),
    );
  });

  test("emits memory alert events and breach status for critical security diagnostics", async () => {
    resetDiagnosticEventsForTest();
    process.env.MEMORY_CRITICAL_ALERT_WINDOW_MS = "600000";
    process.env.MEMORY_CRITICAL_ALERT_THRESHOLD = "2";
    const types: string[] = [];
    const alerts: Array<Record<string, unknown>> = [];
    const stop = onDiagnosticEvent((evt) => {
      types.push(evt.type);
      if (evt.type === "memory.alert") alerts.push(evt as unknown as Record<string, unknown>);
    });

    emitDiagnosticEvent({
      type: "memory.security",
      severity: "CRITICAL",
      code: "missing-signing-key",
      mode: "prod",
      detail: "missing key",
    });
    emitDiagnosticEvent({
      type: "memory.security",
      severity: "CRITICAL",
      code: "verification-failure",
      mode: "prod",
      detail: "sig mismatch",
    });

    stop();
    expect(types).toContain("memory.security");
    expect(types).toContain("memory.alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toEqual(
      expect.objectContaining({
        type: "memory.alert",
        threshold: 2,
        criticalCount: 1,
        breached: false,
      }),
    );
    expect(alerts[1]).toEqual(
      expect.objectContaining({
        type: "memory.alert",
        threshold: 2,
        criticalCount: 2,
        breached: true,
      }),
    );
  });

  test("dispatches breached memory alerts to configured webhook transport", async () => {
    resetDiagnosticEventsForTest();
    process.env.MEMORY_CRITICAL_ALERT_WINDOW_MS = "600000";
    process.env.MEMORY_CRITICAL_ALERT_THRESHOLD = "1";
    process.env.MEMORY_ALERT_WEBHOOK_URL = "https://example.test/memory-alert";
    process.env.MEMORY_ALERT_WEBHOOK_AUTH_HEADER = "Bearer test-token";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: toRequestUrl(input), init });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    emitDiagnosticEvent({
      type: "memory.security",
      severity: "CRITICAL",
      code: "verification-failure",
      mode: "prod",
      detail: "sig mismatch",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/memory-alert");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        "content-type": "application/json",
        authorization: "Bearer test-token",
      }),
    );
  });

  test("retries webhook transport on retryable failures", async () => {
    resetDiagnosticEventsForTest();
    process.env.MEMORY_CRITICAL_ALERT_WINDOW_MS = "600000";
    process.env.MEMORY_CRITICAL_ALERT_THRESHOLD = "1";
    process.env.MEMORY_ALERT_WEBHOOK_URL = "https://example.test/memory-alert";
    process.env.MEMORY_ALERT_WEBHOOK_MAX_ATTEMPTS = "3";
    process.env.MEMORY_ALERT_WEBHOOK_BACKOFF_MS = "1";
    const statuses = [500, 503, 200];
    const calls: number[] = [];
    globalThis.fetch = (async () => {
      const status = statuses[calls.length] ?? 200;
      calls.push(status);
      return new Response("ok", { status });
    }) as typeof fetch;

    emitDiagnosticEvent({
      type: "memory.security",
      severity: "CRITICAL",
      code: "verification-failure",
      mode: "prod",
      detail: "sig mismatch",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual([500, 503, 200]);
  });

  test("dispatches breached memory alerts to pagerduty transport", async () => {
    resetDiagnosticEventsForTest();
    process.env.MEMORY_CRITICAL_ALERT_WINDOW_MS = "600000";
    process.env.MEMORY_CRITICAL_ALERT_THRESHOLD = "1";
    process.env.MEMORY_ALERT_PAGERDUTY_ROUTING_KEY = "routing-key";
    process.env.MEMORY_ALERT_PAGERDUTY_URL = "https://events.pagerduty.test/v2/enqueue";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: toRequestUrl(input), init });
      return new Response("ok", { status: 202 });
    }) as typeof fetch;

    emitDiagnosticEvent({
      type: "memory.security",
      severity: "CRITICAL",
      code: "verification-failure",
      mode: "prod",
      detail: "sig mismatch",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://events.pagerduty.test/v2/enqueue");
    expect(calls[0]?.init?.method).toBe("POST");
    const payload = toJsonBody(calls[0]?.init?.body);
    expect(payload).toEqual(
      expect.objectContaining({
        routing_key: "routing-key",
        event_action: "trigger",
      }),
    );
  });
});
