import { performance } from "node:perf_hooks";
import { __testing, createStructuredOutputTool } from "../src/agents/structured-output-tool.js";

const ITERATIONS = 250;

const baseSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    score: { type: "number" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "score"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

function cloneSchema() {
  return JSON.parse(JSON.stringify(baseSchema)) as Record<string, unknown>;
}

function runBenchmark(label: string, buildSchema: () => Record<string, unknown>) {
  __testing.resetCaches();
  const started = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) {
    createStructuredOutputTool({ jsonSchema: buildSchema() });
  }
  const durationMs = performance.now() - started;
  return {
    label,
    durationMs: Number(durationMs.toFixed(2)),
    compileCount: __testing.getCompileCount(),
  };
}

const sameObject = runBenchmark("same-object", () => baseSchema);
const equivalentObjects = runBenchmark("equivalent-objects", () => cloneSchema());

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      results: [sameObject, equivalentObjects],
    },
    null,
    2,
  ),
);
