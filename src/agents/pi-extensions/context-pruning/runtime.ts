import type { EffectiveContextPruningSettings } from "./settings.js";
import {
  ensureEmbeddedRuntimeState,
  getEmbeddedRuntimeState,
} from "../../pi-embedded-runner/runtime-state.js";

export type ContextPruningRuntimeValue = {
  settings: EffectiveContextPruningSettings;
  contextWindowTokens?: number | null;
  isToolPrunable: (toolName: string) => boolean;
  lastCacheTouchAt?: number | null;
};

export function setContextPruningRuntime(
  sessionManager: unknown,
  value: ContextPruningRuntimeValue | null,
): void {
  const runtimeState = ensureEmbeddedRuntimeState(sessionManager);
  if (!runtimeState) {
    return;
  }
  if (value === null) {
    runtimeState.setExtensionRuntime("contextPruning", null);
    runtimeState.setPromptCacheLastTouchAt(undefined);
    return;
  }
  runtimeState.setExtensionRuntime("contextPruning", value);
  runtimeState.setPromptCacheLastTouchAt(value.lastCacheTouchAt ?? undefined);
}

export function getContextPruningRuntime(
  sessionManager: unknown,
): ContextPruningRuntimeValue | null {
  return (
    getEmbeddedRuntimeState(sessionManager)?.getExtensionRuntime<ContextPruningRuntimeValue>(
      "contextPruning",
    ) ?? null
  );
}
