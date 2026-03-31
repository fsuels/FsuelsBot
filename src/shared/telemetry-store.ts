export type TelemetryHistogramSnapshot = {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  reservoirSize: number;
};

export type TelemetryCardinalitySnapshot = {
  count: number;
};

export type TelemetrySnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, TelemetryHistogramSnapshot>;
  cardinalities: Record<string, TelemetryCardinalitySnapshot>;
  updatedAt: number;
};

type HistogramBucket = {
  count: number;
  sum: number;
  min: number;
  max: number;
  reservoir: number[];
};

export type TelemetryStoreOptions = {
  now?: () => number;
  random?: () => number;
  reservoirSize?: number;
};

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper = sortedValues[upperIndex] ?? sortedValues.at(-1) ?? lower;
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

/**
 * Keeps useful latency and cardinality telemetry in-process without unbounded
 * growth. The reservoir keeps percentile estimates cheap enough for hot UI
 * paths where we mainly need regression detection, not perfect analytics.
 */
export function createTelemetryStore(options: TelemetryStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const reservoirSize = Math.max(1, options.reservoirSize ?? 1024);
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const histograms = new Map<string, HistogramBucket>();
  const cardinalities = new Map<string, Set<string>>();
  let updatedAt = now();

  const touch = () => {
    updatedAt = now();
  };

  return {
    increment(name: string, value = 1) {
      counters.set(name, (counters.get(name) ?? 0) + value);
      touch();
    },

    set(name: string, value: number) {
      gauges.set(name, value);
      touch();
    },

    observe(name: string, value: number) {
      let bucket = histograms.get(name);
      if (!bucket) {
        bucket = {
          count: 0,
          sum: 0,
          min: value,
          max: value,
          reservoir: [],
        };
        histograms.set(name, bucket);
      }

      bucket.count += 1;
      bucket.sum += value;
      bucket.min = Math.min(bucket.min, value);
      bucket.max = Math.max(bucket.max, value);

      if (bucket.reservoir.length < reservoirSize) {
        bucket.reservoir.push(value);
      } else {
        const candidate = Math.floor(random() * bucket.count);
        if (candidate < reservoirSize) {
          bucket.reservoir[candidate] = value;
        }
      }
      touch();
    },

    add(name: string, value: string) {
      const bucket = cardinalities.get(name) ?? new Set<string>();
      bucket.add(value);
      cardinalities.set(name, bucket);
      touch();
    },

    getAll(): TelemetrySnapshot {
      const snapshot: TelemetrySnapshot = {
        counters: Object.fromEntries(counters.entries()),
        gauges: Object.fromEntries(gauges.entries()),
        histograms: {},
        cardinalities: {},
        updatedAt,
      };

      for (const [name, bucket] of histograms.entries()) {
        const sorted = [...bucket.reservoir].toSorted((left, right) => left - right);
        snapshot.histograms[name] = {
          count: bucket.count,
          min: bucket.min,
          max: bucket.max,
          avg: bucket.count > 0 ? bucket.sum / bucket.count : 0,
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          p99: quantile(sorted, 0.99),
          reservoirSize: bucket.reservoir.length,
        };
      }

      for (const [name, values] of cardinalities.entries()) {
        snapshot.cardinalities[name] = { count: values.size };
      }

      return snapshot;
    },
  };
}
