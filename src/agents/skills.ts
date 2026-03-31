import type { OpenClawConfig } from "../config/config.js";
import type { SkillsInstallPreferences } from "./skills/types.js";

export {
  hasBinary,
  isBundledSkillAllowed,
  isConfigPathTruthy,
  resolveBundledAllowlist,
  resolveConfigPath,
  resolveRuntimePlatform,
  resolveSkillConfig,
} from "./skills/config.js";
export {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
} from "./skills/env-overrides.js";
export type {
  DiscoverableSkill,
  SkillDefinitionMetadata,
  OpenClawSkillMetadata,
  SkillPromptMetrics,
  SkillEligibilityContext,
  SkillCommandSpec,
  SkillEntry,
  SkillInstallSpec,
  SkillExecutionContextMode,
  SkillSnapshot,
  SkillsPromptTruncationMode,
  SkillsInstallPreferences,
  SkillSourceCategory,
} from "./skills/types.js";
export {
  buildBudgetedSkillsPrompt,
  buildDiscoverableSkills,
  resolveSkillDescriptionMaxChars,
  resolveSkillPathBaseDir,
  resolveSkillPromptBudgetChars,
  resolveSkillSourceCategory,
} from "./skills/registry.js";
export {
  buildLoadedSkillSystemPrompt,
  createSkillRuntimeState,
  evaluateSkillPermission,
  getOrCreateSkillRuntimeState,
  markSkillInvocationLifecycle,
  routeExplicitSkillInvocation,
} from "./skills/router.js";
export type {
  SkillInvocationLifecycle,
  SkillInvocationRecord,
  SkillPermissionDecision,
  SkillRouteResult,
  SkillRuntimeState,
} from "./skills/router.js";
export {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  buildWorkspaceSkillCommandSpecs,
  clearWorkspaceSkillCaches,
  filterWorkspaceSkillEntries,
  loadWorkspaceSkillEntries,
  resolveSkillsPromptForRun,
  syncSkillsToWorkspace,
} from "./skills/workspace.js";

export function resolveSkillsInstallPreferences(config?: OpenClawConfig): SkillsInstallPreferences {
  const raw = config?.skills?.install;
  const preferBrew = raw?.preferBrew ?? true;
  const managerRaw = typeof raw?.nodeManager === "string" ? raw.nodeManager.trim() : "";
  const manager = managerRaw.toLowerCase();
  const nodeManager: SkillsInstallPreferences["nodeManager"] =
    manager === "pnpm" || manager === "yarn" || manager === "bun" || manager === "npm"
      ? manager
      : "npm";
  return { preferBrew, nodeManager };
}
