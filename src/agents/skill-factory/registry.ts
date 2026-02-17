import fs from "node:fs/promises";
import path from "node:path";
import type { SkillFactoryRegistry, SkillFactorySkillVersion } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveManagedGeneratedSkillDir } from "./paths.js";

const log = createSubsystemLogger("skill-factory");

function createEmptyRegistry(): SkillFactoryRegistry {
  return {
    version: 1,
    updatedAt: Date.now(),
    skills: {},
  };
}

export async function loadSkillFactoryRegistry(pathname: string): Promise<SkillFactoryRegistry> {
  try {
    const raw = await fs.readFile(pathname, "utf-8");
    const parsed = JSON.parse(raw) as SkillFactoryRegistry;
    if (!parsed || parsed.version !== 1 || typeof parsed.skills !== "object") {
      return createEmptyRegistry();
    }
    return parsed;
  } catch {
    return createEmptyRegistry();
  }
}

export async function saveSkillFactoryRegistry(
  pathname: string,
  registry: SkillFactoryRegistry,
): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const tmp = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, pathname);
}

export async function upsertSkillFactoryVersion(params: {
  pathname: string;
  skillKey: string;
  skillName: string;
  version: SkillFactorySkillVersion;
}): Promise<SkillFactoryRegistry> {
  const registry = await loadSkillFactoryRegistry(params.pathname);
  const current = registry.skills[params.skillKey] ?? {
    skillKey: params.skillKey,
    skillName: params.skillName,
    versions: {},
    updatedAt: Date.now(),
  };
  current.skillName = params.skillName;
  current.versions[params.version.hash] = params.version;
  current.updatedAt = Date.now();
  registry.skills[params.skillKey] = current;
  registry.updatedAt = Date.now();
  await saveSkillFactoryRegistry(params.pathname, registry);
  return registry;
}

export async function markSkillFactoryVersionStatus(params: {
  pathname: string;
  skillKey: string;
  hash: string;
  status: SkillFactorySkillVersion["status"];
  lastEvalKey?: string;
}): Promise<SkillFactoryRegistry> {
  const registry = await loadSkillFactoryRegistry(params.pathname);
  const skill = registry.skills[params.skillKey];
  if (!skill) {
    return registry;
  }
  const version = skill.versions[params.hash];
  if (!version) {
    return registry;
  }
  version.status = params.status;
  if (params.lastEvalKey) {
    version.lastEvalKey = params.lastEvalKey;
  }
  skill.updatedAt = Date.now();
  registry.updatedAt = Date.now();
  await saveSkillFactoryRegistry(params.pathname, registry);
  return registry;
}

export async function promoteSkillFactoryVersion(params: {
  pathname: string;
  skillKey: string;
  hash: string;
}): Promise<{ ok: boolean; message: string; managedDir?: string }> {
  const registry = await loadSkillFactoryRegistry(params.pathname);
  const skill = registry.skills[params.skillKey];
  if (!skill) {
    return { ok: false, message: `Unknown skill key: ${params.skillKey}` };
  }
  const version = skill.versions[params.hash];
  if (!version) {
    return { ok: false, message: `Unknown skill version: ${params.hash}` };
  }

  const draftSkillPath = path.join(version.draftDir, "SKILL.md");
  const draftManifestPath = path.join(version.draftDir, "skill.safety.json");

  let skillContent = "";
  let manifestContent = "";
  try {
    skillContent = await fs.readFile(draftSkillPath, "utf-8");
    manifestContent = await fs.readFile(draftManifestPath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      message: `Failed reading draft skill artifacts: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const managedDir = resolveManagedGeneratedSkillDir(skill.skillKey);
  await fs.mkdir(managedDir, { recursive: true });
  await fs.writeFile(path.join(managedDir, "SKILL.md"), skillContent, "utf-8");
  await fs.writeFile(path.join(managedDir, "skill.safety.json"), manifestContent, "utf-8");

  for (const candidate of Object.values(skill.versions)) {
    if (candidate.status === "trusted" && candidate.hash !== version.hash) {
      candidate.status = "candidate";
    }
  }
  version.status = "trusted";
  version.managedDir = managedDir;
  skill.trustedHash = version.hash;
  skill.updatedAt = Date.now();
  registry.updatedAt = Date.now();
  await saveSkillFactoryRegistry(params.pathname, registry);
  log.info(`promoted skill ${skill.skillKey}@${version.hash.slice(0, 8)} to trusted`);
  return { ok: true, message: "promoted", managedDir };
}

export function resolveTrustedSkillHash(
  registry: SkillFactoryRegistry,
  skillKey: string,
): string | undefined {
  return registry.skills[skillKey]?.trustedHash;
}
