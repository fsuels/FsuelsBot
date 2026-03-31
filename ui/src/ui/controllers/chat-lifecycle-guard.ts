export type ChatLifecyclePhase = "idle" | "reserved" | "active";

export type ChatLifecycleSnapshot = {
  phase: ChatLifecyclePhase;
  runId: string | null;
  generation: number | null;
  reserved: boolean;
  active: boolean;
  busy: boolean;
};

export type ChatLifecycleListener = (snapshot: ChatLifecycleSnapshot) => void;

export function createChatLifecycleGuard() {
  let reserved = false;
  let activeRunId: string | null = null;
  let activeGeneration: number | null = null;
  let nextGeneration = 0;
  const listeners = new Set<ChatLifecycleListener>();

  const getSnapshot = (): ChatLifecycleSnapshot => ({
    phase: activeRunId ? "active" : reserved ? "reserved" : "idle",
    runId: activeRunId,
    generation: activeGeneration,
    reserved,
    active: activeRunId !== null,
    busy: reserved || activeRunId !== null,
  });

  const notify = () => {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  return {
    reserve() {
      if (reserved || activeRunId) {
        return false;
      }
      reserved = true;
      notify();
      return true;
    },

    tryStart(runId: string) {
      const nextRunId = runId.trim();
      if (!reserved || activeRunId || !nextRunId) {
        return null;
      }
      reserved = false;
      activeRunId = nextRunId;
      activeGeneration = ++nextGeneration;
      notify();
      return activeGeneration;
    },

    cancelReservation() {
      if (!reserved) {
        return false;
      }
      reserved = false;
      notify();
      return true;
    },

    end(generation: number) {
      if (activeRunId === null || activeGeneration !== generation) {
        return false;
      }
      activeRunId = null;
      activeGeneration = null;
      notify();
      return true;
    },

    forceEnd() {
      if (!reserved && activeRunId === null) {
        return false;
      }
      reserved = false;
      activeRunId = null;
      activeGeneration = null;
      notify();
      return true;
    },

    subscribe(listener: ChatLifecycleListener) {
      listeners.add(listener);
      listener(getSnapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot,
  };
}

export type ChatLifecycleGuard = ReturnType<typeof createChatLifecycleGuard>;
