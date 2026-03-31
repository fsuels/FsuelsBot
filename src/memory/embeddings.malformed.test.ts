import { afterEach, describe, expect, it, vi } from "vitest";

const { logWarnMock, logDebugMock, logInfoMock, logRawMock } = vi.hoisted(() => ({
  logWarnMock: vi.fn(),
  logDebugMock: vi.fn(),
  logInfoMock: vi.fn(),
  logRawMock: vi.fn(),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => {
    const logger = {
      warn: logWarnMock,
      debug: logDebugMock,
      info: logInfoMock,
      raw: logRawMock,
      child: () => logger,
    };
    return logger;
  },
}));

vi.mock("../agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(),
  requireApiKey: (auth: { apiKey?: string; mode?: string }, provider: string) => {
    if (auth?.apiKey) {
      return auth.apiKey;
    }
    throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth?.mode}).`);
  },
}));

describe("embedding adapter runtime guards", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("logs malformed OpenAI payloads once per adapter shape and throws a safe error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ nope: true }] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createOpenAiEmbeddingProvider } = await import("./embeddings-openai.js");

    const provider = await createOpenAiEmbeddingProvider({
      config: {} as never,
      provider: "openai",
      model: "text-embedding-3-small",
      fallback: "none",
      remote: { apiKey: "openai-key" },
    });

    await expect(provider.provider.embedQuery("hello")).rejects.toThrow(
      /malformed openai embeddings response/i,
    );
    await expect(provider.provider.embedQuery("hello again")).rejects.toThrow(
      /malformed openai embeddings response/i,
    );

    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith(
      "memory embeddings adapter returned malformed payload; using degraded path",
      expect.objectContaining({
        adapter: "openai",
        operation: "embedQuery",
      }),
    );
  });

  it("rejects malformed Gemini batch payloads instead of silently accepting drift", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [{ values: [1, 2, 3] }] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createGeminiEmbeddingProvider } = await import("./embeddings-gemini.js");

    const provider = await createGeminiEmbeddingProvider({
      config: {} as never,
      provider: "gemini",
      model: "gemini-embedding-001",
      fallback: "none",
      remote: { apiKey: "gemini-key" },
    });

    await expect(provider.provider.embedBatch(["doc-a", "doc-b"])).rejects.toThrow(
      /malformed gemini embeddings response/i,
    );
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith(
      "memory embeddings adapter returned malformed payload; using degraded path",
      expect.objectContaining({
        adapter: "gemini",
        operation: "embedBatch",
      }),
    );
  });

  it("rejects malformed Voyage payloads with a clear adapter-specific error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: ["bad"] }] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createVoyageEmbeddingProvider } = await import("./embeddings-voyage.js");

    const provider = await createVoyageEmbeddingProvider({
      config: {} as never,
      provider: "voyage",
      model: "voyage-4-large",
      fallback: "none",
      remote: { apiKey: "voyage-key" },
    });

    await expect(provider.provider.embedQuery("hello")).rejects.toThrow(
      /malformed voyage embeddings response/i,
    );
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith(
      "memory embeddings adapter returned malformed payload; using degraded path",
      expect.objectContaining({
        adapter: "voyage",
        operation: "embedQuery",
      }),
    );
  });
});
