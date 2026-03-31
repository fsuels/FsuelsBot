import JSON5 from "json5";
import fs from "node:fs/promises";
import type { OpenClawConfig } from "../../config/config.js";
import type { ParsedSkillFrontmatter, SkillEntry } from "./types.js";
import { LEGACY_MANIFEST_KEYS, MANIFEST_KEY } from "../../compat/legacy-names.js";
import { loadWorkspaceSkillEntries } from "./workspace.js";

const SAFE_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "homepage",
  "author",
  "version",
  "alias",
  "aliases",
  "argument-hint",
  "argument_hint",
  "arguments",
  "allowed-tools",
  "allowed_tools",
  "path",
  "paths",
  "path-filters",
  "path_filters",
  "triggers",
  "metadata",
  "user-invocable",
  "disable-model-invocation",
  "when-to-use",
  "when_to_use",
]);

const SAFE_MANIFEST_PROPERTIES = new Set([
  "always",
  "emoji",
  "homepage",
  "install",
  "os",
  "primaryEnv",
  "requires",
  "skillKey",
]);

export type SkillInvocationLifecycle = "mentioned" | "loaded" | "running" | "completed" | "error";

export type SkillInvocationRecord = {
  id: string;
  skillName: string;
  commandName?: string;
  filePath: string;
  lifecycle: SkillInvocationLifecycle;
  source: "explicit-slash";
  loadedPrompt?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};

export type SkillRuntimeState = {
  invocations: Map<string, SkillInvocationRecord>;
};

export type SkillPermissionDecision = {
  behavior: "allow" | "ask" | "deny";
  reason?: string;
  matchedRule?: string;
  suggestedAllowRules?: string[];
};

export type SkillRouteResult =
  | {
      ok: true;
      record: SkillInvocationRecord;
      reused: boolean;
      permission: SkillPermissionDecision;
    }
  | {
      ok: false;
      code:
        | "unknown_skill"
        | "not_user_invocable"
        | "permission_denied"
        | "permission_required"
        | "already_running";
      message: string;
      suggestedAllowRules?: string[];
    };

function nowId() {
  return `skill_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeRequestedSkillName(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

function normalizeSkillPattern(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSkillLookup(value: string): string {
  return normalizeRequestedSkillName(value)
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function matchesSkillLookup(candidate: string | undefined, requestedName: string): boolean {
  if (!candidate) {
    return false;
  }
  return normalizeSkillLookup(candidate) === normalizeSkillLookup(requestedName);
}

function matchesSkillEntry(entry: SkillEntry, requestedName: string): boolean {
  if (entry.skill.name === requestedName || matchesSkillLookup(entry.skill.name, requestedName)) {
    return true;
  }
  return (entry.definition?.aliases ?? []).some((alias) =>
    matchesSkillLookup(alias, requestedName),
  );
}

function matchesSkillPattern(skillName: string, pattern: string): boolean {
  const normalizedSkillName = normalizeSkillPattern(skillName);
  const normalizedPattern = normalizeSkillPattern(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern === "*") {
    return true;
  }
  if (normalizedPattern.endsWith("*")) {
    return normalizedSkillName.startsWith(normalizedPattern.slice(0, -1));
  }
  return normalizedSkillName === normalizedPattern;
}

function findMatchingRule(skillName: string, rules?: string[]): string | undefined {
  if (!Array.isArray(rules)) {
    return undefined;
  }
  return rules.find((rule) => matchesSkillPattern(skillName, rule));
}

function parseRawSkillManifest(
  frontmatter: ParsedSkillFrontmatter,
): Record<string, unknown> | null {
  const raw = frontmatter.metadata;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON5.parse(raw) as Record<string, unknown>;
    for (const key of [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS]) {
      const candidate = parsed?.[key];
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function hasUnsafeFrontmatter(entry: SkillEntry): boolean {
  for (const [key, value] of Object.entries(entry.frontmatter)) {
    if (SAFE_FRONTMATTER_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return true;
  }
  return false;
}

function hasUnsafeManifestProperties(entry: SkillEntry): boolean {
  const manifest = parseRawSkillManifest(entry.frontmatter);
  if (!manifest) {
    return false;
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (SAFE_MANIFEST_PROPERTIES.has(key)) {
      continue;
    }
    if (value == null) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    return true;
  }
  return false;
}

export function createSkillRuntimeState(): SkillRuntimeState {
  return { invocations: new Map() };
}

export function getOrCreateSkillRuntimeState(existing: unknown): SkillRuntimeState {
  if (
    existing &&
    typeof existing === "object" &&
    "invocations" in existing &&
    (existing as { invocations?: unknown }).invocations instanceof Map
  ) {
    return existing as SkillRuntimeState;
  }
  return createSkillRuntimeState();
}

export function buildLoadedSkillSystemPrompt(params: {
  record: SkillInvocationRecord;
  rawSkill: string;
}): string {
  return [
    "## Loaded Skill (runtime-routed)",
    `<loaded_skill id="${params.record.id}" status="${params.record.lifecycle}" name="${params.record.skillName}" source="${params.record.source}">`,
    `location: ${params.record.filePath}`,
    "</loaded_skill>",
    "The runtime already loaded this skill. Treat the following SKILL.md as active instructions for the current request.",
    "",
    params.rawSkill,
  ].join("\n");
}

export function evaluateSkillPermission(params: {
  entry: SkillEntry;
  config?: OpenClawConfig;
}): SkillPermissionDecision {
  const skillName = params.entry.skill.name;
  const invokeConfig = params.config?.skills?.invoke;
  const denyRule = findMatchingRule(skillName, invokeConfig?.deny);
  if (denyRule) {
    return {
      behavior: "deny",
      reason: `Skill "${skillName}" is blocked by skills.invoke.deny (${denyRule}).`,
      matchedRule: denyRule,
    };
  }

  if (params.entry.skill.source === "openclaw-bundled") {
    return {
      behavior: "allow",
      matchedRule: "bundled",
    };
  }

  const trustedRule = findMatchingRule(skillName, invokeConfig?.trusted);
  if (trustedRule) {
    return {
      behavior: "allow",
      matchedRule: trustedRule,
    };
  }

  const allowRule = findMatchingRule(skillName, invokeConfig?.allow);
  if (allowRule) {
    return {
      behavior: "allow",
      matchedRule: allowRule,
    };
  }

  const safe = !hasUnsafeFrontmatter(params.entry) && !hasUnsafeManifestProperties(params.entry);
  if (safe) {
    return {
      behavior: "allow",
      matchedRule: "safe_properties",
    };
  }

  return {
    behavior: "ask",
    reason: `Skill "${skillName}" has non-default manifest/frontmatter fields and requires approval before explicit invocation.`,
    suggestedAllowRules: [skillName],
  };
}

export async function routeExplicitSkillInvocation(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  state: SkillRuntimeState;
  skillName: string;
  commandName?: string;
}): Promise<SkillRouteResult> {
  const requestedName = normalizeRequestedSkillName(params.skillName);
  if (!requestedName) {
    return {
      ok: false,
      code: "unknown_skill",
      message: "Skill name is required.",
    };
  }

  const directExisting = params.state.invocations.get(requestedName);
  const existing =
    directExisting ??
    [...params.state.invocations.values()].find(
      (candidate) =>
        normalizeSkillLookup(candidate.skillName) === normalizeSkillLookup(requestedName),
    );
  if (existing?.lifecycle === "running") {
    return {
      ok: false,
      code: "already_running",
      message: `Skill "${existing.skillName}" is already running in this turn.`,
    };
  }
  if (
    (existing?.lifecycle === "loaded" || existing?.lifecycle === "completed") &&
    existing.loadedPrompt
  ) {
    return {
      ok: true,
      record: existing,
      reused: true,
      permission: { behavior: "allow", matchedRule: "already_loaded" },
    };
  }

  const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
    config: params.config,
  });
  const entry = entries.find((candidate) => {
    return matchesSkillEntry(candidate, requestedName);
  });
  if (!entry) {
    return {
      ok: false,
      code: "unknown_skill",
      message: `Unknown skill: ${requestedName}`,
    };
  }
  const canonicalName = entry.skill.name;
  const canonicalExisting =
    existing ??
    params.state.invocations.get(canonicalName) ??
    [...params.state.invocations.values()].find((candidate) =>
      matchesSkillLookup(candidate.skillName, canonicalName),
    );
  if (canonicalExisting?.lifecycle === "running") {
    return {
      ok: false,
      code: "already_running",
      message: `Skill "${canonicalExisting.skillName}" is already running in this turn.`,
    };
  }
  if (
    (canonicalExisting?.lifecycle === "loaded" || canonicalExisting?.lifecycle === "completed") &&
    canonicalExisting.loadedPrompt
  ) {
    return {
      ok: true,
      record: canonicalExisting,
      reused: true,
      permission: { behavior: "allow", matchedRule: "already_loaded" },
    };
  }
  if (entry.invocation?.userInvocable === false) {
    return {
      ok: false,
      code: "not_user_invocable",
      message: `Skill "${canonicalName}" is not user-invocable.`,
    };
  }

  const permission = evaluateSkillPermission({ entry, config: params.config });
  if (permission.behavior === "deny") {
    return {
      ok: false,
      code: "permission_denied",
      message: permission.reason ?? `Skill "${canonicalName}" is not allowed.`,
    };
  }
  if (permission.behavior === "ask") {
    const suggestion = permission.suggestedAllowRules?.length
      ? ` Suggested allow rule: skills.invoke.allow = ${JSON.stringify(permission.suggestedAllowRules)}`
      : "";
    return {
      ok: false,
      code: "permission_required",
      message: `${permission.reason ?? `Skill "${canonicalName}" requires approval.`}${suggestion}`,
      suggestedAllowRules: permission.suggestedAllowRules,
    };
  }

  const rawSkill = await fs.readFile(entry.skill.filePath, "utf-8");
  const recordId = canonicalExisting?.id ?? nowId();
  const record: SkillInvocationRecord = {
    id: recordId,
    skillName: canonicalName,
    commandName: params.commandName,
    filePath: entry.skill.filePath,
    lifecycle: "loaded",
    source: "explicit-slash",
    loadedPrompt: buildLoadedSkillSystemPrompt({
      record: {
        id: recordId,
        skillName: canonicalName,
        commandName: params.commandName,
        filePath: entry.skill.filePath,
        lifecycle: "loaded",
        source: "explicit-slash",
      },
      rawSkill,
    }),
  };
  params.state.invocations.set(canonicalName, record);
  return { ok: true, record, reused: false, permission };
}

export function markSkillInvocationLifecycle(params: {
  state: SkillRuntimeState | undefined;
  skillName: string;
  lifecycle: SkillInvocationLifecycle;
  error?: string;
}): SkillInvocationRecord | undefined {
  const record = params.state?.invocations.get(params.skillName);
  if (!record) {
    return undefined;
  }
  record.lifecycle = params.lifecycle;
  if (params.lifecycle === "running") {
    record.startedAt = Date.now();
  }
  if (params.lifecycle === "completed" || params.lifecycle === "error") {
    record.completedAt = Date.now();
  }
  if (params.error) {
    record.error = params.error;
  } else if (params.lifecycle !== "error") {
    record.error = undefined;
  }
  return record;
}
