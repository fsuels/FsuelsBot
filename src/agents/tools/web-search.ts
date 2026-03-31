import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import {
  buildCapabilityBlockedPayload,
  getCapabilityAuthStatus,
  getCapabilityStatus,
  isCapabilityEnabled,
  logCapabilityBlocked,
} from "../capability-gate.js";
import { jsonResult, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";
import {
  dedupeWebSearchSources,
  type WebSearchRawSearch,
  type WebSearchResultPayload,
  type WebSearchSource,
  WEB_SEARCH_SOURCE_REMINDER,
} from "./web-search-shared.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["brave", "perplexity", "grok"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];

const XAI_API_ENDPOINT = "https://api.x.ai/v1/responses";
const DEFAULT_GROK_MODEL = "grok-4-1-fast";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

const DomainFilterSchema = Type.Array(Type.String({ minLength: 1 }), {
  minItems: 1,
  uniqueItems: true,
});

const WebSearchSchema = Type.Object(
  {
    query: Type.String({
      description: "Search query string.",
      minLength: 2,
    }),
    allowedDomains: Type.Optional(DomainFilterSchema),
    blockedDomains: Type.Optional(DomainFilterSchema),
    maxUses: Type.Optional(
      Type.Number({
        description: "Compatibility alias that caps returned results when count is omitted.",
        minimum: 1,
        maximum: MAX_SEARCH_COUNT,
      }),
    ),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: MAX_SEARCH_COUNT,
      }),
    ),
    country: Type.Optional(
      Type.String({
        description:
          "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
      }),
    ),
    search_lang: Type.Optional(
      Type.String({
        description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
      }),
    ),
    ui_lang: Type.Optional(
      Type.String({
        description: "ISO language code for UI elements.",
      }),
    ),
    freshness: Type.Optional(
      Type.String({
        description:
          "Filter results by discovery time (Brave only). Values: 'pd' (past 24h), 'pw' (past week), 'pm' (past month), 'py' (past year), or date range 'YYYY-MM-DDtoYYYY-MM-DD'.",
      }),
    ),
  },
  { additionalProperties: false },
);

type WebSearchConfig = NonNullable<OpenClawConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexityConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type GrokConfig = {
  apiKey?: string;
  model?: string;
  inlineCitations?: boolean;
};

type GrokSearchResponse = {
  output_text?: string;
  citations?: string[];
  inline_citations?: Array<{
    start_index: number;
    end_index: number;
    url: string;
  }>;
};

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

type BraveMappedResult = {
  title: string;
  url: string;
  description: string;
  published?: string;
  siteName?: string;
};

type WebSearchProviderResult =
  | {
      query: string;
      provider: "brave";
      count: number;
      tookMs: number;
      cached?: boolean;
      results: BraveMappedResult[];
    }
  | {
      query: string;
      provider: "perplexity";
      model: string;
      tookMs: number;
      cached?: boolean;
      content: string;
      citations: string[];
    }
  | {
      query: string;
      provider: "grok";
      model: string;
      tookMs: number;
      cached?: boolean;
      content: string;
      citations: string[];
      inlineCitations?: GrokSearchResponse["inline_citations"];
    };

type WebSearchProgressDetails =
  | {
      type: "query_update";
      toolUseId: string;
      query: string;
    }
  | {
      type: "search_results_received";
      toolUseId: string;
      query: string;
      resultCount: number;
    };

function resolveSearchConfig(cfg?: OpenClawConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function resolveSearchApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string"
      ? normalizeSecretInput(search.apiKey)
      : "";
  const fromEnv = normalizeSecretInput(process.env.BRAVE_API_KEY);
  return fromConfig || fromEnv || undefined;
}

function missingSearchKeyPayload(provider: (typeof SEARCH_PROVIDERS)[number]) {
  if (provider === "perplexity") {
    return {
      error: "missing_perplexity_api_key",
      message:
        "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
      docs: "https://docs.openclaw.ai/tools/web",
    };
  }
  if (provider === "grok") {
    return {
      error: "missing_xai_api_key",
      message:
        "web_search (grok) needs an xAI API key. Set XAI_API_KEY in the Gateway environment, or configure tools.web.search.grok.apiKey.",
      docs: "https://docs.openclaw.ai/tools/web",
    };
  }
  return {
    error: "missing_brave_api_key",
    message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("openclaw configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment.`,
    docs: "https://docs.openclaw.ai/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "perplexity") {
    return "perplexity";
  }
  if (raw === "grok") {
    return "grok";
  }
  if (raw === "brave") {
    return "brave";
  }
  return "brave";
}

function getWebSearchCapabilityStatus(params: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
  mode?: "render" | "runtime";
}) {
  const search = resolveSearchConfig(params.config);
  const provider = resolveSearchProvider(search);
  return getCapabilityStatus({
    capability: "web_search",
    mode: params.mode,
    cacheKey: JSON.stringify({
      provider,
      enabled: search?.enabled ?? null,
      sandboxed: params.sandboxed === true,
    }),
    evaluate: () => {
      const visible = resolveSearchEnabled({ search, sandboxed: params.sandboxed });
      const auth =
        provider === "perplexity"
          ? getCapabilityAuthStatus({
              ok: Boolean(resolvePerplexityApiKey(resolvePerplexityConfig(search)).apiKey),
              reason: "missing_credentials",
            })
          : provider === "grok"
            ? getCapabilityAuthStatus({
                ok: Boolean(resolveGrokApiKey(resolveGrokConfig(search))),
                reason: "missing_credentials",
              })
            : getCapabilityAuthStatus({
                ok: Boolean(resolveSearchApiKey(search)),
                reason: "missing_credentials",
              });
      return {
        visible,
        auth,
        reasons: visible ? [] : ["build_flag_off"],
      };
    },
  });
}

function resolvePerplexityConfig(search?: WebSearchConfig): PerplexityConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const perplexity = "perplexity" in search ? search.perplexity : undefined;
  if (!perplexity || typeof perplexity !== "object") {
    return {};
  }
  return perplexity as PerplexityConfig;
}

function resolvePerplexityApiKey(perplexity?: PerplexityConfig): {
  apiKey?: string;
  source: PerplexityApiKeySource;
} {
  const fromConfig = normalizeApiKey(perplexity?.apiKey);
  if (fromConfig) {
    return { apiKey: fromConfig, source: "config" };
  }

  const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (fromEnvPerplexity) {
    return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
  }

  const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
  if (fromEnvOpenRouter) {
    return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
  }

  return { apiKey: undefined, source: "none" };
}

function normalizeApiKey(key: unknown): string {
  return normalizeSecretInput(key);
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) {
    return undefined;
  }
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(
  perplexity?: PerplexityConfig,
  apiKeySource: PerplexityApiKeySource = "none",
  apiKey?: string,
): string {
  const fromConfig =
    perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
      ? perplexity.baseUrl.trim()
      : "";
  if (fromConfig) {
    return fromConfig;
  }
  if (apiKeySource === "perplexity_env") {
    return PERPLEXITY_DIRECT_BASE_URL;
  }
  if (apiKeySource === "openrouter_env") {
    return DEFAULT_PERPLEXITY_BASE_URL;
  }
  if (apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
    if (inferred === "direct") {
      return PERPLEXITY_DIRECT_BASE_URL;
    }
    if (inferred === "openrouter") {
      return DEFAULT_PERPLEXITY_BASE_URL;
    }
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolvePerplexityModel(perplexity?: PerplexityConfig): string {
  const fromConfig =
    perplexity && "model" in perplexity && typeof perplexity.model === "string"
      ? perplexity.model.trim()
      : "";
  return fromConfig || DEFAULT_PERPLEXITY_MODEL;
}

function isDirectPerplexityBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase() === "api.perplexity.ai";
  } catch {
    return false;
  }
}

function resolvePerplexityRequestModel(baseUrl: string, model: string): string {
  if (!isDirectPerplexityBaseUrl(baseUrl)) {
    return model;
  }
  return model.startsWith("perplexity/") ? model.slice("perplexity/".length) : model;
}

function resolveGrokConfig(search?: WebSearchConfig): GrokConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const grok = "grok" in search ? search.grok : undefined;
  if (!grok || typeof grok !== "object") {
    return {};
  }
  return grok as GrokConfig;
}

function resolveGrokApiKey(grok?: GrokConfig): string | undefined {
  const fromConfig = normalizeApiKey(grok?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.XAI_API_KEY);
  return fromEnv || undefined;
}

function resolveGrokModel(grok?: GrokConfig): string {
  const fromConfig =
    grok && "model" in grok && typeof grok.model === "string" ? grok.model.trim() : "";
  return fromConfig || DEFAULT_GROK_MODEL;
}

function resolveGrokInlineCitations(grok?: GrokConfig): boolean {
  return grok?.inlineCitations === true;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
    return lower;
  }

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) {
    return undefined;
  }

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return undefined;
  }
  if (start > end) {
    return undefined;
  }

  return `${start}to${end}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function normalizeDomainFilter(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .toLowerCase() || undefined
    );
  }
}

function normalizeDomainFilters(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeDomainFilter(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return unique.size > 0 ? Array.from(unique) : undefined;
}

function applyDomainFiltersToQuery(params: {
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
}): string {
  const parts = [params.query.trim()].filter(Boolean);
  if (params.allowedDomains?.length === 1) {
    parts.push(`site:${params.allowedDomains[0]}`);
  } else if ((params.allowedDomains?.length ?? 0) > 1) {
    parts.push(`(${params.allowedDomains.map((domain) => `site:${domain}`).join(" OR ")})`);
  }
  if (params.blockedDomains?.length) {
    parts.push(...params.blockedDomains.map((domain) => `-site:${domain}`));
  }
  return parts.join(" ").trim();
}

function formatQueryForResultLine(query: string): string {
  return JSON.stringify(query);
}

function buildWebSearchFailurePayload(params: {
  originalQuery: string;
  errors: string[];
  durationMs?: number;
}): WebSearchResultPayload {
  return {
    originalQuery: params.originalQuery,
    rawSearches: [],
    commentary: [WEB_SEARCH_SOURCE_REMINDER],
    errors: params.errors,
    durationMs: params.durationMs ?? 0,
    dedupedSources: [],
  };
}

function buildErrorToolResult(params: {
  originalQuery: string;
  message: string;
  durationMs?: number;
}): AgentToolResult<WebSearchResultPayload> {
  const payload = buildWebSearchFailurePayload({
    originalQuery: params.originalQuery,
    errors: [params.message],
    durationMs: params.durationMs,
  });
  return {
    content: [{ type: "text", text: `Web search error: ${params.message}` }],
    details: payload,
  };
}

function buildSearchHitsFromCitations(citations: string[]): WebSearchSource[] {
  return citations
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({
      title: resolveSiteName(url) ?? url,
      url,
    }));
}

function emitWebSearchProgress(
  onUpdate: ((partialResult: AgentToolResult<WebSearchProgressDetails>) => void) | undefined,
  details: WebSearchProgressDetails,
) {
  if (!onUpdate) {
    return;
  }
  const text =
    details.type === "query_update"
      ? `Searching: ${details.query}`
      : `Found ${details.resultCount} results for ${formatQueryForResultLine(details.query)}`;
  onUpdate({
    content: [{ type: "text", text }],
    details,
  });
}

function renderBraveResultText(params: {
  executedQuery: string;
  result: Extract<WebSearchProviderResult, { provider: "brave" }>;
  dedupedSources: WebSearchSource[];
}): string {
  const lines = [
    `Found ${params.result.results.length} results for ${formatQueryForResultLine(params.executedQuery)} in ${params.result.tookMs}ms.`,
  ];
  if (params.result.cached) {
    lines.push("Served from cache.");
  }
  if (params.result.results.length === 0) {
    lines.push("No results found.");
  }
  for (const [index, entry] of params.result.results.entries()) {
    const wrappedTitle = entry.title ? wrapWebContent(entry.title, "web_search") : entry.url;
    lines.push(`${index + 1}. ${wrappedTitle || entry.url}`);
    lines.push(`URL: ${entry.url}`);
    if (entry.description) {
      lines.push(`Snippet: ${wrapWebContent(entry.description, "web_search")}`);
    }
    if (entry.published) {
      lines.push(`Published: ${entry.published}`);
    }
  }
  if (params.dedupedSources.length > 0) {
    lines.push("");
    lines.push("Sources:");
    for (const source of params.dedupedSources) {
      lines.push(`- ${source.title}: ${source.url}`);
    }
  }
  lines.push("");
  lines.push(WEB_SEARCH_SOURCE_REMINDER);
  return lines.join("\n");
}

function renderAiSearchResultText(params: {
  executedQuery: string;
  result: Extract<WebSearchProviderResult, { provider: "perplexity" | "grok" }>;
  dedupedSources: WebSearchSource[];
}): string {
  const lines = [
    `Search answer for ${formatQueryForResultLine(params.executedQuery)} (${params.result.provider}) in ${params.result.tookMs}ms.`,
  ];
  if (params.result.cached) {
    lines.push("Served from cache.");
  }
  lines.push("");
  lines.push(params.result.content);
  if (params.dedupedSources.length > 0) {
    lines.push("");
    lines.push("Sources:");
    for (const source of params.dedupedSources) {
      lines.push(`- ${source.title}: ${source.url}`);
    }
  } else {
    lines.push("");
    lines.push("No source URLs were returned.");
  }
  lines.push("");
  lines.push(WEB_SEARCH_SOURCE_REMINDER);
  return lines.join("\n");
}

function buildWebSearchSuccessResult(params: {
  toolUseId: string;
  originalQuery: string;
  executedQuery: string;
  result: WebSearchProviderResult;
}): AgentToolResult<WebSearchResultPayload> {
  const rawHits: WebSearchSource[] =
    params.result.provider === "brave"
      ? params.result.results.map((entry) => ({
          title: entry.title || resolveSiteName(entry.url) || entry.url,
          url: entry.url,
        }))
      : buildSearchHitsFromCitations(params.result.citations);
  const dedupedSources = dedupeWebSearchSources(rawHits);
  const rawSearch: WebSearchRawSearch = {
    toolUseId: params.toolUseId,
    executedQuery: params.executedQuery,
    hits: rawHits,
  };
  const payload: WebSearchResultPayload = {
    originalQuery: params.originalQuery,
    rawSearches: [rawSearch],
    commentary: [
      params.result.cached ? "Served from cache." : "Search executed.",
      WEB_SEARCH_SOURCE_REMINDER,
    ],
    errors: [],
    durationMs: params.result.tookMs,
    dedupedSources,
  };
  const text =
    params.result.provider === "brave"
      ? renderBraveResultText({
          executedQuery: params.executedQuery,
          result: params.result,
          dedupedSources,
        })
      : renderAiSearchResultText({
          executedQuery: params.executedQuery,
          result: params.result,
          dedupedSources,
        });
  return {
    content: [{ type: "text", text }],
    details: payload,
  };
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}): Promise<{ content: string; citations: string[] }> {
  const baseUrl = params.baseUrl.trim().replace(/\/$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = resolvePerplexityRequestModel(baseUrl, params.model);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://openclaw.ai",
      "X-Title": "OpenClaw Web Search",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: params.query,
        },
      ],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as PerplexitySearchResponse;
  const content = data.choices?.[0]?.message?.content ?? "No response";
  const citations = data.citations ?? [];

  return { content, citations };
}

async function runGrokSearch(params: {
  query: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  inlineCitations: boolean;
}): Promise<{
  content: string;
  citations: string[];
  inlineCitations?: GrokSearchResponse["inline_citations"];
}> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: [
      {
        role: "user",
        content: params.query,
      },
    ],
    tools: [{ type: "web_search" }],
  };

  if (params.inlineCitations) {
    body.include = ["inline_citations"];
  }

  const res = await fetch(XAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`xAI API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as GrokSearchResponse;
  const content = data.output_text ?? "No response";
  const citations = data.citations ?? [];
  const inlineCitations = data.inline_citations;

  return { content, citations, inlineCitations };
}

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  perplexityBaseUrl?: string;
  perplexityModel?: string;
  grokModel?: string;
  grokInlineCitations?: boolean;
}): Promise<WebSearchProviderResult> {
  const cacheKey = normalizeCacheKey(
    params.provider === "brave"
      ? `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}:${params.freshness || "default"}`
      : params.provider === "perplexity"
        ? `${params.provider}:${params.query}:${params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL}:${params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL}`
        : `${params.provider}:${params.query}:${params.grokModel ?? DEFAULT_GROK_MODEL}:${String(params.grokInlineCitations ?? false)}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...(cached.value as WebSearchProviderResult), cached: true };
  }

  const start = Date.now();

  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "grok") {
    const { content, citations, inlineCitations } = await runGrokSearch({
      query: params.query,
      apiKey: params.apiKey,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      inlineCitations: params.grokInlineCitations ?? false,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      tookMs: Date.now() - start,
      content: wrapWebContent(content),
      citations,
      inlineCitations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    url.searchParams.set("ui_lang", params.ui_lang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  const mapped = results.map((entry) => {
    const description = entry.description ?? "";
    const title = entry.title ?? "";
    const url = entry.url ?? "";
    const rawSiteName = resolveSiteName(url);
    return {
      title,
      url, // Keep raw for tool chaining
      description,
      published: entry.age || undefined,
      siteName: rawSiteName || undefined,
    };
  });

  const payload = {
    query: params.query,
    provider: params.provider,
    count: mapped.length,
    tookMs: Date.now() - start,
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const capabilityStatus = getWebSearchCapabilityStatus({
    config: options?.config,
    sandboxed: options?.sandboxed,
    mode: "render",
  });
  if (!isCapabilityEnabled(capabilityStatus)) {
    return null;
  }

  const search = resolveSearchConfig(options?.config);
  const provider = resolveSearchProvider(search);
  const perplexityConfig = resolvePerplexityConfig(search);
  const grokConfig = resolveGrokConfig(search);

  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with structured source lists from real-time web search. When citing results later, use only the URLs returned by this tool."
      : provider === "grok"
        ? "Search the web using xAI Grok. Returns AI-synthesized answers with structured source lists from real-time web search. When citing results later, use only the URLs returned by this tool."
        : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters, plus allow/block domain filters. Returns structured source lists for fast research. When citing results later, use only the URLs returned by this tool.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    isReadOnly: () => true,
    execute: async (toolCallId, args, _signal, onUpdate) => {
      const runtimeStatus = getWebSearchCapabilityStatus({
        config: options?.config,
        sandboxed: options?.sandboxed,
        mode: "runtime",
      });
      if (!isCapabilityEnabled(runtimeStatus)) {
        const blocked = missingSearchKeyPayload(provider);
        logCapabilityBlocked(runtimeStatus, {
          provider,
          tool: "web_search",
        });
        return jsonResult(
          buildCapabilityBlockedPayload(runtimeStatus, {
            message: blocked.message,
            extra: {
              providerError: blocked.error,
              docs: blocked.docs,
            },
          }),
        );
      }

      const perplexityAuth =
        provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
      const apiKey =
        provider === "perplexity"
          ? perplexityAuth?.apiKey
          : provider === "grok"
            ? resolveGrokApiKey(grokConfig)
            : resolveSearchApiKey(search);

      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload(provider));
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      if (query.trim().length < 2) {
        return buildErrorToolResult({
          originalQuery: query,
          message: "query must be at least 2 characters long.",
        });
      }
      const allowedDomains = normalizeDomainFilters(readStringArrayParam(params, "allowedDomains"));
      const blockedDomains = normalizeDomainFilters(readStringArrayParam(params, "blockedDomains"));
      if (allowedDomains && blockedDomains) {
        return buildErrorToolResult({
          originalQuery: query,
          message: "allowedDomains and blockedDomains cannot both be set.",
        });
      }
      const count =
        readNumberParam(params, "count", { integer: true }) ??
        readNumberParam(params, "maxUses", { integer: true }) ??
        search?.maxResults ??
        undefined;
      const country = readStringParam(params, "country");
      const search_lang = readStringParam(params, "search_lang");
      const ui_lang = readStringParam(params, "ui_lang");
      const rawFreshness = readStringParam(params, "freshness");
      if (rawFreshness && provider !== "brave") {
        return buildErrorToolResult({
          originalQuery: query,
          message: "freshness is only supported by the Brave web_search provider.",
        });
      }
      const freshness = rawFreshness ? normalizeFreshness(rawFreshness) : undefined;
      if (rawFreshness && !freshness) {
        return buildErrorToolResult({
          originalQuery: query,
          message:
            "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
        });
      }
      const executedQuery = applyDomainFiltersToQuery({
        query,
        allowedDomains,
        blockedDomains,
      });
      emitWebSearchProgress(onUpdate, {
        type: "query_update",
        toolUseId: toolCallId,
        query: executedQuery,
      });
      const result = await runWebSearch({
        query: executedQuery,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        country,
        search_lang,
        ui_lang,
        freshness,
        perplexityBaseUrl: resolvePerplexityBaseUrl(
          perplexityConfig,
          perplexityAuth?.source,
          perplexityAuth?.apiKey,
        ),
        perplexityModel: resolvePerplexityModel(perplexityConfig),
        grokModel: resolveGrokModel(grokConfig),
        grokInlineCitations: resolveGrokInlineCitations(grokConfig),
      });
      const built = buildWebSearchSuccessResult({
        toolUseId: toolCallId,
        originalQuery: query,
        executedQuery,
        result,
      });
      emitWebSearchProgress(onUpdate, {
        type: "search_results_received",
        toolUseId: toolCallId,
        query: executedQuery,
        resultCount: built.details.rawSearches[0]?.hits.length ?? 0,
      });
      return built;
    },
  };
}

export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  isDirectPerplexityBaseUrl,
  resolvePerplexityRequestModel,
  normalizeFreshness,
  resolveGrokApiKey,
  resolveGrokModel,
  resolveGrokInlineCitations,
  normalizeDomainFilters,
  applyDomainFiltersToQuery,
  buildWebSearchFailurePayload,
} as const;
