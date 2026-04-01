import { createSingleflightCache } from "../../infra/singleflight.js";

type AnyFn = (...args: unknown[]) => unknown;

export function createLazyModuleLoader<TModule>(
  load: () => Promise<TModule>,
): () => Promise<TModule> {
  const gate = createSingleflightCache<string, TModule>({
    cacheSuccessMs: Number.POSITIVE_INFINITY,
    classifyError: () => "transient",
  });

  return async () => await gate.run("module", load);
}

export function lazyAsyncExport<
  TModule extends Record<string, unknown>,
  TKey extends keyof TModule,
>(load: () => Promise<TModule>, key: TKey): TModule[TKey] {
  return (async (...args: unknown[]) => {
    const module = await load();
    const candidate = module[key];
    if (typeof candidate !== "function") {
      throw new Error(`Plugin runtime adapter export "${String(key)}" is unavailable.`);
    }
    return await (candidate as AnyFn)(...args);
  }) as TModule[TKey];
}
