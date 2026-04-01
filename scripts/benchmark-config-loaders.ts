import { performance } from "node:perf_hooks";
import { clearBootstrapConfigCache, loadBootstrapConfig } from "../src/config/bootstrap.js";
import { clearConfigCache, loadConfig } from "../src/config/config.js";

type Sample = {
  label: string;
  ms: number[];
};

function parseIterations(argv: string[]): number {
  const raw = argv.find((value) => value.startsWith("--iterations="));
  const parsed = raw ? Number.parseInt(raw.split("=")[1] ?? "", 10) : 25;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }
  return parsed;
}

function summarize(values: number[]) {
  const sorted = [...values].toSorted((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    minMs: Number((sorted[0] ?? 0).toFixed(3)),
    medianMs: Number(median.toFixed(3)),
    meanMs: Number((total / Math.max(1, values.length)).toFixed(3)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

function measure(label: string, iterations: number, fn: () => unknown): Sample {
  const ms: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    fn();
    ms.push(performance.now() - startedAt);
  }
  return { label, ms };
}

const iterations = parseIterations(process.argv.slice(2));

const bootstrap = measure("bootstrap", iterations, () => {
  clearBootstrapConfigCache();
  loadBootstrapConfig();
});

const full = measure("full", iterations, () => {
  clearConfigCache();
  loadConfig();
});

console.log(
  JSON.stringify(
    {
      iterations,
      results: [
        { label: bootstrap.label, ...summarize(bootstrap.ms) },
        { label: full.label, ...summarize(full.ms) },
      ],
    },
    null,
    2,
  ),
);
