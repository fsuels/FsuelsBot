import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  clearObservedBrowserStateForRoute,
  getBrowserSessionRoute,
  type BrowserSessionRoute,
} from "./session-browser-context.js";
import { shouldClearBrowserStateOnTransition, type StepDomain } from "./step-context-manager.js";

const log = createSubsystemLogger("agents/step-browser-cleanup");

const sessionStepState = new Map<
  string,
  {
    lastStepIndex: number;
    lastDomain: StepDomain;
  }
>();

export function recordStepState(
  sessionKey: string,
  stepIndex: number,
  domain: StepDomain,
): void {
  sessionStepState.set(sessionKey, {
    lastStepIndex: stepIndex,
    lastDomain: domain,
  });
}

export function getPreviousStepState(
  sessionKey: string,
): { lastStepIndex: number; lastDomain: StepDomain } | undefined {
  return sessionStepState.get(sessionKey);
}

export function clearStepState(sessionKey: string): void {
  sessionStepState.delete(sessionKey);
}

export type BrowserCleanupDeps = {
  getBrowserSessionRoute: (sessionKey: string) => BrowserSessionRoute | undefined;
  clearObservedBrowserStateForRoute: (route: BrowserSessionRoute) => Promise<void>;
};

export async function maybeCleanupBrowserStateOnStepTransition(params: {
  sessionKey: string;
  currentStepIndex: number;
  currentDomain: StepDomain;
  deps?: Partial<BrowserCleanupDeps>;
}): Promise<boolean> {
  const { sessionKey, currentStepIndex, currentDomain } = params;
  const deps: BrowserCleanupDeps = {
    getBrowserSessionRoute,
    clearObservedBrowserStateForRoute,
    ...params.deps,
  };

  const previous = getPreviousStepState(sessionKey);
  if (!previous) {
    recordStepState(sessionKey, currentStepIndex, currentDomain);
    return false;
  }

  const stepTransitioned = previous.lastStepIndex !== currentStepIndex;
  const shouldClear = shouldClearBrowserStateOnTransition(
    previous.lastDomain,
    currentDomain,
    stepTransitioned,
  );

  recordStepState(sessionKey, currentStepIndex, currentDomain);

  if (!shouldClear) {
    return false;
  }

  const route = deps.getBrowserSessionRoute(sessionKey);
  if (!route) {
    log.info("browser cleanup skipped: no tracked browser route", { sessionKey });
    return false;
  }

  log.info("clearing browser state on step transition", {
    sessionKey,
    fromStep: previous.lastStepIndex,
    toStep: currentStepIndex,
    fromDomain: previous.lastDomain,
    toDomain: currentDomain,
    browserTarget: route.target,
    profile: route.profile,
    targetId: route.targetId,
  });

  try {
    await deps.clearObservedBrowserStateForRoute(route);
    return true;
  } catch (err) {
    log.warn(`browser cleanup failed: ${String(err)}`);
    return false;
  }
}

export function clearAllStepStatesForTests(): void {
  sessionStepState.clear();
}
