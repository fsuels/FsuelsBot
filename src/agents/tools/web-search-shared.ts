export type WebSearchSource = {
  title: string;
  url: string;
};

export type WebSearchRawSearch = {
  toolUseId: string;
  executedQuery: string;
  hits: WebSearchSource[];
};

export type WebSearchResultPayload = {
  originalQuery: string;
  rawSearches: WebSearchRawSearch[];
  commentary: string[];
  errors: string[];
  durationMs: number;
  dedupedSources: WebSearchSource[];
};

export const WEB_SEARCH_SOURCE_REMINDER =
  "Use only dedupedSources from this tool when producing the final Sources section.";

function resolveFallbackTitle(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function canonicalizeWebSearchUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function dedupeWebSearchSources(sources: WebSearchSource[]): WebSearchSource[] {
  const deduped: WebSearchSource[] = [];
  const byUrl = new Map<string, number>();

  for (const source of sources) {
    const canonicalUrl = canonicalizeWebSearchUrl(source.url);
    if (!canonicalUrl) {
      continue;
    }
    const title = source.title.trim() || resolveFallbackTitle(canonicalUrl);
    const existingIndex = byUrl.get(canonicalUrl);
    if (existingIndex === undefined) {
      byUrl.set(canonicalUrl, deduped.length);
      deduped.push({ title, url: canonicalUrl });
      continue;
    }
    const existing = deduped[existingIndex];
    if (!existing.title.trim() && title) {
      deduped[existingIndex] = { title, url: canonicalUrl };
      continue;
    }
    const existingFallback = resolveFallbackTitle(existing.url);
    if (existing.title === existingFallback && title !== existingFallback) {
      deduped[existingIndex] = { title, url: canonicalUrl };
    }
  }

  return deduped;
}

export function mergeWebSearchSources(
  sourceGroups: Array<WebSearchSource[] | undefined>,
): WebSearchSource[] {
  return dedupeWebSearchSources(sourceGroups.flatMap((group) => group ?? []));
}

function isWebSearchSource(value: unknown): value is WebSearchSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.title === "string" && typeof record.url === "string";
}

function isWebSearchRawSearch(value: unknown): value is WebSearchRawSearch {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.toolUseId === "string" &&
    typeof record.executedQuery === "string" &&
    Array.isArray(record.hits) &&
    record.hits.every(isWebSearchSource)
  );
}

export function isWebSearchResultPayload(value: unknown): value is WebSearchResultPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.originalQuery === "string" &&
    Array.isArray(record.rawSearches) &&
    record.rawSearches.every(isWebSearchRawSearch) &&
    Array.isArray(record.commentary) &&
    record.commentary.every((entry) => typeof entry === "string") &&
    Array.isArray(record.errors) &&
    record.errors.every((entry) => typeof entry === "string") &&
    typeof record.durationMs === "number" &&
    Array.isArray(record.dedupedSources) &&
    record.dedupedSources.every(isWebSearchSource)
  );
}

export function formatWebSearchSourcesSection(sources: WebSearchSource[]): string {
  const deduped = dedupeWebSearchSources(sources);
  if (deduped.length === 0) {
    return "";
  }
  return [
    "Sources:",
    ...deduped.map((source) =>
      source.title.trim() && source.title.trim() !== source.url
        ? `- ${source.title}: ${source.url}`
        : `- ${source.url}`,
    ),
  ].join("\n");
}
