import { describe, expect, test } from "vitest";

import {
  emitDiagnosticEvent,
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "./diagnostic-events.js";

describe("diagnostic-events", () => {
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
      priorNudgeKind: "topic-switch",
      response: "acknowledged",
      latencyMs: 1200,
      userSignal: "explicit-task",
    });

    stop();

    expect(types).toEqual(["memory.guidance", "memory.guidance.response"]);
  });
});
