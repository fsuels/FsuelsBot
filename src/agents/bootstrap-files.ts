import type { OpenClawConfig } from "../config/config.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import { buildBootstrapContextFiles, resolveBootstrapMaxChars } from "./pi-embedded-helpers.js";
import { buildTaskBootstrapContext, resolveActiveTask } from "./task-checkpoint.js";
import {
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );
  return applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  provider?: string;
  warn?: (message: string) => void;
  /**
   * Context pressure (0-1). When provided, bootstrap budget shrinks as sessions
   * grow to leave room for conversation history. (Working Memory P3)
   * - pressure 0.0–0.5: full budget
   * - pressure 0.5–0.8: linearly scale to 50% of budget
   * - pressure 0.8–1.0: linearly scale to 25% of budget
   */
  contextPressure?: number;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  let maxChars = resolveBootstrapMaxChars(params.config, params.provider);

  // Dynamic bootstrap budget: shrink allocation under context pressure (Working Memory P3)
  if (typeof params.contextPressure === "number" && params.contextPressure > 0.5) {
    const pressure = Math.min(1, params.contextPressure);
    let scaleFactor: number;
    if (pressure <= 0.8) {
      // 0.5 → 1.0, 0.8 → 0.5 (linear)
      scaleFactor = 1.0 - ((pressure - 0.5) / 0.3) * 0.5;
    } else {
      // 0.8 → 0.5, 1.0 → 0.25 (linear)
      scaleFactor = 0.5 - ((pressure - 0.8) / 0.2) * 0.25;
    }
    maxChars = Math.max(1000, Math.floor(maxChars * scaleFactor));
  }

  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars,
    warn: params.warn,
  });

  // Auto-inject active task card into bootstrap context
  try {
    const activeTask = await resolveActiveTask(params.workspaceDir);
    if (activeTask) {
      const taskContent = buildTaskBootstrapContext(activeTask);
      contextFiles.push({
        path: "ACTIVE_TASK",
        content: taskContent,
      });
    }
  } catch {
    /* task loading is best-effort — don't break bootstrap */
  }

  return { bootstrapFiles, contextFiles };
}
