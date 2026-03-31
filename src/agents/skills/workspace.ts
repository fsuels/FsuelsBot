import {
  loadSkillsFromDir,
  type LoadSkillsResult,
  type Skill,
} from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type {
  ParsedSkillFrontmatter,
  SkillEligibilityContext,
  SkillCommandSpec,
  SkillEntry,
  SkillSnapshot,
} from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { clearPluginManifestRegistryCache } from "../../plugins/manifest-registry.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { resolveBundledSkillsDir } from "./bundled-dir.js";
import { shouldIncludeSkill } from "./config.js";
import {
  parseFrontmatter,
  resolveSkillDefinitionMetadata,
  resolveOpenClawMetadata,
  resolveSkillInvocationPolicy,
  stripFrontmatter,
} from "./frontmatter.js";
import { resolvePluginSkillDirs } from "./plugin-skills.js";
import { buildBudgetedSkillsPrompt, buildDiscoverableSkills } from "./registry.js";
import { serializeByKey } from "./serialize.js";

const fsp = fs.promises;
const skillsLogger = createSubsystemLogger("skills");
const skillCommandDebugOnce = new Set<string>();
const workspaceSkillEntriesCache = new Map<string, SkillEntry[]>();
const pathScopedSkillDirsCache = new Map<string, string[]>();
const ignoreRuleCache = new Map<string, IgnoreRule[]>();
const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];
const PATH_SCOPED_SKILL_DIR_PATTERNS = ["skills", path.join(".openclaw", "skills")] as const;

type SkillSourceLayer = "extra" | "plugin" | "bundled" | "managed" | "workspace";

type SkillLoaderDiagnostic = {
  type?: string;
  message?: string;
  path?: string;
  collision?: {
    resourceType?: string;
    name?: string;
    winnerPath?: string;
    loserPath?: string;
  };
};

type LoadedSkillSource = {
  sourceLayer: SkillSourceLayer;
  sourceLabel: string;
  skills: Skill[];
  diagnostics: SkillLoaderDiagnostic[];
  recoveredDiagnosticPaths: Set<string>;
};

type IgnoreRule = {
  pattern: string;
  prefix: string;
  anchored: boolean;
  dirOnly: boolean;
  negated: boolean;
};

function normalizeSkillLoaderResult(loaded: Skill[] | LoadSkillsResult | null | undefined): {
  skills: Skill[];
  diagnostics: SkillLoaderDiagnostic[];
} {
  if (Array.isArray(loaded)) {
    return { skills: loaded, diagnostics: [] };
  }
  if (
    loaded &&
    typeof loaded === "object" &&
    "skills" in loaded &&
    Array.isArray((loaded as { skills?: unknown }).skills)
  ) {
    return {
      skills: (loaded as { skills: Skill[] }).skills,
      diagnostics: Array.isArray((loaded as { diagnostics?: unknown }).diagnostics)
        ? ((loaded as { diagnostics: SkillLoaderDiagnostic[] }).diagnostics ?? [])
        : [],
    };
  }
  return { skills: [], diagnostics: [] };
}

function extractFallbackDescription(content: string): string | undefined {
  const body = stripFrontmatter(content);
  const blocks = body.split(/\n\s*\n+/);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (line) =>
          !/^#{1,6}\s/.test(line) &&
          !/^(```|~~~)/.test(line) &&
          !/^([-*+]|\d+\.)\s/.test(line) &&
          !/^>/.test(line),
      );
    const candidate = lines.join(" ").trim();
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function resolveFallbackSkill(params: { filePath: string; source: string }): Skill | null {
  try {
    const raw = fs.readFileSync(params.filePath, "utf-8");
    const frontmatter = parseFrontmatter(raw);
    const fallbackName = path.basename(path.dirname(params.filePath));
    const name = frontmatter.name?.trim() || fallbackName;
    const description =
      frontmatter.description?.trim() || extractFallbackDescription(raw) || `Custom ${name} skill`;
    const invocation = resolveSkillInvocationPolicy(frontmatter);
    return {
      name,
      description,
      filePath: params.filePath,
      baseDir: path.dirname(params.filePath),
      source: params.source,
      disableModelInvocation: invocation.disableModelInvocation,
    };
  } catch (error) {
    skillsLogger.warn("failed to recover skill with fallback description", {
      path: params.filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function recoverFallbackSkills(params: {
  diagnostics: SkillLoaderDiagnostic[];
  loadedSkills: Skill[];
  source: string;
  sourceLabel: string;
}): { skills: Skill[]; recoveredDiagnosticPaths: Set<string> } {
  const loadedPaths = new Set(params.loadedSkills.map((skill) => skill.filePath));
  const recovered: Skill[] = [];
  const recoveredPaths = new Set<string>();
  for (const diagnostic of params.diagnostics) {
    const filePath = diagnostic.path?.trim();
    if (!filePath || loadedPaths.has(filePath) || recoveredPaths.has(filePath)) {
      continue;
    }
    if (!/description is required/i.test(diagnostic.message ?? "")) {
      continue;
    }
    const skill = resolveFallbackSkill({
      filePath,
      source: params.source,
    });
    if (!skill) {
      continue;
    }
    recovered.push(skill);
    recoveredPaths.add(filePath);
    skillsLogger.warn("skill missing description; recovered fallback description from file body", {
      source: params.sourceLabel,
      path: filePath,
      skillName: skill.name,
    });
  }
  return { skills: recovered, recoveredDiagnosticPaths: recoveredPaths };
}

function logSkillLoaderDiagnostics(
  sourceLabel: string,
  diagnostics: SkillLoaderDiagnostic[],
  recoveredDiagnosticPaths?: Set<string>,
): void {
  for (const diagnostic of diagnostics) {
    const diagnosticPath = diagnostic.path?.trim();
    if (diagnosticPath && recoveredDiagnosticPaths?.has(diagnosticPath)) {
      continue;
    }
    const diagnosticMessage = diagnostic.message ?? "unknown";
    const parentDir = diagnosticPath ? path.basename(path.dirname(diagnosticPath)) : "";
    if (
      sourceLabel === "managed" &&
      /does not match parent directory/i.test(diagnosticMessage) &&
      parentDir.startsWith("generated-")
    ) {
      continue;
    }
    const collision = diagnostic.collision;
    if (collision?.resourceType === "skill" || diagnostic.type === "collision") {
      skillsLogger.warn("duplicate skill name detected within source; keeping existing winner", {
        source: sourceLabel,
        skillName: collision?.name,
        winnerPath: collision?.winnerPath,
        loserPath: collision?.loserPath,
      });
      continue;
    }
    skillsLogger.warn(`skill loader warning (${sourceLabel}): ${diagnosticMessage}`, {
      path: diagnostic.path,
      diagnosticType: diagnostic.type ?? "warning",
    });
  }
}

function toSkillEntry(skill: Skill): SkillEntry {
  const canonicalFilePath = resolveCanonicalSkillFilePath(skill.filePath);
  let frontmatter: ParsedSkillFrontmatter = {};
  try {
    const raw = fs.readFileSync(skill.filePath, "utf-8");
    frontmatter = parseFrontmatter(raw);
  } catch (error) {
    skillsLogger.warn("failed to read skill frontmatter; using empty metadata", {
      path: skill.filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    skill,
    frontmatter,
    metadata: resolveOpenClawMetadata(frontmatter),
    invocation: resolveSkillInvocationPolicy(frontmatter),
    definition: resolveSkillDefinitionMetadata(frontmatter),
    canonicalFilePath,
  };
}

function resolveCanonicalSkillFilePath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    try {
      return fs.realpathSync(filePath);
    } catch {
      return resolveUserPath(filePath);
    }
  }
}

function normalizePosixPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/$/, "");
}

function isPathWithin(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCanonicalPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    try {
      return fs.realpathSync(filePath);
    } catch {
      return resolveUserPath(filePath);
    }
  }
}

function resolveActivationSearchStart(workspaceDir: string, activationPath: string): string | null {
  const trimmed = activationPath.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceDir, trimmed);
  if (!isPathWithin(workspaceDir, absolute)) {
    return null;
  }
  try {
    const stat = fs.statSync(absolute);
    return stat.isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return path.dirname(absolute);
  }
}

function readIgnoreRulesForDir(dir: string, workspaceDir: string): IgnoreRule[] {
  const cacheKey = `${workspaceDir}::${dir}`;
  const cached = ignoreRuleCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const relativeDir = path.relative(workspaceDir, dir);
  const prefix = relativeDir ? `${normalizePosixPath(relativeDir)}/` : "";
  const rules: IgnoreRule[] = [];
  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = path.join(dir, filename);
    if (!fs.existsSync(ignorePath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(ignorePath, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) {
          continue;
        }
        let pattern = trimmed;
        let negated = false;
        if (pattern.startsWith("!")) {
          negated = true;
          pattern = pattern.slice(1);
        } else if (pattern.startsWith("\\!")) {
          pattern = pattern.slice(1);
        }
        if (pattern.startsWith("\\#")) {
          pattern = pattern.slice(1);
        }
        const dirOnly = pattern.endsWith("/");
        pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
        pattern = normalizePosixPath(pattern);
        if (!pattern) {
          continue;
        }
        rules.push({
          pattern,
          prefix,
          anchored: trimmed.replace(/^!/, "").startsWith("/"),
          dirOnly,
          negated,
        });
      }
    } catch {
      // Ignore malformed or unreadable ignore files and keep scanning.
    }
  }
  ignoreRuleCache.set(cacheKey, rules);
  return rules;
}

function buildIgnoreGlobCandidates(rule: IgnoreRule): string[] {
  const prefix = rule.prefix;
  const base = prefix ? `${prefix}${rule.pattern}` : rule.pattern;
  const hasSlash = rule.pattern.includes("/");
  const candidates = new Set<string>();

  if (rule.anchored) {
    candidates.add(base);
  } else if (!hasSlash) {
    candidates.add(base);
    candidates.add(prefix ? `${prefix}**/${rule.pattern}` : `**/${rule.pattern}`);
  } else {
    candidates.add(base);
    candidates.add(prefix ? `${prefix}**/${rule.pattern}` : `**/${rule.pattern}`);
  }

  if (rule.dirOnly) {
    for (const candidate of [...candidates]) {
      candidates.add(`${candidate}/**`);
    }
  }

  return [...candidates];
}

function isPathIgnoredByRules(relativePath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  const normalizedRelativePath = normalizePosixPath(relativePath);
  for (const rule of rules) {
    const matched = buildIgnoreGlobCandidates(rule).some((candidate) =>
      path.posix.matchesGlob(normalizedRelativePath, candidate),
    );
    if (matched) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function isIgnoredPathScopedDir(candidateDir: string, workspaceDir: string): boolean {
  if (!isPathWithin(workspaceDir, candidateDir)) {
    return true;
  }
  const relativePath = path.relative(workspaceDir, candidateDir);
  if (!relativePath) {
    return false;
  }
  const normalizedRelativePath = normalizePosixPath(relativePath);
  const ruleSets: IgnoreRule[] = [];
  const ancestorDirs: string[] = [];
  let currentDir = path.dirname(candidateDir);
  while (isPathWithin(workspaceDir, currentDir)) {
    ancestorDirs.push(currentDir);
    if (currentDir === workspaceDir) {
      break;
    }
    const next = path.dirname(currentDir);
    if (next === currentDir) {
      break;
    }
    currentDir = next;
  }

  for (const currentDir of ancestorDirs.toReversed()) {
    ruleSets.push(...readIgnoreRulesForDir(currentDir, workspaceDir));
  }
  return isPathIgnoredByRules(normalizedRelativePath, ruleSets);
}

function resolvePathScopedSkillDirs(params: {
  workspaceDir: string;
  activationPaths?: string[];
  excludedDirs?: string[];
}): string[] {
  const activationPaths = (params.activationPaths ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (activationPaths.length === 0) {
    return [];
  }
  const cacheKey = JSON.stringify({
    workspaceDir: params.workspaceDir,
    activationPaths,
    excludedDirs: params.excludedDirs ?? [],
  });
  const cached = pathScopedSkillDirsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const excluded = new Set(
    (params.excludedDirs ?? []).map((dir) => resolveCanonicalPath(resolveUserPath(dir))),
  );
  const discovered = new Map<string, { dir: string; depth: number }>();

  for (const activationPath of activationPaths) {
    let currentDir = resolveActivationSearchStart(params.workspaceDir, activationPath);
    while (currentDir && isPathWithin(params.workspaceDir, currentDir)) {
      for (const relativePattern of PATH_SCOPED_SKILL_DIR_PATTERNS) {
        const candidateDir = path.join(currentDir, relativePattern);
        if (!fs.existsSync(candidateDir)) {
          continue;
        }
        let stats: fs.Stats;
        try {
          stats = fs.statSync(candidateDir);
        } catch {
          continue;
        }
        if (!stats.isDirectory()) {
          continue;
        }
        if (isIgnoredPathScopedDir(candidateDir, params.workspaceDir)) {
          continue;
        }
        const canonicalDir = resolveCanonicalPath(candidateDir);
        if (excluded.has(canonicalDir)) {
          continue;
        }
        const relative = path.relative(params.workspaceDir, candidateDir);
        const depth = normalizePosixPath(relative).split("/").filter(Boolean).length;
        const existing = discovered.get(canonicalDir);
        if (!existing || depth > existing.depth) {
          discovered.set(canonicalDir, { dir: candidateDir, depth });
        }
      }
      if (currentDir === params.workspaceDir) {
        break;
      }
      const nextDir = path.dirname(currentDir);
      if (nextDir === currentDir) {
        break;
      }
      currentDir = nextDir;
    }
  }

  const resolved = [...discovered.values()]
    .toSorted((left, right) => {
      const depthDelta = left.depth - right.depth;
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return left.dir.localeCompare(right.dir);
    })
    .map((entry) => entry.dir);

  pathScopedSkillDirsCache.set(cacheKey, resolved);
  return resolved;
}

function loadSkillSource(params: {
  dir: string;
  source: string;
  sourceLayer: SkillSourceLayer;
  sourceLabel: string;
}): LoadedSkillSource {
  try {
    const normalized = normalizeSkillLoaderResult(
      loadSkillsFromDir({
        dir: params.dir,
        source: params.source,
      }),
    );
    const recovered = recoverFallbackSkills({
      diagnostics: normalized.diagnostics,
      loadedSkills: normalized.skills,
      source: params.source,
      sourceLabel: params.sourceLabel,
    });
    return {
      sourceLayer: params.sourceLayer,
      sourceLabel: params.sourceLabel,
      skills: [...normalized.skills, ...recovered.skills],
      diagnostics: normalized.diagnostics,
      recoveredDiagnosticPaths: recovered.recoveredDiagnosticPaths,
    };
  } catch (error) {
    skillsLogger.warn(`failed to load skills from ${params.sourceLabel}`, {
      dir: params.dir,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      sourceLayer: params.sourceLayer,
      sourceLabel: params.sourceLabel,
      skills: [],
      diagnostics: [],
      recoveredDiagnosticPaths: new Set<string>(),
    };
  }
}

function buildWorkspaceSkillEntriesCacheKey(params: {
  workspaceDir: string;
  managedSkillsDir: string;
  bundledSkillsDir: string;
  extraDirs: string[];
  pluginSkillDirs: string[];
  pathScopedDirs: string[];
}): string {
  return JSON.stringify({
    workspaceDir: params.workspaceDir,
    managedSkillsDir: params.managedSkillsDir,
    bundledSkillsDir: params.bundledSkillsDir,
    extraDirs: params.extraDirs,
    pluginSkillDirs: params.pluginSkillDirs,
    pathScopedDirs: params.pathScopedDirs,
  });
}

export function clearWorkspaceSkillCaches(): void {
  workspaceSkillEntriesCache.clear();
  pathScopedSkillDirsCache.clear();
  ignoreRuleCache.clear();
  clearPluginManifestRegistryCache();
}

function debugSkillCommandOnce(
  messageKey: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  if (skillCommandDebugOnce.has(messageKey)) {
    return;
  }
  skillCommandDebugOnce.add(messageKey);
  skillsLogger.debug(message, meta);
}

function filterSkillEntries(
  entries: SkillEntry[],
  workspaceDir: string,
  config?: OpenClawConfig,
  skillFilter?: string[],
  eligibility?: SkillEligibilityContext,
): SkillEntry[] {
  let filtered = entries.filter((entry) =>
    shouldIncludeSkill({ entry, config, eligibility, workspaceDir }),
  );
  // If skillFilter is provided, only include skills in the filter list.
  if (skillFilter !== undefined) {
    const normalized = skillFilter.map((entry) => String(entry).trim()).filter(Boolean);
    const label = normalized.length > 0 ? normalized.join(", ") : "(none)";
    console.log(`[skills] Applying skill filter: ${label}`);
    filtered =
      normalized.length > 0
        ? filtered.filter((entry) => normalized.includes(entry.skill.name))
        : [];
    console.log(`[skills] After filter: ${filtered.map((entry) => entry.skill.name).join(", ")}`);
  }
  return filtered;
}

const SKILL_COMMAND_MAX_LENGTH = 32;
const SKILL_COMMAND_FALLBACK = "skill";
// Discord command descriptions must be ≤100 characters
const SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100;

function sanitizeSkillCommandName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const trimmed = normalized.slice(0, SKILL_COMMAND_MAX_LENGTH);
  return trimmed || SKILL_COMMAND_FALLBACK;
}

function resolveUniqueSkillCommandName(base: string, used: Set<string>): string {
  const normalizedBase = base.toLowerCase();
  if (!used.has(normalizedBase)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const maxBaseLength = Math.max(1, SKILL_COMMAND_MAX_LENGTH - suffix.length);
    const trimmedBase = base.slice(0, maxBaseLength);
    const candidate = `${trimmedBase}${suffix}`;
    const candidateKey = candidate.toLowerCase();
    if (!used.has(candidateKey)) {
      return candidate;
    }
  }
  const fallback = `${base.slice(0, Math.max(1, SKILL_COMMAND_MAX_LENGTH - 2))}_x`;
  return fallback;
}

function loadSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    eligibility?: SkillEligibilityContext;
  },
): SkillEntry[] {
  const resolvedWorkspaceDir = resolveUserPath(workspaceDir);
  const managedSkillsDir = resolveUserPath(
    opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills"),
  );
  const workspaceSkillsDir = path.join(resolvedWorkspaceDir, "skills");
  const bundledSkillsDirRaw = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
  const bundledSkillsDir = bundledSkillsDirRaw ? resolveUserPath(bundledSkillsDirRaw) : "";
  const extraDirsRaw = opts?.config?.skills?.load?.extraDirs ?? [];
  const extraDirs = extraDirsRaw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter(Boolean)
    .map((dir) => resolveUserPath(dir));
  const pluginSkillDirs = resolvePluginSkillDirs({
    workspaceDir: resolvedWorkspaceDir,
    config: opts?.config,
  }).map((dir) => resolveUserPath(dir));
  const pathScopedDirs = resolvePathScopedSkillDirs({
    workspaceDir: resolvedWorkspaceDir,
    activationPaths: opts?.eligibility?.activationPaths,
    excludedDirs: [
      managedSkillsDir,
      bundledSkillsDir,
      workspaceSkillsDir,
      ...extraDirs,
      ...pluginSkillDirs,
    ],
  });
  const cacheKey = buildWorkspaceSkillEntriesCacheKey({
    workspaceDir: resolvedWorkspaceDir,
    managedSkillsDir,
    bundledSkillsDir,
    extraDirs,
    pluginSkillDirs,
    pathScopedDirs,
  });
  const cached = workspaceSkillEntriesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sources: LoadedSkillSource[] = [];
  for (const dir of extraDirs) {
    sources.push(
      loadSkillSource({
        dir,
        source: "openclaw-extra",
        sourceLayer: "extra",
        sourceLabel: "extra",
      }),
    );
  }
  for (const dir of pluginSkillDirs) {
    sources.push(
      loadSkillSource({
        dir,
        source: "openclaw-plugin",
        sourceLayer: "plugin",
        sourceLabel: "plugin",
      }),
    );
  }
  if (bundledSkillsDir) {
    sources.push(
      loadSkillSource({
        dir: bundledSkillsDir,
        source: "openclaw-bundled",
        sourceLayer: "bundled",
        sourceLabel: "bundled",
      }),
    );
  }
  sources.push(
    loadSkillSource({
      dir: managedSkillsDir,
      source: "openclaw-managed",
      sourceLayer: "managed",
      sourceLabel: "managed",
    }),
  );
  sources.push(
    loadSkillSource({
      dir: workspaceSkillsDir,
      source: "openclaw-workspace",
      sourceLayer: "workspace",
      sourceLabel: "workspace",
    }),
  );
  for (const dir of pathScopedDirs) {
    sources.push(
      loadSkillSource({
        dir,
        source: "openclaw-workspace",
        sourceLayer: "workspace",
        sourceLabel: "path-scoped",
      }),
    );
  }

  for (const source of sources) {
    logSkillLoaderDiagnostics(
      source.sourceLabel,
      source.diagnostics,
      source.recoveredDiagnosticPaths,
    );
  }

  const uniqueByCanonicalPath = new Map<string, { skill: Skill; sourceLabel: string }>();
  for (const source of sources) {
    for (const skill of source.skills) {
      const canonicalFilePath = resolveCanonicalSkillFilePath(skill.filePath);
      uniqueByCanonicalPath.set(canonicalFilePath, { skill, sourceLabel: source.sourceLabel });
    }
  }

  const merged = new Map<string, { skill: Skill; sourceLabel: string }>();
  for (const { skill, sourceLabel } of uniqueByCanonicalPath.values()) {
    const existing = merged.get(skill.name);
    if (existing) {
      skillsLogger.warn("skill name collision across sources; applying precedence", {
        skillName: skill.name,
        winnerSource: sourceLabel,
        winnerPath: skill.filePath,
        loserSource: existing.sourceLabel,
        loserPath: existing.skill.filePath,
      });
    }
    merged.set(skill.name, { skill, sourceLabel });
  }

  const skillEntries = Array.from(merged.values()).map((entry) => toSkillEntry(entry.skill));
  workspaceSkillEntriesCache.set(cacheKey, skillEntries);
  return skillEntries;
}

export function buildWorkspaceSkillSnapshot(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
    snapshotVersion?: number;
  },
): SkillSnapshot {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    workspaceDir,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const promptEntries = eligible.filter(
    (entry) => entry.invocation?.disableModelInvocation !== true,
  );
  const resolvedSkills = promptEntries.map((entry) => entry.skill);
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  const discoverableSkills = buildDiscoverableSkills(eligible);
  const promptBody = buildBudgetedSkillsPrompt({
    skills: discoverableSkills,
    config: opts?.config,
  }).prompt;
  const prompt = [remoteNote, promptBody].filter(Boolean).join("\n");
  return {
    prompt,
    skills: eligible.map((entry) => ({
      name: entry.skill.name,
      primaryEnv: entry.metadata?.primaryEnv,
    })),
    resolvedSkills,
    version: opts?.snapshotVersion,
  };
}

export function buildWorkspaceSkillsPrompt(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
  },
): string {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    workspaceDir,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  const promptBody = buildBudgetedSkillsPrompt({
    skills: buildDiscoverableSkills(eligible),
    config: opts?.config,
  }).prompt;
  return [remoteNote, promptBody].filter(Boolean).join("\n");
}

export function resolveSkillsPromptForRun(params: {
  skillsSnapshot?: SkillSnapshot;
  entries?: SkillEntry[];
  config?: OpenClawConfig;
  workspaceDir: string;
}): string {
  const snapshotPrompt = params.skillsSnapshot?.prompt?.trim();
  if (snapshotPrompt) {
    return snapshotPrompt;
  }
  if (params.entries && params.entries.length > 0) {
    const prompt = buildWorkspaceSkillsPrompt(params.workspaceDir, {
      entries: params.entries,
      config: params.config,
    });
    return prompt.trim() ? prompt : "";
  }
  return "";
}

export function loadWorkspaceSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    eligibility?: SkillEligibilityContext;
  },
): SkillEntry[] {
  return loadSkillEntries(workspaceDir, opts);
}

export async function syncSkillsToWorkspace(params: {
  sourceWorkspaceDir: string;
  targetWorkspaceDir: string;
  config?: OpenClawConfig;
  managedSkillsDir?: string;
  bundledSkillsDir?: string;
}) {
  const sourceDir = resolveUserPath(params.sourceWorkspaceDir);
  const targetDir = resolveUserPath(params.targetWorkspaceDir);
  if (sourceDir === targetDir) {
    return;
  }

  await serializeByKey(`syncSkills:${targetDir}`, async () => {
    const targetSkillsDir = path.join(targetDir, "skills");

    const entries = loadSkillEntries(sourceDir, {
      config: params.config,
      managedSkillsDir: params.managedSkillsDir,
      bundledSkillsDir: params.bundledSkillsDir,
    });

    await fsp.rm(targetSkillsDir, { recursive: true, force: true });
    await fsp.mkdir(targetSkillsDir, { recursive: true });

    for (const entry of entries) {
      const dest = path.join(targetSkillsDir, entry.skill.name);
      try {
        await fsp.cp(entry.skill.baseDir, dest, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        console.warn(`[skills] Failed to copy ${entry.skill.name} to sandbox: ${message}`);
      }
    }

    clearWorkspaceSkillCaches();
  });
}

export function filterWorkspaceSkillEntries(
  entries: SkillEntry[],
  config?: OpenClawConfig,
  workspaceDir = process.cwd(),
): SkillEntry[] {
  return filterSkillEntries(entries, workspaceDir, config);
}

export function buildWorkspaceSkillCommandSpecs(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
    reservedNames?: Set<string>;
  },
): SkillCommandSpec[] {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    workspaceDir,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const userInvocable = eligible.filter((entry) => entry.invocation?.userInvocable !== false);
  const reserved = new Set<string>();
  for (const entry of opts?.reservedNames ?? []) {
    reserved.add(entry.toLowerCase());
  }

  const specs: SkillCommandSpec[] = [];
  const usedPrimaryNames = new Set<string>(reserved);
  for (const entry of userInvocable) {
    const rawName = entry.skill.name;
    const base = sanitizeSkillCommandName(rawName);
    if (base !== rawName) {
      debugSkillCommandOnce(
        `sanitize:${rawName}:${base}`,
        `Sanitized skill command name "${rawName}" to "/${base}".`,
        { rawName, sanitized: `/${base}` },
      );
    }
    const unique = resolveUniqueSkillCommandName(base, usedPrimaryNames);
    if (unique !== base) {
      debugSkillCommandOnce(
        `dedupe:${rawName}:${unique}`,
        `De-duplicated skill command name for "${rawName}" to "/${unique}".`,
        { rawName, deduped: `/${unique}` },
      );
    }
    usedPrimaryNames.add(unique.toLowerCase());
    const rawDescription = entry.skill.description?.trim() || rawName;
    const description =
      rawDescription.length > SKILL_COMMAND_DESCRIPTION_MAX_LENGTH
        ? rawDescription.slice(0, SKILL_COMMAND_DESCRIPTION_MAX_LENGTH - 1) + "…"
        : rawDescription;
    const dispatch = (() => {
      const kindRaw = (
        entry.frontmatter?.["command-dispatch"] ??
        entry.frontmatter?.["command_dispatch"] ??
        ""
      )
        .trim()
        .toLowerCase();
      if (!kindRaw) {
        return undefined;
      }
      if (kindRaw !== "tool") {
        return undefined;
      }

      const toolName = (
        entry.frontmatter?.["command-tool"] ??
        entry.frontmatter?.["command_tool"] ??
        ""
      ).trim();
      if (!toolName) {
        debugSkillCommandOnce(
          `dispatch:missingTool:${rawName}`,
          `Skill command "/${unique}" requested tool dispatch but did not provide command-tool. Ignoring dispatch.`,
          { skillName: rawName, command: unique },
        );
        return undefined;
      }

      const argModeRaw = (
        entry.frontmatter?.["command-arg-mode"] ??
        entry.frontmatter?.["command_arg_mode"] ??
        ""
      )
        .trim()
        .toLowerCase();
      const argMode = !argModeRaw || argModeRaw === "raw" ? "raw" : null;
      if (!argMode) {
        debugSkillCommandOnce(
          `dispatch:badArgMode:${rawName}:${argModeRaw}`,
          `Skill command "/${unique}" requested tool dispatch but has unknown command-arg-mode. Falling back to raw.`,
          { skillName: rawName, command: unique, argMode: argModeRaw },
        );
      }

      return { kind: "tool", toolName, argMode: "raw" } as const;
    })();

    specs.push({
      name: unique,
      skillName: rawName,
      description,
      ...(dispatch ? { dispatch } : {}),
    });
  }

  const usedAliases = new Set<string>(usedPrimaryNames);
  for (const spec of specs) {
    const entry = userInvocable.find((candidate) => candidate.skill.name === spec.skillName);
    const rawAliases = entry?.definition?.aliases ?? [];
    const aliases: string[] = [];
    for (const rawAlias of rawAliases) {
      const sanitizedAlias = sanitizeSkillCommandName(rawAlias);
      if (!sanitizedAlias) {
        continue;
      }
      const aliasKey = sanitizedAlias.toLowerCase();
      if (usedAliases.has(aliasKey)) {
        continue;
      }
      usedAliases.add(aliasKey);
      aliases.push(sanitizedAlias);
    }
    if (aliases.length > 0) {
      spec.aliases = aliases;
    }
  }
  return specs;
}
