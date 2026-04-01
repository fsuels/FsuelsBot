import { createDurableMemoryMaintenanceJob } from "./durable-memory-maintenance.js";
import {
  createPostTurnMaintenanceManager,
  type PostTurnMaintenanceManager,
} from "./post-turn-maintenance.js";

export const getGlobalPostTurnMaintenanceManager = (() => {
  let manager: PostTurnMaintenanceManager | undefined;
  return () => {
    if (!manager) {
      manager = createPostTurnMaintenanceManager([createDurableMemoryMaintenanceJob()]);
    }
    return manager;
  };
})();

export function schedulePostTurnMaintenance(
  context: Parameters<PostTurnMaintenanceManager["schedule"]>[0],
): void {
  getGlobalPostTurnMaintenanceManager().schedule(context);
}

export function drainPendingPostTurnMaintenance(
  timeoutMs: number,
  queueKey?: string,
): Promise<boolean> {
  return getGlobalPostTurnMaintenanceManager().drainPendingMaintenance(timeoutMs, queueKey);
}
