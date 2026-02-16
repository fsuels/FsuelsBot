/**
 * Embedding Circuit Breaker — Robustness P2.
 *
 * Protects the memory subsystem from cascading embedding failures.
 * After N consecutive failures, trips the breaker for a cooldown period.
 * During cooldown, search falls back to keyword-only mode.
 *
 * States:
 *   closed  → open (after TRIP_THRESHOLD failures)
 *   open    → half-open (after cooldown expires)
 *   half-open → closed (test call succeeds) or open (test call fails, 2x cooldown)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTs: number;
  cooldownMs: number;
  trippedAt: number | null;
  totalTrips: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Consecutive failures before tripping the breaker. */
const TRIP_THRESHOLD = 3;

/** Initial cooldown after tripping (ms). */
const BASE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum cooldown after repeated trips (ms). */
const MAX_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/** Cooldown multiplier on re-trip from half-open state. */
const COOLDOWN_BACKOFF_FACTOR = 2;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class EmbeddingCircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTs = 0;
  private cooldownMs = BASE_COOLDOWN_MS;
  private trippedAt: number | null = null;
  private totalTrips = 0;

  /**
   * Record a successful embedding call.
   * Resets failure count; if half-open, closes the breaker.
   */
  recordSuccess(now?: number): void {
    this.consecutiveFailures = 0;
    if (this.state === "half-open") {
      this.state = "closed";
      this.cooldownMs = BASE_COOLDOWN_MS; // Reset cooldown on successful recovery
      this.trippedAt = null;
    }
  }

  /**
   * Record a failed embedding call.
   * May trip or re-trip the breaker.
   */
  recordFailure(now?: number): void {
    const ts = now ?? Date.now();
    this.consecutiveFailures++;
    this.lastFailureTs = ts;

    if (this.state === "half-open") {
      // Test call failed — re-trip with extended cooldown
      this.state = "open";
      this.trippedAt = ts;
      this.cooldownMs = Math.min(this.cooldownMs * COOLDOWN_BACKOFF_FACTOR, MAX_COOLDOWN_MS);
      this.totalTrips++;
    } else if (this.state === "closed" && this.consecutiveFailures >= TRIP_THRESHOLD) {
      this.state = "open";
      this.trippedAt = ts;
      this.totalTrips++;
    }
  }

  /**
   * Check if embedding calls should proceed.
   * Returns true if the breaker allows the call.
   */
  shouldAllowCall(now?: number): boolean {
    const ts = now ?? Date.now();

    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open" && this.trippedAt !== null) {
      // Check if cooldown has expired → transition to half-open
      if (ts - this.trippedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true; // Allow one test call
      }
      return false;
    }

    if (this.state === "half-open") {
      // Already in half-open, allow the test call
      return true;
    }

    return false;
  }

  /**
   * Get the current search weight blend for keyword vs vector.
   * When the breaker is open, boost keyword weight and zero vector.
   */
  getSearchWeights(
    defaultVectorWeight: number,
    defaultTextWeight: number,
  ): { vectorWeight: number; textWeight: number } {
    if (this.state === "open") {
      return { vectorWeight: 0, textWeight: 1.0 };
    }
    if (this.state === "half-open") {
      // Blend: partial vector to test if embeddings work
      return {
        vectorWeight: defaultVectorWeight * 0.5,
        textWeight: defaultTextWeight + defaultVectorWeight * 0.5,
      };
    }
    return { vectorWeight: defaultVectorWeight, textWeight: defaultTextWeight };
  }

  /** Get current state for telemetry. */
  getState(): CircuitState {
    return this.state;
  }

  /** Get snapshot for serialization/logging. */
  snapshot(now?: number): CircuitBreakerSnapshot {
    // Trigger state transition check
    if (now !== undefined) this.shouldAllowCall(now);
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTs: this.lastFailureTs,
      cooldownMs: this.cooldownMs,
      trippedAt: this.trippedAt,
      totalTrips: this.totalTrips,
    };
  }

  /** Check if currently in degraded (keyword-only) mode. */
  isDegraded(): boolean {
    return this.state === "open";
  }
}
