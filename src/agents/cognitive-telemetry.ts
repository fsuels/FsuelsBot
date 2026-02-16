/**
 * Centralized Telemetry Schema — S4.
 *
 * Defines a structured CognitiveEvent schema and in-memory ring buffer
 * for all cognitive subsystem events. Enables cross-subsystem causality
 * analysis and deterministic replay.
 */

import type { AgentPosture, PostureMode } from "./agent-posture.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CognitiveEventSource =
  | "compaction"
  | "drift"
  | "toolFailure"
  | "capability"
  | "memory"
  | "loop"
  | "posture"
  | "budget";

export type CognitiveEvent = {
  ts: number;
  sessionId: string;
  turnIndex: number;
  source: CognitiveEventSource;
  event: string; // e.g., "compaction.proactive", "loop.detected"
  data: Record<string, unknown>;
  postureAtEmit?: PostureSnapshot;
};

export type PostureSnapshot = {
  mode: PostureMode;
  contextPressure: number;
  driftLevel: string;
  toolHealthRatio: number;
  memoryAvailable: boolean;
};

export type TurnTrace = {
  turnIndex: number;
  events: CognitiveEvent[];
  tokenUsage?: { input: number; output: number };
  contextPressure: number;
  postureStart: PostureSnapshot;
  postureEnd: PostureSnapshot;
};

// ---------------------------------------------------------------------------
// Ring Buffer
// ---------------------------------------------------------------------------

const MAX_RING_BUFFER_SIZE = 200;

export class CognitiveEventBuffer {
  private events: CognitiveEvent[] = [];
  private readonly maxSize: number;
  readonly sessionId: string;

  constructor(sessionId: string, maxSize = MAX_RING_BUFFER_SIZE) {
    this.sessionId = sessionId;
    this.maxSize = maxSize;
  }

  emit(event: Omit<CognitiveEvent, "sessionId">): void {
    this.events.push({ ...event, sessionId: this.sessionId });
    while (this.events.length > this.maxSize) {
      this.events.shift();
    }
  }

  /** Convenience: emit with auto-timestamping. */
  record(
    source: CognitiveEventSource,
    eventName: string,
    data: Record<string, unknown>,
    opts?: { turnIndex?: number; posture?: AgentPosture },
  ): void {
    const snapshot: PostureSnapshot | undefined = opts?.posture
      ? {
          mode: opts.posture.mode,
          contextPressure: opts.posture.contextPressure,
          driftLevel: opts.posture.driftLevel,
          toolHealthRatio: opts.posture.toolHealthRatio,
          memoryAvailable: opts.posture.memoryAvailable,
        }
      : undefined;

    this.emit({
      ts: Date.now(),
      turnIndex: opts?.turnIndex ?? 0,
      source,
      event: eventName,
      data,
      postureAtEmit: snapshot,
    });
  }

  /** Get all events (snapshot). */
  getEvents(): CognitiveEvent[] {
    return [...this.events];
  }

  /** Get events for a specific turn. */
  getEventsForTurn(turnIndex: number): CognitiveEvent[] {
    return this.events.filter((e) => e.turnIndex === turnIndex);
  }

  /** Get events from a specific source. */
  getEventsBySource(source: CognitiveEventSource): CognitiveEvent[] {
    return this.events.filter((e) => e.source === source);
  }

  /** Build a TurnTrace from recorded events. */
  buildTurnTrace(
    turnIndex: number,
    opts: {
      tokenUsage?: { input: number; output: number };
      contextPressure: number;
      postureStart: AgentPosture;
      postureEnd: AgentPosture;
    },
  ): TurnTrace {
    return {
      turnIndex,
      events: this.getEventsForTurn(turnIndex),
      tokenUsage: opts.tokenUsage,
      contextPressure: opts.contextPressure,
      postureStart: snapshotPosture(opts.postureStart),
      postureEnd: snapshotPosture(opts.postureEnd),
    };
  }

  /** Export all events for persistence. */
  serialize(): CognitiveEvent[] {
    return [...this.events];
  }

  /** Number of events in buffer. */
  get size(): number {
    return this.events.length;
  }

  /** Clear all events. */
  clear(): void {
    this.events = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotPosture(posture: AgentPosture): PostureSnapshot {
  return {
    mode: posture.mode,
    contextPressure: posture.contextPressure,
    driftLevel: posture.driftLevel,
    toolHealthRatio: posture.toolHealthRatio,
    memoryAvailable: posture.memoryAvailable,
  };
}
