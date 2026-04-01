export type SingleflightErrorKind = "transient" | "deterministic";

export type SingleflightStats = {
  cacheHits: number;
  deterministicErrorHits: number;
  joinedCallers: number;
  misses: number;
  transientEvictions: number;
  cleanupRuns: number;
};

export type SingleflightDefaults<TResult> = {
  cacheSuccessMs?: number;
  cacheDeterministicErrorMs?: number;
  shouldCacheSuccess?: (value: TResult) => boolean;
  classifyError?: (error: unknown) => SingleflightErrorKind;
};

export type SingleflightRunOptions<TResult> = SingleflightDefaults<TResult>;

type SingleflightEntry<TResult> = {
  hasValue: boolean;
  value?: TResult;
  valueExpiresAt?: number;
  hasError: boolean;
  error?: unknown;
  errorExpiresAt?: number;
  inFlight?: Promise<TResult>;
};

function normalizeTtlMs(value: number | undefined): number | undefined {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function resolveExpiresAt(ttlMs: number | undefined, now: number): number | undefined {
  const normalized = normalizeTtlMs(ttlMs);
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  return now + normalized;
}

function isFreshExpiry(expiresAt: number | undefined, now: number): boolean {
  return (
    typeof expiresAt === "number" && (expiresAt === Number.POSITIVE_INFINITY || expiresAt > now)
  );
}

export function createSingleflightCache<TKey, TResult>(defaults?: SingleflightDefaults<TResult>) {
  const entries = new Map<TKey, SingleflightEntry<TResult>>();
  const stats: SingleflightStats = {
    cacheHits: 0,
    deterministicErrorHits: 0,
    joinedCallers: 0,
    misses: 0,
    transientEvictions: 0,
    cleanupRuns: 0,
  };

  const clearCachedValue = (entry: SingleflightEntry<TResult>) => {
    entry.hasValue = false;
    entry.value = undefined;
    entry.valueExpiresAt = undefined;
  };

  const clearCachedError = (entry: SingleflightEntry<TResult>) => {
    entry.hasError = false;
    entry.error = undefined;
    entry.errorExpiresAt = undefined;
  };

  const deleteIfIdle = (key: TKey, entry: SingleflightEntry<TResult>) => {
    if (!entry.inFlight && !entry.hasValue && !entry.hasError) {
      entries.delete(key);
    }
  };

  const clear = (key?: TKey) => {
    if (key === undefined) {
      entries.clear();
      return;
    }
    entries.delete(key);
  };

  const run = async (
    key: TKey,
    task: () => Promise<TResult>,
    overrides?: SingleflightRunOptions<TResult>,
  ): Promise<TResult> => {
    const now = Date.now();
    const entry = entries.get(key);
    if (entry) {
      if (entry.hasValue && isFreshExpiry(entry.valueExpiresAt, now)) {
        stats.cacheHits += 1;
        return entry.value as TResult;
      }
      if (entry.hasError && isFreshExpiry(entry.errorExpiresAt, now)) {
        stats.deterministicErrorHits += 1;
        throw entry.error;
      }
      if (entry.inFlight) {
        stats.joinedCallers += 1;
        return await entry.inFlight;
      }
      clearCachedValue(entry);
      clearCachedError(entry);
      deleteIfIdle(key, entry);
    }

    const merged: Required<SingleflightDefaults<TResult>> = {
      cacheSuccessMs: overrides?.cacheSuccessMs ?? defaults?.cacheSuccessMs ?? 0,
      cacheDeterministicErrorMs:
        overrides?.cacheDeterministicErrorMs ?? defaults?.cacheDeterministicErrorMs ?? 0,
      shouldCacheSuccess:
        overrides?.shouldCacheSuccess ?? defaults?.shouldCacheSuccess ?? (() => true),
      classifyError: overrides?.classifyError ?? defaults?.classifyError ?? (() => "transient"),
    };

    const activeEntry: SingleflightEntry<TResult> = {
      hasValue: false,
      hasError: false,
    };
    stats.misses += 1;

    const inFlight = Promise.resolve()
      .then(task)
      .then((value) => {
        clearCachedError(activeEntry);
        if (merged.shouldCacheSuccess(value)) {
          const expiresAt = resolveExpiresAt(merged.cacheSuccessMs, Date.now());
          if (expiresAt !== undefined) {
            activeEntry.hasValue = true;
            activeEntry.value = value;
            activeEntry.valueExpiresAt = expiresAt;
          } else {
            clearCachedValue(activeEntry);
          }
        } else {
          clearCachedValue(activeEntry);
        }
        return value;
      })
      .catch((error) => {
        clearCachedValue(activeEntry);
        const errorKind = merged.classifyError(error);
        if (errorKind === "deterministic") {
          const expiresAt = resolveExpiresAt(merged.cacheDeterministicErrorMs, Date.now());
          if (expiresAt !== undefined) {
            activeEntry.hasError = true;
            activeEntry.error = error;
            activeEntry.errorExpiresAt = expiresAt;
          } else {
            clearCachedError(activeEntry);
          }
        } else {
          stats.transientEvictions += 1;
          clearCachedError(activeEntry);
        }
        throw error;
      })
      .finally(() => {
        stats.cleanupRuns += 1;
        const current = entries.get(key);
        if (current === activeEntry || current?.inFlight === inFlight) {
          activeEntry.inFlight = undefined;
          deleteIfIdle(key, activeEntry);
        }
      });

    activeEntry.inFlight = inFlight;
    entries.set(key, activeEntry);
    return await inFlight;
  };

  return {
    run,
    clear,
    delete: (key: TKey) => clear(key),
    getStats: (): SingleflightStats => ({ ...stats }),
    getState: () => ({
      entryCount: entries.size,
      inFlightCount: Array.from(entries.values()).filter((entry) => Boolean(entry.inFlight)).length,
    }),
  };
}
