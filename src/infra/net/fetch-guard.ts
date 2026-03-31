import type { Dispatcher } from "undici";
import {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostname,
  resolvePinnedHostnameWithPolicy,
  SsrFBlockedError,
  type SsrFBlockCode,
  type LookupFn,
  type SsrFPolicy,
  validateFetchUrl,
} from "./ssrf.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type GuardedFetchOptions = {
  url: string;
  fetchImpl?: FetchLike;
  init?: RequestInit;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  policy?: SsrFPolicy;
  lookupFn?: LookupFn;
  pinDns?: boolean;
  redirectScope?: RedirectScope;
};

export type GuardedFetchResult = {
  response: Response;
  finalUrl: string;
  release: () => Promise<void>;
};

const DEFAULT_MAX_REDIRECTS = 3;

export type RedirectScope = {
  protocol: "http:" | "https:";
  hostname: string;
  port?: string;
  pathPrefix?: string;
  allowWwwVariant?: boolean;
};

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === "http:") {
    return "80";
  }
  if (protocol === "https:") {
    return "443";
  }
  return "";
}

function normalizeScopeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function normalizeScopePort(scope: RedirectScope): string {
  return scope.port || defaultPortForProtocol(scope.protocol);
}

function stripSingleWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function hostnameWithinScope(hostname: string, scope: RedirectScope): boolean {
  const normalizedScopeHostname = normalizeScopeHostname(scope.hostname);
  if (hostname === normalizedScopeHostname) {
    return true;
  }
  if (!scope.allowWwwVariant) {
    return false;
  }
  if (stripSingleWww(hostname) !== stripSingleWww(normalizedScopeHostname)) {
    return false;
  }
  return hostname.startsWith("www.") || normalizedScopeHostname.startsWith("www.");
}

export function buildRedirectScope(
  value: string | URL,
  options?: { pathPrefix?: string; allowWwwVariant?: boolean },
): RedirectScope {
  const parsed = typeof value === "string" ? new URL(value) : new URL(value.toString());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Invalid redirect scope URL: must be http or https");
  }
  return {
    protocol: parsed.protocol as "http:" | "https:",
    hostname: normalizeScopeHostname(parsed.hostname),
    port: parsed.port || defaultPortForProtocol(parsed.protocol),
    pathPrefix: options?.pathPrefix ?? parsed.pathname,
    allowWwwVariant: options?.allowWwwVariant ?? true,
  };
}

function normalizePathPrefix(pathPrefix: string | undefined): string | undefined {
  const trimmed = pathPrefix?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "/") {
    return "/";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function pathnameWithinScope(pathname: string, pathPrefix: string | undefined): boolean {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  if (!normalizedPrefix || normalizedPrefix === "/") {
    return true;
  }
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`);
}

function blockRedirect(
  reason: string,
  details: Record<string, unknown>,
  code: SsrFBlockCode = "REDIRECT_TARGET_BLOCKED",
): never {
  throw new SsrFBlockedError(code, `Blocked redirect target: ${reason}`, details);
}

function assertRedirectWithinScope(params: {
  redirectScope?: RedirectScope;
  originalUrl: string;
  redirectUrl: string;
  redirectStatus: number;
  targetUrl: URL;
  normalizedHostname: string;
  normalizedPort: string;
}) {
  const { redirectScope, originalUrl, redirectUrl, redirectStatus, targetUrl } = params;
  if (!redirectScope) {
    return;
  }
  const details = {
    originalUrl,
    redirectUrl,
    statusCode: redirectStatus,
    scope: {
      protocol: redirectScope.protocol,
      hostname: redirectScope.hostname,
      port: normalizeScopePort(redirectScope),
      pathPrefix: normalizePathPrefix(redirectScope.pathPrefix),
    },
  };

  if (!hostnameWithinScope(params.normalizedHostname, redirectScope)) {
    blockRedirect("hostname left the allowed scope", details);
  }
  if (params.normalizedPort !== normalizeScopePort(redirectScope)) {
    blockRedirect("port left the allowed scope", details);
  }
  if (!pathnameWithinScope(targetUrl.pathname, redirectScope.pathPrefix)) {
    blockRedirect("path left the allowed scope", details);
  }
}

function buildAbortSignal(params: { timeoutMs?: number; signal?: AbortSignal }): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const { timeoutMs, signal } = params;
  if (!timeoutMs && !signal) {
    return { signal: undefined, cleanup: () => {} };
  }

  if (!timeoutMs) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

export async function fetchWithSsrFGuard(params: GuardedFetchOptions): Promise<GuardedFetchResult> {
  const fetcher: FetchLike | undefined = params.fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("fetch is not available");
  }

  const maxRedirects =
    typeof params.maxRedirects === "number" && Number.isFinite(params.maxRedirects)
      ? Math.max(0, Math.floor(params.maxRedirects))
      : DEFAULT_MAX_REDIRECTS;

  const { signal, cleanup } = buildAbortSignal({
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });

  let released = false;
  const release = async (dispatcher?: Dispatcher | null) => {
    if (released) {
      return;
    }
    released = true;
    cleanup();
    await closeDispatcher(dispatcher ?? undefined);
  };

  const visited = new Set<string>();
  let currentUrl = params.url;
  let redirectCount = 0;

  while (true) {
    let parsedUrl: URL;
    let canonicalCurrentUrl = currentUrl;
    try {
      const validated = validateFetchUrl(currentUrl, { policy: params.policy });
      parsedUrl = validated.url;
      canonicalCurrentUrl = validated.canonicalUrl;
    } catch (err) {
      await release();
      throw err;
    }

    let dispatcher: Dispatcher | null = null;
    try {
      const usePolicy = Boolean(
        params.policy?.allowPrivateNetwork ||
        params.policy?.allowedHostnames?.length ||
        params.policy?.blockedHostnames?.length,
      );
      const pinned = usePolicy
        ? await resolvePinnedHostnameWithPolicy(parsedUrl.hostname, {
            lookupFn: params.lookupFn,
            policy: params.policy,
          })
        : await resolvePinnedHostname(parsedUrl.hostname, params.lookupFn);
      if (params.pinDns !== false) {
        dispatcher = createPinnedDispatcher(pinned);
      }

      const init: RequestInit & { dispatcher?: Dispatcher } = {
        ...(params.init ? { ...params.init } : {}),
        redirect: "manual",
        ...(dispatcher ? { dispatcher } : {}),
        ...(signal ? { signal } : {}),
      };

      const response = await fetcher(canonicalCurrentUrl, init);

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          await release(dispatcher);
          throw new Error(`Redirect missing location header (${response.status})`);
        }
        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          await release(dispatcher);
          throw new Error(`Too many redirects (limit: ${maxRedirects})`);
        }
        const nextUrlRaw = new URL(location, parsedUrl).toString();
        const validatedRedirect = validateFetchUrl(nextUrlRaw, { policy: params.policy });
        assertRedirectWithinScope({
          redirectScope: params.redirectScope,
          originalUrl: canonicalCurrentUrl,
          redirectUrl: validatedRedirect.canonicalUrl,
          redirectStatus: response.status,
          targetUrl: validatedRedirect.url,
          normalizedHostname: validatedRedirect.normalizedHostname,
          normalizedPort: validatedRedirect.normalizedPort,
        });
        if (visited.has(validatedRedirect.canonicalUrl)) {
          await release(dispatcher);
          throw new Error("Redirect loop detected");
        }
        visited.add(validatedRedirect.canonicalUrl);
        void response.body?.cancel();
        await closeDispatcher(dispatcher);
        currentUrl = validatedRedirect.canonicalUrl;
        continue;
      }

      return {
        response,
        finalUrl: canonicalCurrentUrl,
        release: async () => release(dispatcher),
      };
    } catch (err) {
      await release(dispatcher);
      throw err;
    }
  }
}
