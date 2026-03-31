import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import crypto from "node:crypto";
import path from "node:path";

const MAX_ERROR_LOG_ENTRIES = 20;
const MAX_SLOW_OPERATION_ENTRIES = 20;

export type EmbeddedRuntimeSessionSnapshot = Readonly<{
  sessionId: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  currentPromptId?: string;
  lastMainRequestId?: string;
  lastApiCompletionTimestamp?: number;
}>;

export type EmbeddedRuntimePathsSnapshot = Readonly<{
  originalWorkspaceRoot?: string;
  stableProjectRoot?: string;
  activeWorkingDir?: string;
  sessionFile?: string;
  sessionStorageDir?: string;
}>;

export type EmbeddedRuntimeToolProtocolSnapshot = Readonly<{
  strictToolResultPairing: boolean;
  allowSyntheticToolResults: boolean;
}>;

export type EmbeddedRuntimePromptCacheSnapshot = Readonly<{
  lastCacheTouchAt?: number | null;
}>;

export type EmbeddedRuntimeErrorEntry = Readonly<{
  ts: number;
  phase: string;
  message: string;
  details?: Record<string, unknown>;
}>;

export type EmbeddedRuntimeSlowOperationEntry = Readonly<{
  ts: number;
  label: string;
  durationMs: number;
  details?: Record<string, unknown>;
}>;

export type EmbeddedRuntimeRequestSnapshot = Readonly<{
  promptId: string;
  requestId?: string;
  recordedAt: number;
  sessionId: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  wasPostCompaction: boolean;
  model?: Record<string, unknown>;
  options?: Record<string, unknown>;
  system?: unknown;
  messages: AgentMessage[];
}>;

export type EmbeddedRuntimeDebugSnapshot = Readonly<{
  lastRequest: EmbeddedRuntimeRequestSnapshot | null;
  errorLog: readonly EmbeddedRuntimeErrorEntry[];
  slowOperations: readonly EmbeddedRuntimeSlowOperationEntry[];
}>;

export type EmbeddedRuntimeStateInit = {
  sessionId?: string;
  sessionKey?: string;
  parentSessionId?: string;
  parentSessionKey?: string;
  sessionFile?: string;
  originalWorkspaceRoot?: string;
  stableProjectRoot?: string;
  activeWorkingDir?: string;
  strictToolResultPairing?: boolean;
  allowSyntheticToolResults?: boolean;
};

type EmbeddedRuntimeMutableState = {
  session: {
    sessionId: string;
    sessionKey?: string;
    parentSessionId?: string;
    parentSessionKey?: string;
    currentPromptId?: string;
    lastMainRequestId?: string;
    lastApiCompletionTimestamp?: number;
    postCompactionPending: boolean;
  };
  paths: {
    originalWorkspaceRoot?: string;
    stableProjectRoot?: string;
    activeWorkingDir?: string;
    sessionFile?: string;
    sessionStorageDir?: string;
  };
  toolProtocol: {
    strictToolResultPairing: boolean;
    allowSyntheticToolResults: boolean;
  };
  promptCache: {
    lastCacheTouchAt?: number | null;
  };
  debug: {
    lastRequest: EmbeddedRuntimeRequestSnapshot | null;
    errorLog: EmbeddedRuntimeErrorEntry[];
    slowOperations: EmbeddedRuntimeSlowOperationEntry[];
  };
  extensions: Map<string, unknown>;
};

export type EmbeddedRuntimeState = {
  switchSession: (params: {
    sessionId: string;
    sessionFile?: string;
  }) => EmbeddedRuntimeSessionSnapshot;
  regenerateSessionId: (opts?: {
    setCurrentAsParent?: boolean;
    sessionFile?: string;
  }) => EmbeddedRuntimeSessionSnapshot;
  setSessionKey: (sessionKey?: string) => EmbeddedRuntimeSessionSnapshot;
  setParentSessionId: (parentSessionId?: string) => EmbeddedRuntimeSessionSnapshot;
  setParentSessionKey: (parentSessionKey?: string) => EmbeddedRuntimeSessionSnapshot;
  setOriginalWorkspaceRoot: (originalWorkspaceRoot?: string) => EmbeddedRuntimePathsSnapshot;
  setStableProjectRoot: (stableProjectRoot?: string) => EmbeddedRuntimePathsSnapshot;
  setActiveWorkingDir: (activeWorkingDir?: string) => EmbeddedRuntimePathsSnapshot;
  setToolProtocol: (patch: {
    strictToolResultPairing?: boolean;
    allowSyntheticToolResults?: boolean;
  }) => EmbeddedRuntimeToolProtocolSnapshot;
  setPromptCacheLastTouchAt: (
    lastCacheTouchAt?: number | null,
  ) => EmbeddedRuntimePromptCacheSnapshot;
  markApiCompletion: (timestamp?: number) => EmbeddedRuntimeSessionSnapshot;
  markPostCompaction: () => void;
  consumePostCompaction: () => boolean;
  recordFinalRequest: (params: {
    requestId?: string;
    recordedAt?: number;
    promptId?: string;
    provider?: string;
    modelId?: string;
    modelApi?: string | null;
    model?: Record<string, unknown>;
    options?: Record<string, unknown>;
    system?: unknown;
    messages: AgentMessage[];
    wasPostCompaction?: boolean;
  }) => EmbeddedRuntimeRequestSnapshot;
  recordError: (entry: {
    ts?: number;
    phase: string;
    message: string;
    details?: Record<string, unknown>;
  }) => EmbeddedRuntimeErrorEntry;
  recordSlowOperation: (entry: {
    ts?: number;
    label: string;
    durationMs: number;
    details?: Record<string, unknown>;
  }) => EmbeddedRuntimeSlowOperationEntry;
  setExtensionRuntime: (key: string, value: unknown | null) => void;
  getExtensionRuntime: <T = unknown>(key: string) => T | null;
  getSessionSnapshot: () => EmbeddedRuntimeSessionSnapshot;
  getPathsSnapshot: () => EmbeddedRuntimePathsSnapshot;
  getToolProtocolSnapshot: () => EmbeddedRuntimeToolProtocolSnapshot;
  getPromptCacheSnapshot: () => EmbeddedRuntimePromptCacheSnapshot;
  getLastRequestSnapshot: () => EmbeddedRuntimeRequestSnapshot | null;
  getDebugSnapshot: () => EmbeddedRuntimeDebugSnapshot;
};

const REGISTRY = new WeakMap<object, EmbeddedRuntimeState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Fall back to JSON-safe cloning below.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      deepFreeze(nested);
    }
  }
  return value;
}

function freezeSnapshot<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveSessionStorageDir(sessionFile?: string): string | undefined {
  const trimmed = trimOptional(sessionFile);
  return trimmed ? path.dirname(trimmed) : undefined;
}

function freezeSessionSnapshot(state: EmbeddedRuntimeMutableState): EmbeddedRuntimeSessionSnapshot {
  return freezeSnapshot({
    sessionId: state.session.sessionId,
    sessionKey: state.session.sessionKey,
    parentSessionId: state.session.parentSessionId,
    parentSessionKey: state.session.parentSessionKey,
    currentPromptId: state.session.currentPromptId,
    lastMainRequestId: state.session.lastMainRequestId,
    lastApiCompletionTimestamp: state.session.lastApiCompletionTimestamp,
  });
}

function freezePathsSnapshot(state: EmbeddedRuntimeMutableState): EmbeddedRuntimePathsSnapshot {
  return freezeSnapshot({
    originalWorkspaceRoot: state.paths.originalWorkspaceRoot,
    stableProjectRoot: state.paths.stableProjectRoot,
    activeWorkingDir: state.paths.activeWorkingDir,
    sessionFile: state.paths.sessionFile,
    sessionStorageDir: state.paths.sessionStorageDir,
  });
}

function freezeToolProtocolSnapshot(
  state: EmbeddedRuntimeMutableState,
): EmbeddedRuntimeToolProtocolSnapshot {
  return freezeSnapshot({
    strictToolResultPairing: state.toolProtocol.strictToolResultPairing,
    allowSyntheticToolResults: state.toolProtocol.allowSyntheticToolResults,
  });
}

function freezePromptCacheSnapshot(
  state: EmbeddedRuntimeMutableState,
): EmbeddedRuntimePromptCacheSnapshot {
  return freezeSnapshot({
    lastCacheTouchAt: state.promptCache.lastCacheTouchAt,
  });
}

function trimLog<T>(items: T[], maxEntries: number): void {
  if (items.length <= maxEntries) {
    return;
  }
  items.splice(0, items.length - maxEntries);
}

export function createEmbeddedRuntimeState(init?: EmbeddedRuntimeStateInit): EmbeddedRuntimeState {
  const mutable: EmbeddedRuntimeMutableState = {
    session: {
      sessionId: trimOptional(init?.sessionId) ?? crypto.randomUUID(),
      sessionKey: trimOptional(init?.sessionKey),
      parentSessionId: trimOptional(init?.parentSessionId),
      parentSessionKey: trimOptional(init?.parentSessionKey),
      currentPromptId: undefined,
      lastMainRequestId: undefined,
      lastApiCompletionTimestamp: undefined,
      postCompactionPending: false,
    },
    paths: {
      originalWorkspaceRoot: trimOptional(init?.originalWorkspaceRoot),
      stableProjectRoot:
        trimOptional(init?.stableProjectRoot) ?? trimOptional(init?.originalWorkspaceRoot),
      activeWorkingDir: trimOptional(init?.activeWorkingDir),
      sessionFile: trimOptional(init?.sessionFile),
      sessionStorageDir: resolveSessionStorageDir(init?.sessionFile),
    },
    toolProtocol: {
      strictToolResultPairing: Boolean(init?.strictToolResultPairing),
      allowSyntheticToolResults: init?.allowSyntheticToolResults ?? true,
    },
    promptCache: {
      lastCacheTouchAt: undefined,
    },
    debug: {
      lastRequest: null,
      errorLog: [],
      slowOperations: [],
    },
    extensions: new Map(),
  };

  const api: EmbeddedRuntimeState = {
    switchSession: ({ sessionId, sessionFile }) => {
      const trimmed = trimOptional(sessionId);
      if (!trimmed) {
        throw new Error("Embedded runtime sessionId must be a non-empty string.");
      }
      mutable.session.sessionId = trimmed;
      const nextFile = trimOptional(sessionFile) ?? mutable.paths.sessionFile;
      mutable.paths.sessionFile = nextFile;
      mutable.paths.sessionStorageDir = resolveSessionStorageDir(nextFile);
      return freezeSessionSnapshot(mutable);
    },
    regenerateSessionId: (opts) => {
      if (opts?.setCurrentAsParent) {
        mutable.session.parentSessionId = mutable.session.sessionId;
      }
      return api.switchSession({
        sessionId: crypto.randomUUID(),
        sessionFile: opts?.sessionFile,
      });
    },
    setSessionKey: (sessionKey) => {
      mutable.session.sessionKey = trimOptional(sessionKey);
      return freezeSessionSnapshot(mutable);
    },
    setParentSessionId: (parentSessionId) => {
      mutable.session.parentSessionId = trimOptional(parentSessionId);
      return freezeSessionSnapshot(mutable);
    },
    setParentSessionKey: (parentSessionKey) => {
      mutable.session.parentSessionKey = trimOptional(parentSessionKey);
      return freezeSessionSnapshot(mutable);
    },
    setOriginalWorkspaceRoot: (originalWorkspaceRoot) => {
      mutable.paths.originalWorkspaceRoot = trimOptional(originalWorkspaceRoot);
      return freezePathsSnapshot(mutable);
    },
    setStableProjectRoot: (stableProjectRoot) => {
      mutable.paths.stableProjectRoot = trimOptional(stableProjectRoot);
      return freezePathsSnapshot(mutable);
    },
    setActiveWorkingDir: (activeWorkingDir) => {
      mutable.paths.activeWorkingDir = trimOptional(activeWorkingDir);
      return freezePathsSnapshot(mutable);
    },
    setToolProtocol: (patch) => {
      if (typeof patch.strictToolResultPairing === "boolean") {
        mutable.toolProtocol.strictToolResultPairing = patch.strictToolResultPairing;
      }
      if (typeof patch.allowSyntheticToolResults === "boolean") {
        mutable.toolProtocol.allowSyntheticToolResults = patch.allowSyntheticToolResults;
      }
      return freezeToolProtocolSnapshot(mutable);
    },
    setPromptCacheLastTouchAt: (lastCacheTouchAt) => {
      mutable.promptCache.lastCacheTouchAt = lastCacheTouchAt ?? undefined;
      return freezePromptCacheSnapshot(mutable);
    },
    markApiCompletion: (timestamp = Date.now()) => {
      mutable.session.lastApiCompletionTimestamp = timestamp;
      return freezeSessionSnapshot(mutable);
    },
    markPostCompaction: () => {
      mutable.session.postCompactionPending = true;
    },
    consumePostCompaction: () => {
      const pending = mutable.session.postCompactionPending;
      mutable.session.postCompactionPending = false;
      return pending;
    },
    recordFinalRequest: (params) => {
      const promptId = trimOptional(params.promptId) ?? crypto.randomUUID();
      const snapshot = freezeSnapshot({
        promptId,
        requestId: trimOptional(params.requestId),
        recordedAt: params.recordedAt ?? Date.now(),
        sessionId: mutable.session.sessionId,
        sessionKey: mutable.session.sessionKey,
        parentSessionId: mutable.session.parentSessionId,
        parentSessionKey: mutable.session.parentSessionKey,
        provider: trimOptional(params.provider),
        modelId: trimOptional(params.modelId),
        modelApi: trimOptional(params.modelApi ?? undefined) ?? null,
        wasPostCompaction: params.wasPostCompaction ?? false,
        model: isRecord(params.model) ? cloneValue(params.model) : undefined,
        options: isRecord(params.options) ? cloneValue(params.options) : undefined,
        system: cloneValue(params.system),
        messages: cloneValue(params.messages),
      }) as EmbeddedRuntimeRequestSnapshot;
      mutable.session.currentPromptId = promptId;
      mutable.session.lastMainRequestId =
        trimOptional(params.requestId) ?? mutable.session.lastMainRequestId;
      mutable.debug.lastRequest = snapshot;
      return snapshot;
    },
    recordError: (entry) => {
      const next = freezeSnapshot({
        ts: entry.ts ?? Date.now(),
        phase: trimOptional(entry.phase) ?? "unknown",
        message: entry.message,
        details: isRecord(entry.details) ? cloneValue(entry.details) : undefined,
      }) as EmbeddedRuntimeErrorEntry;
      mutable.debug.errorLog.push(next);
      trimLog(mutable.debug.errorLog, MAX_ERROR_LOG_ENTRIES);
      return next;
    },
    recordSlowOperation: (entry) => {
      const next = freezeSnapshot({
        ts: entry.ts ?? Date.now(),
        label: trimOptional(entry.label) ?? "operation",
        durationMs: Math.max(0, Math.floor(entry.durationMs)),
        details: isRecord(entry.details) ? cloneValue(entry.details) : undefined,
      }) as EmbeddedRuntimeSlowOperationEntry;
      mutable.debug.slowOperations.push(next);
      trimLog(mutable.debug.slowOperations, MAX_SLOW_OPERATION_ENTRIES);
      return next;
    },
    setExtensionRuntime: (key, value) => {
      const normalizedKey = trimOptional(key);
      if (!normalizedKey) {
        return;
      }
      if (value === null) {
        mutable.extensions.delete(normalizedKey);
        return;
      }
      mutable.extensions.set(normalizedKey, value);
    },
    getExtensionRuntime: <T = unknown>(key: string) => {
      const normalizedKey = trimOptional(key);
      if (!normalizedKey) {
        return null;
      }
      return (mutable.extensions.get(normalizedKey) as T | undefined) ?? null;
    },
    getSessionSnapshot: () => freezeSessionSnapshot(mutable),
    getPathsSnapshot: () => freezePathsSnapshot(mutable),
    getToolProtocolSnapshot: () => freezeToolProtocolSnapshot(mutable),
    getPromptCacheSnapshot: () => freezePromptCacheSnapshot(mutable),
    getLastRequestSnapshot: () =>
      mutable.debug.lastRequest ? freezeSnapshot(mutable.debug.lastRequest) : null,
    getDebugSnapshot: () =>
      freezeSnapshot({
        lastRequest: mutable.debug.lastRequest,
        errorLog: mutable.debug.errorLog,
        slowOperations: mutable.debug.slowOperations,
      }) as EmbeddedRuntimeDebugSnapshot,
  };

  return api;
}

export function getEmbeddedRuntimeState(target: unknown): EmbeddedRuntimeState | null {
  if (!target || typeof target !== "object") {
    return null;
  }
  return REGISTRY.get(target) ?? null;
}

export function ensureEmbeddedRuntimeState(
  target: unknown,
  init?: EmbeddedRuntimeStateInit,
): EmbeddedRuntimeState | null {
  if (!target || typeof target !== "object") {
    return null;
  }
  const existing = REGISTRY.get(target);
  if (existing) {
    if (init) {
      const currentSession = existing.getSessionSnapshot();
      const currentPaths = existing.getPathsSnapshot();
      existing.switchSession({
        sessionId: trimOptional(init.sessionId) ?? currentSession.sessionId,
        sessionFile: trimOptional(init.sessionFile) ?? currentPaths.sessionFile,
      });
      if (init.sessionKey !== undefined) {
        existing.setSessionKey(trimOptional(init.sessionKey));
      }
      if (init.parentSessionId !== undefined) {
        existing.setParentSessionId(trimOptional(init.parentSessionId));
      }
      if (init.parentSessionKey !== undefined) {
        existing.setParentSessionKey(trimOptional(init.parentSessionKey));
      }
      if (init.originalWorkspaceRoot !== undefined) {
        existing.setOriginalWorkspaceRoot(trimOptional(init.originalWorkspaceRoot));
      }
      if (init.stableProjectRoot !== undefined || init.originalWorkspaceRoot !== undefined) {
        existing.setStableProjectRoot(
          trimOptional(init.stableProjectRoot) ??
            trimOptional(init.originalWorkspaceRoot) ??
            currentPaths.stableProjectRoot,
        );
      }
      if (init.activeWorkingDir !== undefined) {
        existing.setActiveWorkingDir(trimOptional(init.activeWorkingDir));
      }
      existing.setToolProtocol({
        strictToolResultPairing: init.strictToolResultPairing,
        allowSyntheticToolResults: init.allowSyntheticToolResults,
      });
    }
    return existing;
  }
  const state = createEmbeddedRuntimeState(init);
  REGISTRY.set(target, state);
  return state;
}

export function wrapStreamFnWithRuntimeState(params: {
  streamFn: StreamFn;
  runtimeState: EmbeddedRuntimeState;
  requestId?: string;
}): StreamFn {
  return (model, context, options) => {
    const wasPostCompaction = params.runtimeState.consumePostCompaction();
    params.runtimeState.recordFinalRequest({
      requestId: params.requestId,
      provider: model?.provider,
      modelId: model?.id,
      modelApi: model?.api ?? null,
      model: {
        id: model?.id,
        provider: model?.provider,
        api: model?.api,
      },
      options: isRecord(options) ? (options as Record<string, unknown>) : undefined,
      system: (context as { system?: unknown }).system,
      messages: ((context as { messages?: AgentMessage[] }).messages ?? []).slice(),
      wasPostCompaction,
    });
    return params.streamFn(model, context, options);
  };
}
