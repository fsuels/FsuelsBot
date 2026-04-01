import { performance } from "node:perf_hooks";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { cleanSchemaForGemini } from "./schema/clean-for-gemini.js";

type NormalizedSchemaCacheEntry = {
  schema: Record<string, unknown>;
  buildMs: number;
};

type SchemaNormalizationCacheStats = {
  hits: number;
  misses: number;
  timeSavedMs: number;
};

let schemaNormalizationCache = new WeakMap<object, NormalizedSchemaCacheEntry>();
const schemaNormalizationCacheStats: SchemaNormalizationCacheStats = {
  hits: 0,
  misses: 0,
  timeSavedMs: 0,
};

function extractEnumValues(schema: unknown): unknown[] | undefined {
  if (!schema || typeof schema !== "object") {
    return undefined;
  }
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum)) {
    return record.enum;
  }
  if ("const" in record) {
    return [record.const];
  }
  const variants = Array.isArray(record.anyOf)
    ? record.anyOf
    : Array.isArray(record.oneOf)
      ? record.oneOf
      : null;
  if (variants) {
    const values = variants.flatMap((variant) => {
      const extracted = extractEnumValues(variant);
      return extracted ?? [];
    });
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const existingEnum = extractEnumValues(existing);
  const incomingEnum = extractEnumValues(incoming);
  if (existingEnum || incomingEnum) {
    const values = Array.from(new Set([...(existingEnum ?? []), ...(incomingEnum ?? [])]));
    const merged: Record<string, unknown> = {};
    for (const source of [existing, incoming]) {
      if (!source || typeof source !== "object") {
        continue;
      }
      const record = source as Record<string, unknown>;
      for (const key of ["title", "description", "default"]) {
        if (!(key in merged) && key in record) {
          merged[key] = record[key];
        }
      }
    }
    const types = new Set(values.map((value) => typeof value));
    if (types.size === 1) {
      merged.type = Array.from(types)[0];
    }
    merged.enum = values;
    return merged;
  }

  return existing;
}

function recordCacheHit(entry: NormalizedSchemaCacheEntry) {
  schemaNormalizationCacheStats.hits += 1;
  schemaNormalizationCacheStats.timeSavedMs += entry.buildMs;
}

function cacheNormalizedSchema(
  schema: Record<string, unknown>,
  build: () => Record<string, unknown>,
): Record<string, unknown> {
  const cached = schemaNormalizationCache.get(schema);
  if (cached) {
    recordCacheHit(cached);
    return cached.schema;
  }
  const startedAt = performance.now();
  const normalized = build();
  const entry = {
    schema: normalized,
    buildMs: Math.max(0, performance.now() - startedAt),
  };
  schemaNormalizationCache.set(schema, entry);
  schemaNormalizationCacheStats.misses += 1;
  return normalized;
}

export function normalizeToolParameters(tool: AnyAgentTool): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as Record<string, unknown>)
      : undefined;
  if (!schema) {
    return tool;
  }
  const normalizedSchema = cacheNormalizedSchema(schema, () => {
    // Provider quirks:
    // - Gemini rejects several JSON Schema keywords, so we scrub those.
    // - OpenAI rejects function tool schemas unless the *top-level* is `type: "object"`.
    //   (TypeBox root unions compile to `{ anyOf: [...] }` without `type`).
    //
    // Normalize once here so callers can always pass `tools` through unchanged.

    // If schema already has type + properties (no top-level anyOf to merge),
    // still clean it for Gemini compatibility
    if ("type" in schema && "properties" in schema && !Array.isArray(schema.anyOf)) {
      return cleanSchemaForGemini(schema) as Record<string, unknown>;
    }

    // Some tool schemas (esp. unions) may omit `type` at the top-level. If we see
    // object-ish fields, force `type: "object"` so OpenAI accepts the schema.
    if (
      !("type" in schema) &&
      (typeof schema.properties === "object" || Array.isArray(schema.required)) &&
      !Array.isArray(schema.anyOf) &&
      !Array.isArray(schema.oneOf)
    ) {
      return cleanSchemaForGemini({ ...schema, type: "object" }) as Record<string, unknown>;
    }

    const variantKey = Array.isArray(schema.anyOf)
      ? "anyOf"
      : Array.isArray(schema.oneOf)
        ? "oneOf"
        : null;
    if (!variantKey) {
      return schema;
    }
    const variants = schema[variantKey] as unknown[];
    const mergedProperties: Record<string, unknown> = {};
    const requiredCounts = new Map<string, number>();
    let objectVariants = 0;

    for (const entry of variants) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const props = (entry as { properties?: unknown }).properties;
      if (!props || typeof props !== "object") {
        continue;
      }
      objectVariants += 1;
      for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
        if (!(key in mergedProperties)) {
          mergedProperties[key] = value;
          continue;
        }
        mergedProperties[key] = mergePropertySchemas(mergedProperties[key], value);
      }
      const required = Array.isArray((entry as { required?: unknown }).required)
        ? (entry as { required: unknown[] }).required
        : [];
      for (const key of required) {
        if (typeof key !== "string") {
          continue;
        }
        requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
      }
    }

    const baseRequired = Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === "string")
      : undefined;
    const mergedRequired =
      baseRequired && baseRequired.length > 0
        ? baseRequired
        : objectVariants > 0
          ? Array.from(requiredCounts.entries())
              .filter(([, count]) => count === objectVariants)
              .map(([key]) => key)
          : undefined;

    const nextSchema: Record<string, unknown> = { ...schema };
    return cleanSchemaForGemini({
      // Flatten union schemas into a single object schema:
      // - Gemini doesn't allow top-level `type` together with `anyOf`.
      // - OpenAI rejects schemas without top-level `type: "object"`.
      // Merging properties preserves useful enums like `action` while keeping schemas portable.
      type: "object",
      ...(typeof nextSchema.title === "string" ? { title: nextSchema.title } : {}),
      ...(typeof nextSchema.description === "string"
        ? { description: nextSchema.description }
        : {}),
      properties:
        Object.keys(mergedProperties).length > 0 ? mergedProperties : (schema.properties ?? {}),
      ...(mergedRequired && mergedRequired.length > 0 ? { required: mergedRequired } : {}),
      additionalProperties: "additionalProperties" in schema ? schema.additionalProperties : true,
    }) as Record<string, unknown>;
  });

  return {
    ...tool,
    parameters: normalizedSchema,
  };
}

export function cleanToolSchemaForGemini(schema: Record<string, unknown>): unknown {
  return cleanSchemaForGemini(schema);
}

export const __testing = {
  getSchemaNormalizationCacheStats(): SchemaNormalizationCacheStats {
    return { ...schemaNormalizationCacheStats };
  },
  resetSchemaNormalizationCache(): void {
    schemaNormalizationCache = new WeakMap<object, NormalizedSchemaCacheEntry>();
    schemaNormalizationCacheStats.hits = 0;
    schemaNormalizationCacheStats.misses = 0;
    schemaNormalizationCacheStats.timeSavedMs = 0;
  },
};
