import type { OpenClawConfig } from "../config/types.js";
import { loadBootstrapConfig } from "../config/bootstrap.js";
import { createSingleflightCache } from "../infra/singleflight.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import { ensureOpenClawModelsJson } from "./models-config.js";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type DiscoveredModel = {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type PiSdkModule = typeof import("./pi-model-discovery.js");

let hasLoggedModelCatalogError = false;
const defaultImportPiSdk = () => import("./pi-model-discovery.js");
let importPiSdk = defaultImportPiSdk;
const MODEL_CATALOG_KEY = "model-catalog";
const modelCatalogLoadGate = createSingleflightCache<string, ModelCatalogEntry[]>({
  cacheSuccessMs: Number.POSITIVE_INFINITY,
  classifyError: () => "transient",
  shouldCacheSuccess: (entries) => entries.length > 0,
});

export function resetModelCatalogCacheForTest() {
  modelCatalogLoadGate.clear();
  hasLoggedModelCatalogError = false;
  importPiSdk = defaultImportPiSdk;
}

// Test-only escape hatch: allow mocking the dynamic import to simulate transient failures.
export function __setModelCatalogImportForTest(loader?: () => Promise<PiSdkModule>) {
  importPiSdk = loader ?? defaultImportPiSdk;
}

export async function loadModelCatalog(params?: {
  config?: OpenClawConfig;
  useCache?: boolean;
}): Promise<ModelCatalogEntry[]> {
  if (params?.useCache === false) {
    modelCatalogLoadGate.clear(MODEL_CATALOG_KEY);
  }

  try {
    return await modelCatalogLoadGate.run(MODEL_CATALOG_KEY, async () => {
      const models: ModelCatalogEntry[] = [];
      const sortModels = (entries: ModelCatalogEntry[]) =>
        entries.sort((a, b) => {
          const p = a.provider.localeCompare(b.provider);
          if (p !== 0) {
            return p;
          }
          return a.name.localeCompare(b.name);
        });
      try {
        const cfg = params?.config ?? loadBootstrapConfig();
        await ensureOpenClawModelsJson(cfg);
        // IMPORTANT: keep the dynamic import *inside* the try/catch.
        // If this fails once (e.g. during a pnpm install that temporarily swaps node_modules),
        // we must not poison the cache with a rejected promise (otherwise all channel handlers
        // will keep failing until restart).
        const piSdk = await importPiSdk();
        const agentDir = resolveOpenClawAgentDir();
        const { join } = await import("node:path");
        const authStorage = new piSdk.AuthStorage(join(agentDir, "auth.json"));
        const registry = new piSdk.ModelRegistry(authStorage, join(agentDir, "models.json")) as
          | {
              getAll: () => Array<DiscoveredModel>;
            }
          | Array<DiscoveredModel>;
        const entries = Array.isArray(registry) ? registry : registry.getAll();
        for (const entry of entries) {
          const id = String(entry?.id ?? "").trim();
          if (!id) {
            continue;
          }
          const provider = String(entry?.provider ?? "").trim();
          if (!provider) {
            continue;
          }
          const name = String(entry?.name ?? id).trim() || id;
          const contextWindow =
            typeof entry?.contextWindow === "number" && entry.contextWindow > 0
              ? entry.contextWindow
              : undefined;
          const reasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : undefined;
          const input = Array.isArray(entry?.input) ? entry.input : undefined;
          models.push({ id, name, provider, contextWindow, reasoning, input });
        }

        return sortModels(models);
      } catch (error) {
        if (models.length > 0) {
          if (!hasLoggedModelCatalogError) {
            hasLoggedModelCatalogError = true;
            console.warn(`[model-catalog] Failed to load model catalog: ${String(error)}`);
          }
          return sortModels(models);
        }
        throw error;
      }
    });
  } catch (error) {
    if (!hasLoggedModelCatalogError) {
      hasLoggedModelCatalogError = true;
      console.warn(`[model-catalog] Failed to load model catalog: ${String(error)}`);
    }
    return [];
  }
}

/**
 * Check if a model supports image input based on its catalog entry.
 */
export function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  return entry?.input?.includes("image") ?? false;
}

/**
 * Find a model in the catalog by provider and model ID.
 */
export function findModelInCatalog(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedModelId = modelId.toLowerCase().trim();
  return catalog.find(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.id.toLowerCase() === normalizedModelId,
  );
}
