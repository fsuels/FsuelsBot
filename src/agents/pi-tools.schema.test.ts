import { beforeEach, describe, expect, it } from "vitest";
import { normalizeToolParameters, __testing } from "./pi-tools.schema.js";

describe("normalizeToolParameters schema cache", () => {
  beforeEach(() => {
    __testing.resetSchemaNormalizationCache();
  });

  it("reuses normalized schemas for the same schema object identity", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: {
            action: { type: "string", enum: ["read"] },
          },
          required: ["action"],
        },
        {
          type: "object",
          properties: {
            action: { type: "string", enum: ["write"] },
            path: { type: "string" },
          },
          required: ["action", "path"],
        },
      ],
    };

    const first = normalizeToolParameters({
      name: "demo",
      description: "demo",
      parameters: schema,
      execute: async () => ({ content: [], details: {} }),
    });
    const second = normalizeToolParameters({
      name: "demo",
      description: "demo",
      parameters: schema,
      execute: async () => ({ content: [], details: {} }),
    });

    expect(second.parameters).toBe(first.parameters);
    expect(__testing.getSchemaNormalizationCacheStats()).toMatchObject({
      hits: 1,
      misses: 1,
    });
  });

  it("misses naturally when the schema object identity changes", () => {
    const buildTool = (schema: Record<string, unknown>) =>
      normalizeToolParameters({
        name: "demo",
        description: "demo",
        parameters: schema,
        execute: async () => ({ content: [], details: {} }),
      });

    buildTool({
      type: "object",
      properties: { path: { type: "string" } },
    });
    buildTool({
      type: "object",
      properties: { path: { type: "string" } },
    });

    expect(__testing.getSchemaNormalizationCacheStats()).toMatchObject({
      hits: 0,
      misses: 2,
    });
  });

  it("tracks estimated materialization time saved on cache hits", () => {
    const schema = {
      anyOf: Array.from({ length: 20 }, (_, index) => ({
        type: "object",
        properties: {
          action: { type: "string", enum: [`action-${index}`] },
          value: { type: "string" },
        },
        required: ["action"],
      })),
    };

    normalizeToolParameters({
      name: "demo",
      description: "demo",
      parameters: schema,
      execute: async () => ({ content: [], details: {} }),
    });
    normalizeToolParameters({
      name: "demo",
      description: "demo",
      parameters: schema,
      execute: async () => ({ content: [], details: {} }),
    });

    expect(__testing.getSchemaNormalizationCacheStats().timeSavedMs).toBeGreaterThanOrEqual(0);
  });
});
