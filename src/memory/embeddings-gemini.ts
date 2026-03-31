import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  expectEmbeddingArray,
  expectEmbeddingObject,
  expectEmbeddingVector,
  throwMalformedEmbeddingPayload,
} from "./embedding-response-guards.js";

export type GeminiEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  modelPath: string;
};

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const debugEmbeddings = isTruthyEnvValue(process.env.OPENCLAW_DEBUG_MEMORY_EMBEDDINGS);
const log = createSubsystemLogger("memory/embeddings");

const debugLog = (message: string, meta?: Record<string, unknown>) => {
  if (!debugEmbeddings) {
    return;
  }
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  log.raw(`${message}${suffix}`);
};

function resolveRemoteApiKey(remoteApiKey?: string): string | undefined {
  const trimmed = remoteApiKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "GOOGLE_API_KEY" || trimmed === "GEMINI_API_KEY") {
    return process.env[trimmed]?.trim();
  }
  return trimmed;
}

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_GEMINI_EMBEDDING_MODEL;
  }
  const withoutPrefix = trimmed.replace(/^models\//, "");
  if (withoutPrefix.startsWith("gemini/")) {
    return withoutPrefix.slice("gemini/".length);
  }
  if (withoutPrefix.startsWith("google/")) {
    return withoutPrefix.slice("google/".length);
  }
  return withoutPrefix;
}

function normalizeGeminiBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  const openAiIndex = trimmed.indexOf("/openai");
  if (openAiIndex > -1) {
    return trimmed.slice(0, openAiIndex);
  }
  return trimmed;
}

function buildGeminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export async function createGeminiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: GeminiEmbeddingClient }> {
  const client = await resolveGeminiEmbeddingClient(options);
  const baseUrl = client.baseUrl.replace(/\/$/, "");
  const embedUrl = `${baseUrl}/${client.modelPath}:embedContent`;
  const batchUrl = `${baseUrl}/${client.modelPath}:batchEmbedContents`;

  const embedQuery = async (text: string): Promise<number[]> => {
    if (!text.trim()) {
      return [];
    }
    const res = await fetch(embedUrl, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`gemini embeddings failed: ${res.status} ${payload}`);
    }
    const payload = await res.json();
    const root = expectEmbeddingObject(payload, {
      logger: log,
      adapter: "gemini",
      operation: "embedQuery",
      reason: "response root was not an object",
      payload,
      client,
    });
    const embedding = expectEmbeddingObject(root.embedding, {
      logger: log,
      adapter: "gemini",
      operation: "embedQuery",
      reason: 'missing or invalid "embedding" object',
      payload,
      client,
    });
    return expectEmbeddingVector(embedding.values, {
      logger: log,
      adapter: "gemini",
      operation: "embedQuery",
      reason: 'missing or invalid "embedding.values" array',
      payload,
      client,
    });
  };

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) {
      return [];
    }
    const requests = texts.map((text) => ({
      model: client.modelPath,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }));
    const res = await fetch(batchUrl, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`gemini embeddings failed: ${res.status} ${payload}`);
    }
    const payload = await res.json();
    const root = expectEmbeddingObject(payload, {
      logger: log,
      adapter: "gemini",
      operation: "embedBatch",
      reason: "response root was not an object",
      payload,
      client,
    });
    const embeddings = expectEmbeddingArray(root.embeddings, {
      logger: log,
      adapter: "gemini",
      operation: "embedBatch",
      reason: 'missing or invalid "embeddings" array',
      payload,
      client,
    });
    if (embeddings.length < texts.length) {
      throwMalformedEmbeddingPayload({
        logger: log,
        adapter: "gemini",
        operation: "embedBatch",
        reason: `expected ${String(texts.length)} embeddings but received ${String(embeddings.length)}`,
        payload,
        client,
      });
    }
    return texts.map((_, index) =>
      expectEmbeddingVector(embeddings[index]?.values, {
        logger: log,
        adapter: "gemini",
        operation: "embedBatch",
        reason: `missing or invalid embeddings[${String(index)}].values`,
        payload,
        client,
      }),
    );
  };

  return {
    provider: {
      id: "gemini",
      model: client.model,
      embedQuery,
      embedBatch,
    },
    client,
  };
}

export async function resolveGeminiEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<GeminiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = resolveRemoteApiKey(remote?.apiKey);
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const apiKey = remoteApiKey
    ? remoteApiKey
    : requireApiKey(
        await resolveApiKeyForProvider({
          provider: "google",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "google",
      );

  const providerConfig = options.config.models?.providers?.google;
  const rawBaseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
  const baseUrl = normalizeGeminiBaseUrl(rawBaseUrl);
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    ...headerOverrides,
  };
  const model = normalizeGeminiModel(options.model);
  const modelPath = buildGeminiModelPath(model);
  debugLog("memory embeddings: gemini client", {
    rawBaseUrl,
    baseUrl,
    model,
    modelPath,
    embedEndpoint: `${baseUrl}/${modelPath}:embedContent`,
    batchEndpoint: `${baseUrl}/${modelPath}:batchEmbedContents`,
  });
  return { baseUrl, headers, model, modelPath };
}
