import {
  ensureEmbeddedRuntimeState,
  getEmbeddedRuntimeState,
} from "../pi-embedded-runner/runtime-state.js";

export type CompactionSafeguardRuntimeValue = {
  maxHistoryShare?: number;
  contextWindowTokens?: number;
};

export function setCompactionSafeguardRuntime(
  sessionManager: unknown,
  value: CompactionSafeguardRuntimeValue | null,
): void {
  const runtimeState = ensureEmbeddedRuntimeState(sessionManager);
  if (!runtimeState) {
    return;
  }
  if (value === null) {
    runtimeState.setExtensionRuntime("compactionSafeguard", null);
    return;
  }
  runtimeState.setExtensionRuntime("compactionSafeguard", value);
}

export function getCompactionSafeguardRuntime(
  sessionManager: unknown,
): CompactionSafeguardRuntimeValue | null {
  return (
    getEmbeddedRuntimeState(sessionManager)?.getExtensionRuntime<CompactionSafeguardRuntimeValue>(
      "compactionSafeguard",
    ) ?? null
  );
}
