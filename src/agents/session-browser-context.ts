import { browserPageErrors, browserRequests } from "../browser/client-actions.js";
import { callGatewayTool } from "./tools/gateway.js";

const DEFAULT_BROWSER_CLEANUP_TIMEOUT_MS = 20_000;

export type BrowserSessionRoute =
  | {
      target: "host";
      profile?: string;
      targetId?: string;
      updatedAt: number;
    }
  | {
      target: "sandbox";
      baseUrl: string;
      profile?: string;
      targetId?: string;
      updatedAt: number;
    }
  | {
      target: "node";
      nodeId: string;
      profile?: string;
      targetId?: string;
      updatedAt: number;
    };

export type RecordBrowserSessionRouteParams = {
  sessionKey: string;
  target: "host" | "sandbox" | "node";
  profile?: string;
  targetId?: string | null;
  preserveTargetId?: boolean;
  baseUrl?: string;
  nodeId?: string;
};

export type BrowserRouteCleanupDeps = {
  browserRequests: typeof browserRequests;
  browserPageErrors: typeof browserPageErrors;
  callGatewayTool: typeof callGatewayTool;
};

type BrowserSessionRouteIdentity =
  | {
      target: "host";
      profile?: string;
    }
  | {
      target: "sandbox";
      baseUrl: string;
      profile?: string;
    }
  | {
      target: "node";
      nodeId: string;
      profile?: string;
    };

const sessionBrowserRoutes = new Map<string, BrowserSessionRoute>();

function normalizeSessionKey(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sameRouteIdentity(
  left: BrowserSessionRouteIdentity,
  right: BrowserSessionRouteIdentity,
): boolean {
  if (left.target !== right.target || left.profile !== right.profile) {
    return false;
  }
  if (left.target === "sandbox" && right.target === "sandbox") {
    return left.baseUrl === right.baseUrl;
  }
  if (left.target === "node" && right.target === "node") {
    return left.nodeId === right.nodeId;
  }
  return true;
}

function parseBrowserProxyResult(payload: unknown): unknown {
  const parsed =
    payload && typeof payload === "object" && "payload" in payload
      ? (payload as { payload?: unknown }).payload
      : undefined;
  if (parsed && typeof parsed === "object" && "result" in parsed) {
    return (parsed as { result: unknown }).result;
  }
  const payloadJSON =
    payload && typeof payload === "object" && "payloadJSON" in payload
      ? (payload as { payloadJSON?: unknown }).payloadJSON
      : undefined;
  if (typeof payloadJSON === "string" && payloadJSON.trim()) {
    const decoded = JSON.parse(payloadJSON) as { result?: unknown };
    if ("result" in decoded) {
      return decoded.result;
    }
  }
  throw new Error("browser proxy failed");
}

export function recordBrowserSessionRoute(
  params: RecordBrowserSessionRouteParams,
): BrowserSessionRoute | undefined {
  const sessionKey = normalizeSessionKey(params.sessionKey);
  if (!sessionKey) {
    return undefined;
  }

  const profile = normalizeOptionalString(params.profile);
  const nextBase =
    params.target === "sandbox"
      ? normalizeOptionalString(params.baseUrl)
      : undefined;
  const nextNodeId =
    params.target === "node"
      ? normalizeOptionalString(params.nodeId)
      : undefined;
  if (params.target === "sandbox" && !nextBase) {
    return undefined;
  }
  if (params.target === "node" && !nextNodeId) {
    return undefined;
  }

  const nextRouteBase =
    params.target === "host"
      ? ({ target: "host", profile } satisfies BrowserSessionRouteIdentity)
      : params.target === "sandbox"
        ? ({
            target: "sandbox",
            baseUrl: nextBase!,
            profile,
          } satisfies BrowserSessionRouteIdentity)
        : ({
            target: "node",
            nodeId: nextNodeId!,
            profile,
          } satisfies BrowserSessionRouteIdentity);

  const previous = sessionBrowserRoutes.get(sessionKey);
  const clearTargetId = params.targetId === null;
  const normalizedTargetId = clearTargetId
    ? undefined
    : normalizeOptionalString(params.targetId ?? undefined);
  const targetId =
    clearTargetId
      ? undefined
      : normalizedTargetId !== undefined
      ? normalizedTargetId
      : params.preserveTargetId &&
          previous &&
          sameRouteIdentity(previous, nextRouteBase)
        ? previous.targetId
        : undefined;

  const nextRoute: BrowserSessionRoute =
    targetId !== undefined
      ? { ...nextRouteBase, targetId, updatedAt: Date.now() }
      : { ...nextRouteBase, updatedAt: Date.now() };
  sessionBrowserRoutes.set(sessionKey, nextRoute);
  return nextRoute;
}

export function getBrowserSessionRoute(sessionKey: string): BrowserSessionRoute | undefined {
  const normalized = normalizeSessionKey(sessionKey);
  return normalized ? sessionBrowserRoutes.get(normalized) : undefined;
}

export function clearBrowserSessionRoute(sessionKey: string): void {
  const normalized = normalizeSessionKey(sessionKey);
  if (normalized) {
    sessionBrowserRoutes.delete(normalized);
  }
}

export function clearBrowserSessionRoutesForTests(): void {
  sessionBrowserRoutes.clear();
}

export async function clearObservedBrowserStateForRoute(
  route: BrowserSessionRoute,
  deps?: Partial<BrowserRouteCleanupDeps>,
): Promise<void> {
  const resolvedDeps: BrowserRouteCleanupDeps = {
    browserRequests,
    browserPageErrors,
    callGatewayTool,
    ...deps,
  };

  if (route.target === "node") {
    await Promise.all([
      resolvedDeps.callGatewayTool(
        "node.invoke",
        { timeoutMs: DEFAULT_BROWSER_CLEANUP_TIMEOUT_MS },
        {
          nodeId: route.nodeId,
          command: "browser.proxy",
          params: {
            method: "GET",
            path: "/requests",
            query: {
              clear: true,
              targetId: route.targetId,
              profile: route.profile,
            },
          },
        },
      ).then(parseBrowserProxyResult),
      resolvedDeps.callGatewayTool(
        "node.invoke",
        { timeoutMs: DEFAULT_BROWSER_CLEANUP_TIMEOUT_MS },
        {
          nodeId: route.nodeId,
          command: "browser.proxy",
          params: {
            method: "GET",
            path: "/errors",
            query: {
              clear: true,
              targetId: route.targetId,
              profile: route.profile,
            },
          },
        },
      ).then(parseBrowserProxyResult),
    ]);
    return;
  }

  const baseUrl = route.target === "sandbox" ? route.baseUrl : undefined;
  await Promise.all([
    resolvedDeps.browserRequests(baseUrl, {
      targetId: route.targetId,
      clear: true,
      profile: route.profile,
    }),
    resolvedDeps.browserPageErrors(baseUrl, {
      targetId: route.targetId,
      clear: true,
      profile: route.profile,
    }),
  ]);
}
