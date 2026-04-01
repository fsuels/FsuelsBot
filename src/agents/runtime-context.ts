import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

export type AgentRuntimeContext = {
  requestId: string | null;
  turnId: string | null;
  agentId: string | null;
  agentName: string | null;
  teamName: string | null;
  parentAgentId: string | null;
  parentSessionId: string | null;
  workload: string | null;
  cwd: string | null;
  repoRoot: string | null;
  agentDir: string | null;
  permissionScope: string | null;
  planModeRequired: boolean;
  isInProcess: boolean;
  traceId: string | null;
  sessionId: string | null;
  sessionKey: string | null;
  abortSignal: AbortSignal | null;
};

const CONTEXT_STORAGE = new AsyncLocalStorage<AgentRuntimeContext>();

const EMPTY_AGENT_CONTEXT: AgentRuntimeContext = Object.freeze({
  requestId: null,
  turnId: null,
  agentId: null,
  agentName: null,
  teamName: null,
  parentAgentId: null,
  parentSessionId: null,
  workload: null,
  cwd: null,
  repoRoot: null,
  agentDir: null,
  permissionScope: null,
  planModeRequired: false,
  isInProcess: false,
  traceId: null,
  sessionId: null,
  sessionKey: null,
  abortSignal: null,
});

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePathValue(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized ? path.resolve(normalized) : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

function resolveValue<TValue>(
  ctx: Partial<AgentRuntimeContext> | null | undefined,
  base: AgentRuntimeContext,
  key: keyof AgentRuntimeContext,
): TValue {
  if (ctx && Object.hasOwn(ctx, key)) {
    return ctx[key] as TValue;
  }
  return base[key] as TValue;
}

function normalizeContext(
  ctx?: Partial<AgentRuntimeContext> | null,
  base: AgentRuntimeContext = EMPTY_AGENT_CONTEXT,
): AgentRuntimeContext {
  if (!ctx) {
    return { ...base };
  }
  return {
    requestId: normalizeString(resolveValue<string | null>(ctx, base, "requestId")),
    turnId: normalizeString(resolveValue<string | null>(ctx, base, "turnId")),
    agentId: normalizeString(resolveValue<string | null>(ctx, base, "agentId")),
    agentName: normalizeString(resolveValue<string | null>(ctx, base, "agentName")),
    teamName: normalizeString(resolveValue<string | null>(ctx, base, "teamName")),
    parentAgentId: normalizeString(resolveValue<string | null>(ctx, base, "parentAgentId")),
    parentSessionId: normalizeString(resolveValue<string | null>(ctx, base, "parentSessionId")),
    workload: normalizeString(resolveValue<string | null>(ctx, base, "workload")),
    cwd: normalizePathValue(resolveValue<string | null>(ctx, base, "cwd")),
    repoRoot: normalizePathValue(resolveValue<string | null>(ctx, base, "repoRoot")),
    agentDir: normalizePathValue(resolveValue<string | null>(ctx, base, "agentDir")),
    permissionScope: normalizeString(resolveValue<string | null>(ctx, base, "permissionScope")),
    planModeRequired:
      normalizeBoolean(resolveValue<boolean>(ctx, base, "planModeRequired")) ?? false,
    isInProcess: normalizeBoolean(resolveValue<boolean>(ctx, base, "isInProcess")) ?? false,
    traceId: normalizeString(resolveValue<string | null>(ctx, base, "traceId")),
    sessionId: normalizeString(resolveValue<string | null>(ctx, base, "sessionId")),
    sessionKey: normalizeString(resolveValue<string | null>(ctx, base, "sessionKey")),
    abortSignal:
      resolveValue<AbortSignal | null>(ctx, base, "abortSignal") instanceof AbortSignal
        ? resolveValue<AbortSignal | null>(ctx, base, "abortSignal")
        : null,
  };
}

export function runWithAgentContext<T>(
  ctx: Partial<AgentRuntimeContext> | undefined,
  fn: () => T,
): T {
  return CONTEXT_STORAGE.run(normalizeContext(ctx, getAgentContext() ?? EMPTY_AGENT_CONTEXT), fn);
}

export function getAgentContext(): AgentRuntimeContext | undefined {
  return CONTEXT_STORAGE.getStore();
}

export function assertAgentContext(): AgentRuntimeContext {
  const context = getAgentContext();
  if (!context) {
    throw new Error("Agent runtime context is unavailable.");
  }
  return context;
}

export function bindAgentContext<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const captured = normalizeContext(getAgentContext(), EMPTY_AGENT_CONTEXT);
  return (...args: TArgs) => runWithAgentContext(captured, () => fn(...args));
}

export function resolveAgentRuntimeCwd(fallback?: string): string {
  const contextCwd = getAgentContext()?.cwd;
  if (contextCwd) {
    return contextCwd;
  }
  const normalizedFallback = normalizePathValue(fallback);
  return normalizedFallback ?? process.cwd();
}

export function resolveAgentContextPath(filePath: string, fallback?: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  return path.resolve(resolveAgentRuntimeCwd(fallback), filePath);
}

export const runWithExecutionContext = runWithAgentContext;
export const getExecutionContext = getAgentContext;
export const getWorkingDir = resolveAgentRuntimeCwd;
export const resolvePathForContext = resolveAgentContextPath;

export function isInProcessAgent(): boolean {
  return getAgentContext()?.isInProcess ?? false;
}

export function getAgentId(): string | undefined {
  return getAgentContext()?.agentId ?? undefined;
}

export function getAgentName(): string | undefined {
  return getAgentContext()?.agentName ?? undefined;
}

export function getTeamName(): string | undefined {
  return getAgentContext()?.teamName ?? undefined;
}

export function isPlanModeRequired(): boolean {
  return getAgentContext()?.planModeRequired ?? false;
}

export function getParentSessionId(): string | undefined {
  return getAgentContext()?.parentSessionId ?? undefined;
}

export function getAgentDir(): string | undefined {
  return getAgentContext()?.agentDir ?? undefined;
}
