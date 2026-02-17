import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { SkillFactorySafetyManifest } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../skills.js";

const log = createSubsystemLogger("skill-factory");
const warnedMissingManifest = new Set<string>();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validateSafetyManifest(input: unknown): {
  ok: boolean;
  errors: string[];
  manifest?: SkillFactorySafetyManifest;
} {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) {
    errors.push("manifest version must be 1");
  }
  const permissions =
    raw.permissions && typeof raw.permissions === "object"
      ? (raw.permissions as Record<string, unknown>)
      : null;
  if (!permissions) {
    errors.push("permissions block is required");
  }
  const tools = permissions?.tools;
  if (!isStringArray(tools) || tools.length === 0) {
    errors.push("permissions.tools must be a non-empty string[]");
  }
  const risk =
    raw.risk && typeof raw.risk === "object" ? (raw.risk as Record<string, unknown>) : null;
  if (!risk) {
    errors.push("risk block is required");
  }
  const sideEffects = risk?.sideEffects;
  if (
    sideEffects !== "read_only" &&
    sideEffects !== "writes" &&
    sideEffects !== "send" &&
    sideEffects !== "transaction"
  ) {
    errors.push("risk.sideEffects must be one of: read_only|writes|send|transaction");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: SkillFactorySafetyManifest = {
    version: 1,
    permissions: {
      tools: Array.from(new Set((tools as string[]).map((entry) => entry.trim()).filter(Boolean))),
      networkDomains: isStringArray(permissions?.networkDomains)
        ? permissions?.networkDomains.map((entry) => entry.trim()).filter(Boolean)
        : undefined,
      fileReadGlobs: isStringArray(permissions?.fileReadGlobs)
        ? permissions?.fileReadGlobs.map((entry) => entry.trim()).filter(Boolean)
        : undefined,
      fileWriteGlobs: isStringArray(permissions?.fileWriteGlobs)
        ? permissions?.fileWriteGlobs.map((entry) => entry.trim()).filter(Boolean)
        : undefined,
      execAllowlist: isStringArray(permissions?.execAllowlist)
        ? permissions?.execAllowlist.map((entry) => entry.trim()).filter(Boolean)
        : undefined,
    },
    risk: {
      sideEffects: sideEffects as SkillFactorySafetyManifest["risk"]["sideEffects"],
      requiresConfirmation: risk?.requiresConfirmation === true,
    },
  };
  return { ok: true, errors: [], manifest };
}

export async function loadSkillSafetyManifest(skillFilePath: string): Promise<{
  manifest?: SkillFactorySafetyManifest;
  errors: string[];
}> {
  const filePath = path.join(path.dirname(skillFilePath), "skill.safety.json");
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { errors: ["missing skill.safety.json"] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = validateSafetyManifest(parsed);
    if (!validated.ok) {
      return { errors: validated.errors };
    }
    return { manifest: validated.manifest, errors: [] };
  } catch {
    return { errors: ["invalid JSON in skill.safety.json"] };
  }
}

function stripConfirmationFlag(args: string): string {
  return args
    .split(/\s+/)
    .filter((token) => token.trim().length > 0 && token.trim() !== "--confirm")
    .join(" ")
    .trim();
}

function hasConfirmationFlag(args: string): boolean {
  return args
    .split(/\s+/)
    .map((token) => token.trim())
    .some((token) => token === "--confirm");
}

function resolveSkillByName(
  workspaceDir: string,
  skillName: string,
  config?: OpenClawConfig,
): SkillEntry | null {
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  return entries.find((entry) => entry.skill.name === skillName) ?? null;
}

export async function enforceSkillDispatchPolicy(params: {
  workspaceDir: string;
  skillName: string;
  toolName: string;
  rawArgs: string;
  config?: OpenClawConfig;
}): Promise<{ ok: boolean; reason?: string; normalizedArgs?: string }> {
  const entry = resolveSkillByName(params.workspaceDir, params.skillName, params.config);
  if (!entry) {
    return { ok: false, reason: `Unknown skill: ${params.skillName}` };
  }

  const generatedRaw = (entry.frontmatter["skill-factory-generated"] ?? "").trim().toLowerCase();
  const isGenerated = generatedRaw === "true" || generatedRaw === "1";

  const { manifest, errors } = await loadSkillSafetyManifest(entry.skill.filePath);
  if (!manifest) {
    if (isGenerated) {
      return {
        ok: false,
        reason: `Generated skill is missing a valid safety manifest (${errors.join(", ")})`,
      };
    }
    const warnKey = `${entry.skill.filePath}:missing-manifest`;
    if (!warnedMissingManifest.has(warnKey)) {
      warnedMissingManifest.add(warnKey);
      log.warn(
        `legacy skill without safety manifest allowed (skill=${entry.skill.name} path=${entry.skill.filePath})`,
      );
    }
    return { ok: true, normalizedArgs: params.rawArgs };
  }

  const allowedTools = new Set(manifest.permissions.tools.map((name) => name.trim().toLowerCase()));
  if (!allowedTools.has(params.toolName.trim().toLowerCase())) {
    return {
      ok: false,
      reason: `Skill safety policy blocked tool "${params.toolName}" for ${params.skillName}`,
    };
  }

  if (manifest.risk.requiresConfirmation && !hasConfirmationFlag(params.rawArgs)) {
    return {
      ok: false,
      reason:
        `Skill ${params.skillName} requires confirmation for side effects. ` +
        `Retry with --confirm in the command arguments.`,
    };
  }

  return {
    ok: true,
    normalizedArgs: manifest.risk.requiresConfirmation
      ? stripConfirmationFlag(params.rawArgs)
      : params.rawArgs,
  };
}

export function buildGeneratedSkillSafetyManifest(params: {
  toolName: string;
  sideEffects?: SkillFactorySafetyManifest["risk"]["sideEffects"];
  requiresConfirmation?: boolean;
}): SkillFactorySafetyManifest {
  const sideEffects =
    params.sideEffects ?? (params.toolName === "sessions_send" ? "send" : "read_only");
  return {
    version: 1,
    permissions: {
      tools: [params.toolName],
    },
    risk: {
      sideEffects,
      requiresConfirmation: params.requiresConfirmation ?? sideEffects !== "read_only",
    },
  };
}
