import type { SessionEntry } from "../config/sessions/types.js";
import type { AnyAgentTool } from "./tools/common.js";
import { normalizeToolName } from "./tool-policy.js";

export type CollaborationMode = "default" | "plan";
export type PlanModeProfile = "proactive" | "conservative";

export const DEFAULT_PLAN_MODE_PROFILE: PlanModeProfile = "conservative";

const PLAN_MODE_SAFE_TOOLS = new Set([
  "find",
  "grep",
  "ls",
  "read",
  "sessions_history",
  "sessions_list",
  "task_get",
  "tasks_list",
  "web_fetch",
  "web_search",
]);

export function normalizeCollaborationMode(raw?: string | null): CollaborationMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "default") {
    return "default";
  }
  if (normalized === "plan") {
    return "plan";
  }
  return undefined;
}

export function normalizePlanModeProfile(raw?: string | null): PlanModeProfile | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "proactive") {
    return "proactive";
  }
  if (normalized === "conservative") {
    return "conservative";
  }
  return undefined;
}

export function resolveSessionCollaborationMode(
  entry?: Pick<SessionEntry, "collaborationMode"> | null,
): CollaborationMode {
  return normalizeCollaborationMode(entry?.collaborationMode) ?? "default";
}

export function resolveSessionPlanModeProfile(
  entry?: Pick<SessionEntry, "collaborationMode" | "planProfile"> | null,
): PlanModeProfile | undefined {
  if (resolveSessionCollaborationMode(entry) !== "plan") {
    return undefined;
  }
  return normalizePlanModeProfile(entry?.planProfile) ?? DEFAULT_PLAN_MODE_PROFILE;
}

export function isPlanModeActive(entry?: Pick<SessionEntry, "collaborationMode"> | null): boolean {
  return resolveSessionCollaborationMode(entry) === "plan";
}

export function isToolAllowedInPlanMode(tool: Pick<AnyAgentTool, "name" | "isReadOnly">): boolean {
  const normalized = normalizeToolName(tool.name || "tool");
  if (PLAN_MODE_SAFE_TOOLS.has(normalized)) {
    return true;
  }
  try {
    return tool.isReadOnly?.() === true;
  } catch {
    return false;
  }
}

export function filterToolsForPlanMode<T extends Pick<AnyAgentTool, "name" | "isReadOnly">>(
  tools: T[],
): T[] {
  return tools.filter((tool) => isToolAllowedInPlanMode(tool));
}

export function formatPlanModeStatusLine(
  entry?: Pick<SessionEntry, "collaborationMode" | "planProfile"> | null,
): string {
  if (!isPlanModeActive(entry)) {
    return "🗺️ Mode: execution";
  }
  const profile = resolveSessionPlanModeProfile(entry) ?? DEFAULT_PLAN_MODE_PROFILE;
  return `🗺️ Mode: planning (${profile}, read-only)`;
}
