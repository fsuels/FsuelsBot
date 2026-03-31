const generationsByHost = new WeakMap<object, Map<string, number>>();

function getGenerations(host: object): Map<string, number> {
  let generations = generationsByHost.get(host);
  if (!generations) {
    generations = new Map<string, number>();
    generationsByHost.set(host, generations);
  }
  return generations;
}

export function beginAsyncGeneration(host: object, key: string): number {
  const generations = getGenerations(host);
  const nextGeneration = (generations.get(key) ?? 0) + 1;
  generations.set(key, nextGeneration);
  return nextGeneration;
}

export function isCurrentAsyncGeneration(host: object, key: string, generation: number): boolean {
  return getGenerations(host).get(key) === generation;
}

export function logDroppedAsyncGeneration(key: string, details?: Record<string, unknown>): void {
  if (typeof console === "undefined" || typeof console.debug !== "function") {
    return;
  }
  console.debug(`[ui] dropped stale async result for ${key}`, details ?? {});
}
