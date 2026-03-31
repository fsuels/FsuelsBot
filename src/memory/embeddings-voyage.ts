import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  expectEmbeddingArray,
  expectEmbeddingObject,
  expectEmbeddingVector,
  throwMalformedEmbeddingPayload,
} from "./embedding-response-guards.js";

export type VoyageEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_VOYAGE_EMBEDDING_MODEL = "voyage-4-large";
const DEFAULT_VOYAGE_BASE_URL = "https://api.voyageai.com/v1";
const log = createSubsystemLogger("memory/embeddings");

export function normalizeVoyageModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_VOYAGE_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("voyage/")) {
    return trimmed.slice("voyage/".length);
  }
  return trimmed;
}

export async function createVoyageEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: VoyageEmbeddingClient }> {
  const client = await resolveVoyageEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (input: string[], input_type?: "query" | "document"): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }
    const body: { model: string; input: string[]; input_type?: "query" | "document" } = {
      model: client.model,
      input,
    };
    if (input_type) {
      body.input_type = input_type;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`voyage embeddings failed: ${res.status} ${text}`);
    }
    const payload = await res.json();
    const operation = input_type === "query" ? "embedQuery" : "embedBatch";
    const root = expectEmbeddingObject(payload, {
      logger: log,
      adapter: "voyage",
      operation,
      reason: "response root was not an object",
      payload,
      client,
    });
    const data = expectEmbeddingArray(root.data, {
      logger: log,
      adapter: "voyage",
      operation,
      reason: 'missing or invalid "data" array',
      payload,
      client,
    });
    if (data.length < input.length) {
      throwMalformedEmbeddingPayload({
        logger: log,
        adapter: "voyage",
        operation,
        reason: `expected ${String(input.length)} embeddings but received ${String(data.length)}`,
        payload,
        client,
      });
    }
    return input.map((_, index) =>
      expectEmbeddingVector(data[index]?.embedding, {
        logger: log,
        adapter: "voyage",
        operation,
        reason: `missing or invalid data[${String(index)}].embedding`,
        payload,
        client,
      }),
    );
  };

  return {
    provider: {
      id: "voyage",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text], "query");
        return vec ?? [];
      },
      embedBatch: async (texts) => embed(texts, "document"),
    },
    client,
  };
}

export async function resolveVoyageEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<VoyageEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const apiKey = remoteApiKey
    ? remoteApiKey
    : requireApiKey(
        await resolveApiKeyForProvider({
          provider: "voyage",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "voyage",
      );

  const providerConfig = options.config.models?.providers?.voyage;
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_VOYAGE_BASE_URL;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeVoyageModel(options.model);
  return { baseUrl, headers, model };
}
