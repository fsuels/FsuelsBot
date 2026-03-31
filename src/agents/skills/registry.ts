import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type {
  DiscoverableSkill,
  SkillEntry,
  SkillPromptMetrics,
  SkillsPromptTruncationMode,
  SkillSourceCategory,
} from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("skills");

const DEFAULT_SKILLS_PROMPT_BUDGET_CHARS = 4096;
const DEFAULT_SKILL_DESCRIPTION_MAX_CHARS = 160;
const SKILLS_PROMPT_INTRO_LINES = [
  "",
  "",
  "The following skills provide specialized instructions for specific tasks.",
  "Use the read tool to load a skill's file when the task matches its description.",
  "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
  "",
  "<available_skills>",
];
const SKILLS_PROMPT_FOOTER = "</available_skills>";
const DESCRIPTION_FALLBACK_STEPS = [80, 40, 0];

function truncateWithEllipsis(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxChars <= 0) {
    return "";
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  if (maxChars === 1) {
    return trimmed.slice(0, 1);
  }
  return `${trimmed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function renderPrompt(params: {
  skills: DiscoverableSkill[];
  descriptionLimits: Map<string, number>;
}): { text: string; truncatedCount: number; namesOnlyCount: number } {
  const lines = [...SKILLS_PROMPT_INTRO_LINES];
  let truncatedCount = 0;
  let namesOnlyCount = 0;
  for (const skill of params.skills) {
    const requestedLimit = params.descriptionLimits.get(skill.name);
    const descriptionLimit =
      typeof requestedLimit === "number" && Number.isFinite(requestedLimit) ? requestedLimit : 0;
    const description = truncateWithEllipsis(skill.description, descriptionLimit);
    if (description !== skill.description.trim()) {
      truncatedCount += 1;
    }
    if (!description) {
      namesOnlyCount += 1;
    }
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(description)}</description>`);
    if (isNonEmpty(skill.whenToUse)) {
      lines.push(`    <when_to_use>${escapeXml(skill.whenToUse)}</when_to_use>`);
    }
    lines.push(`    <source>${escapeXml(skill.sourceCategory)}</source>`);
    lines.push(`    <location>${escapeXml(skill.entry.skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push(SKILLS_PROMPT_FOOTER);
  return { text: lines.join("\n"), truncatedCount, namesOnlyCount };
}

function categoryPriority(sourceCategory: SkillSourceCategory): number {
  switch (sourceCategory) {
    case "bundled":
      return 0;
    case "workspace":
      return 1;
    case "managed":
      return 2;
    case "plugin":
      return 3;
    case "extra":
      return 4;
    default:
      return 5;
  }
}

function degradationOrder(skills: DiscoverableSkill[]): DiscoverableSkill[] {
  return [...skills].sort((a, b) => {
    const priorityDelta = categoryPriority(b.sourceCategory) - categoryPriority(a.sourceCategory);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return a.name.localeCompare(b.name);
  });
}

export function resolveSkillSourceCategory(source: string): SkillSourceCategory {
  const normalized = source.trim().toLowerCase();
  if (normalized === "openclaw-bundled") {
    return "bundled";
  }
  if (normalized === "openclaw-workspace") {
    return "workspace";
  }
  if (normalized === "openclaw-managed") {
    return "managed";
  }
  if (normalized === "openclaw-plugin") {
    return "plugin";
  }
  if (normalized === "openclaw-extra") {
    return "extra";
  }
  return "unknown";
}

export function resolveSkillPromptBudgetChars(params?: {
  config?: OpenClawConfig;
  contextWindowTokens?: number;
  explicitBudgetChars?: number;
}): number {
  const explicit =
    typeof params?.explicitBudgetChars === "number" && Number.isFinite(params.explicitBudgetChars)
      ? Math.max(1, Math.floor(params.explicitBudgetChars))
      : undefined;
  if (explicit) {
    return explicit;
  }
  const configured =
    typeof params?.config?.skills?.load?.promptBudgetChars === "number" &&
    Number.isFinite(params.config.skills.load.promptBudgetChars)
      ? Math.max(1, Math.floor(params.config.skills.load.promptBudgetChars))
      : undefined;
  if (configured) {
    return configured;
  }
  const contextWindowTokens =
    typeof params?.contextWindowTokens === "number" && Number.isFinite(params.contextWindowTokens)
      ? params.contextWindowTokens
      : params?.config?.agents?.defaults?.contextTokens;
  if (
    typeof contextWindowTokens === "number" &&
    Number.isFinite(contextWindowTokens) &&
    contextWindowTokens > 0
  ) {
    return Math.max(512, Math.floor(contextWindowTokens * 4 * 0.01));
  }
  return DEFAULT_SKILLS_PROMPT_BUDGET_CHARS;
}

export function resolveSkillDescriptionMaxChars(params?: {
  config?: OpenClawConfig;
  explicitMaxChars?: number;
}): number {
  const explicit =
    typeof params?.explicitMaxChars === "number" && Number.isFinite(params.explicitMaxChars)
      ? Math.max(1, Math.floor(params.explicitMaxChars))
      : undefined;
  if (explicit) {
    return explicit;
  }
  const configured =
    typeof params?.config?.skills?.load?.descriptionMaxChars === "number" &&
    Number.isFinite(params.config.skills.load.descriptionMaxChars)
      ? Math.max(1, Math.floor(params.config.skills.load.descriptionMaxChars))
      : undefined;
  return configured ?? DEFAULT_SKILL_DESCRIPTION_MAX_CHARS;
}

export function buildDiscoverableSkills(entries: SkillEntry[]): DiscoverableSkill[] {
  return [...entries]
    .filter((entry) => entry.invocation?.disableModelInvocation !== true)
    .map((entry) => {
      const sourceCategory = resolveSkillSourceCategory(entry.skill.source);
      return {
        entry,
        name: entry.skill.name,
        description: entry.skill.description?.trim() ?? "",
        whenToUse: entry.definition?.whenToUse,
        sourceCategory,
        promptPriority: categoryPriority(sourceCategory),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildBudgetedSkillsPrompt(params: {
  skills: DiscoverableSkill[];
  config?: OpenClawConfig;
  budgetChars?: number;
  descriptionMaxChars?: number;
  contextWindowTokens?: number;
}): { prompt: string; metrics: SkillPromptMetrics } {
  const budgetChars = resolveSkillPromptBudgetChars({
    config: params.config,
    contextWindowTokens: params.contextWindowTokens,
    explicitBudgetChars: params.budgetChars,
  });
  const descriptionMaxChars = resolveSkillDescriptionMaxChars({
    config: params.config,
    explicitMaxChars: params.descriptionMaxChars,
  });
  if (params.skills.length === 0) {
    return {
      prompt: "",
      metrics: {
        totalSkills: 0,
        includedSkills: 0,
        budgetChars,
        truncationMode: "full",
        truncatedCount: 0,
      },
    };
  }

  const included = [...params.skills];
  const descriptionLimits = new Map<string, number>(
    included.map((skill) => [skill.name, descriptionMaxChars]),
  );
  let rendered = renderPrompt({ skills: included, descriptionLimits });

  const degradeOrder = degradationOrder(included);
  if (rendered.text.length > budgetChars) {
    for (const nextLimit of DESCRIPTION_FALLBACK_STEPS) {
      for (const skill of degradeOrder) {
        const currentLimit = descriptionLimits.get(skill.name) ?? descriptionMaxChars;
        if (currentLimit <= nextLimit) {
          continue;
        }
        descriptionLimits.set(skill.name, nextLimit);
        rendered = renderPrompt({ skills: included, descriptionLimits });
        if (rendered.text.length <= budgetChars) {
          break;
        }
      }
      if (rendered.text.length <= budgetChars) {
        break;
      }
    }
  }

  let truncationMode: SkillsPromptTruncationMode =
    rendered.truncatedCount > 0
      ? rendered.namesOnlyCount > 0
        ? "names_only"
        : "truncated"
      : "full";

  if (rendered.text.length > budgetChars) {
    const removable = degradationOrder(included);
    while (included.length > 0 && rendered.text.length > budgetChars && removable.length > 0) {
      const toRemove = removable.shift();
      if (!toRemove) {
        break;
      }
      const index = included.findIndex((entry) => entry.name === toRemove.name);
      if (index === -1) {
        continue;
      }
      included.splice(index, 1);
      descriptionLimits.delete(toRemove.name);
      rendered = renderPrompt({ skills: included, descriptionLimits });
    }
    if (included.length === 0 && rendered.text.length > budgetChars) {
      rendered = {
        text: "",
        truncatedCount: params.skills.length,
        namesOnlyCount: params.skills.length,
      };
    }
    if (params.skills.length !== included.length) {
      truncationMode = "omitted";
    }
  }

  const metrics: SkillPromptMetrics = {
    totalSkills: params.skills.length,
    includedSkills: included.length,
    budgetChars,
    truncationMode,
    truncatedCount: rendered.truncatedCount + Math.max(0, params.skills.length - included.length),
  };

  if (metrics.truncationMode !== "full") {
    log.info("skill prompt truncated to fit budget", metrics);
  }

  return { prompt: rendered.text, metrics };
}

export function resolveSkillPathBaseDir(filePath: string) {
  return path.dirname(filePath);
}
