import type { SubsystemLogger } from "../logging/subsystem.js";

type EmbeddingAdapterClientMeta = {
  baseUrl?: string;
  model?: string;
  modelPath?: string;
  headers?: Record<string, string>;
};

const warnedPayloads = new Set<string>();

type MalformedEmbeddingPayloadParams = {
  logger: Pick<SubsystemLogger, "warn">;
  adapter: string;
  operation: string;
  reason: string;
  payload: unknown;
  client?: EmbeddingAdapterClientMeta;
};

function describePayloadType(payload: unknown): string {
  if (Array.isArray(payload)) {
    return "array";
  }
  if (payload === null) {
    return "null";
  }
  return typeof payload;
}

function extractPayloadKeys(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return Object.keys(payload as Record<string, unknown>).toSorted();
}

function warnMalformedEmbeddingPayloadOnce(params: MalformedEmbeddingPayloadParams): void {
  const signature = `${params.adapter}:${params.operation}:${params.reason}`;
  if (warnedPayloads.has(signature)) {
    return;
  }
  warnedPayloads.add(signature);
  params.logger.warn("memory embeddings adapter returned malformed payload; using degraded path", {
    adapter: params.adapter,
    operation: params.operation,
    reason: params.reason,
    baseUrl: params.client?.baseUrl,
    model: params.client?.model,
    modelPath: params.client?.modelPath,
    headerKeys: params.client?.headers ? Object.keys(params.client.headers).toSorted() : undefined,
    payloadType: describePayloadType(params.payload),
    payloadKeys: extractPayloadKeys(params.payload),
  });
}

export function throwMalformedEmbeddingPayload(params: MalformedEmbeddingPayloadParams): never {
  warnMalformedEmbeddingPayloadOnce(params);
  throw new Error(
    `malformed ${params.adapter} embeddings response (${params.operation}): ${params.reason}`,
  );
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

export function expectEmbeddingObject(
  value: unknown,
  params: MalformedEmbeddingPayloadParams,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwMalformedEmbeddingPayload(params);
  }
  return value as Record<string, unknown>;
}

export function expectEmbeddingArray(
  value: unknown,
  params: MalformedEmbeddingPayloadParams,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throwMalformedEmbeddingPayload(params);
  }
  return value.map((entry, index) =>
    expectEmbeddingObject(entry, {
      ...params,
      reason: `${params.reason} (entry ${String(index)} was not an object)`,
      payload: entry,
    }),
  );
}

export function expectEmbeddingVector(
  value: unknown,
  params: MalformedEmbeddingPayloadParams,
): number[] {
  if (!isFiniteNumberArray(value)) {
    throwMalformedEmbeddingPayload(params);
  }
  return value;
}

export function resetEmbeddingResponseWarningCacheForTest(): void {
  warnedPayloads.clear();
}
