/**
 * Prompt Dedup Cache — Processing Efficiency P1.
 *
 * Short-lived in-memory cache keyed by SHA-256 hash of the system prompt
 * + message sequence. When overflow recovery causes the exact same prompt
 * to be retried, the cached response is returned without an API call.
 *
 * This is particularly impactful during compaction retry loops where
 * MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3 may cause identical prompts to
 * be re-sent when compaction doesn't change the message content.
 *
 * The cache has a short TTL (120s) and is scoped to a single agent run
 * to avoid stale responses.
 */

import { createHash } from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CacheEntry<T> = {
  response: T;
  ts: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cache entries expire after this duration. */
const CACHE_TTL_MS = 120_000; // 2 minutes

/** Maximum cache entries to prevent unbounded memory growth. */
const MAX_ENTRIES = 5;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Compute a content hash for a prompt state (system prompt + messages).
 * Uses SHA-256 truncated to 32 hex chars for efficiency.
 */
export function hashPromptState(systemPrompt: string, messages: AgentMessage[]): string {
  const hash = createHash("sha256");
  hash.update(systemPrompt);
  // Hash message content in order using JSON serialization.
  // AgentMessage is a discriminated union — rather than type-narrowing each variant,
  // we serialize the whole message which captures role + content regardless of shape.
  for (const msg of messages) {
    try {
      hash.update(JSON.stringify(msg));
    } catch {
      // Fallback for non-serializable messages (shouldn't happen in practice)
      hash.update(String(msg));
    }
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * Per-run prompt dedup cache.
 * Create one instance per `runEmbeddedPiAgent` invocation.
 */
export class PromptDedupCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  /**
   * Look up a cached response for the given prompt hash.
   * Returns undefined if no valid cache entry exists.
   */
  get(hash: string, now?: number): T | undefined {
    const ts = now ?? Date.now();
    const entry = this.entries.get(hash);
    if (!entry) return undefined;

    // Check TTL
    if (ts - entry.ts > CACHE_TTL_MS) {
      this.entries.delete(hash);
      return undefined;
    }

    return entry.response;
  }

  /**
   * Store a response for the given prompt hash.
   */
  set(hash: string, response: T, now?: number): void {
    const ts = now ?? Date.now();

    // Evict expired entries
    for (const [key, entry] of this.entries) {
      if (ts - entry.ts > CACHE_TTL_MS) {
        this.entries.delete(key);
      }
    }

    // Evict oldest if at capacity
    if (this.entries.size >= MAX_ENTRIES) {
      let oldestKey: string | undefined;
      let oldestTs = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.ts < oldestTs) {
          oldestTs = entry.ts;
          oldestKey = key;
        }
      }
      if (oldestKey) this.entries.delete(oldestKey);
    }

    this.entries.set(hash, { response, ts });
  }

  /** Number of valid (non-expired) entries in the cache. */
  get size(): number {
    return this.entries.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.clear();
  }
}
