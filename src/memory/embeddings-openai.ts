import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  expectEmbeddingArray,
  expectEmbeddingVector,
  expectEmbeddingObject,
  throwMalformedEmbeddingPayload,
} from "./embedding-response-guards.js";

export type OpenAiEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const log = createSubsystemLogger("memory/embeddings");

export function normalizeOpenAiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}

export async function createOpenAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OpenAiEmbeddingClient }> {
  const client = await resolveOpenAiEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }
    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ model: client.model, input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai embeddings failed: ${res.status} ${text}`);
    }
    const payload = await res.json();
    const root = expectEmbeddingObject(payload, {
      logger: log,
      adapter: "openai",
      operation: input.length === 1 ? "embedQuery" : "embedBatch",
      reason: "response root was not an object",
      payload,
      client,
    });
    const data = expectEmbeddingArray(root.data, {
      logger: log,
      adapter: "openai",
      operation: input.length === 1 ? "embedQuery" : "embedBatch",
      reason: 'missing or invalid "data" array',
      payload,
      client,
    });
    if (data.length < input.length) {
      throwMalformedEmbeddingPayload({
        logger: log,
        adapter: "openai",
        operation: input.length === 1 ? "embedQuery" : "embedBatch",
        reason: `expected ${String(input.length)} embeddings but received ${String(data.length)}`,
        payload,
        client,
      });
    }
    return input.map((_, index) =>
      expectEmbeddingVector(data[index]?.embedding, {
        logger: log,
        adapter: "openai",
        operation: input.length === 1 ? "embedQuery" : "embedBatch",
        reason: `missing or invalid data[${String(index)}].embedding`,
        payload,
        client,
      }),
    );
  };

  return {
    provider: {
      id: "openai",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}

export async function resolveOpenAiEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OpenAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const apiKey = remoteApiKey
    ? remoteApiKey
    : requireApiKey(
        await resolveApiKeyForProvider({
          provider: "openai",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "openai",
      );

  const providerConfig = options.config.models?.providers?.openai;
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeOpenAiModel(options.model);
  return { baseUrl, headers, model };
}
