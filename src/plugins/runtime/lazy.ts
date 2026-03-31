type AnyFn = (...args: unknown[]) => unknown;

export function createLazyModuleLoader<TModule>(
  load: () => Promise<TModule>,
): () => Promise<TModule> {
  let loaded: TModule | null = null;
  let inflight: Promise<TModule> | null = null;

  return async () => {
    if (loaded) {
      return loaded;
    }
    if (inflight) {
      return inflight;
    }
    // Avoid pinning a rejected import forever; a repaired install should be able to retry.
    inflight = load()
      .then((module) => {
        loaded = module;
        inflight = null;
        return module;
      })
      .catch((error) => {
        inflight = null;
        throw error;
      });
    return await inflight;
  };
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
