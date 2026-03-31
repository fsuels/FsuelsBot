import type { Skill } from "@mariozechner/pi-coding-agent";
import JSON5 from "json5";
import type {
  SkillDefinitionMetadata,
  OpenClawSkillMetadata,
  ParsedSkillFrontmatter,
  SkillEntry,
  SkillExecutionContextMode,
  SkillInstallSpec,
  SkillInvocationPolicy,
} from "./types.js";
import { LEGACY_MANIFEST_KEYS, MANIFEST_KEY } from "../../compat/legacy-names.js";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import { parseBooleanValue } from "../../utils/boolean.js";

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

export function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return normalized;
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return normalized;
  }
  return normalized.slice(endIndex + "\n---".length).replace(/^\s+/, "");
}

function normalizeStringList(input: unknown): string[] {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON5.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((value) => String(value).trim()).filter(Boolean);
        }
      } catch {
        // Fall through to comma/newline splitting.
      }
    }
    return trimmed
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const kindRaw =
    typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = kindRaw.trim().toLowerCase();
  if (kind !== "brew" && kind !== "node" && kind !== "go" && kind !== "uv" && kind !== "download") {
    return undefined;
  }

  const spec: SkillInstallSpec = {
    kind: kind,
  };

  if (typeof raw.id === "string") {
    spec.id = raw.id;
  }
  if (typeof raw.label === "string") {
    spec.label = raw.label;
  }
  const bins = normalizeStringList(raw.bins);
  if (bins.length > 0) {
    spec.bins = bins;
  }
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  if (typeof raw.formula === "string") {
    spec.formula = raw.formula;
  }
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.module === "string") {
    spec.module = raw.module;
  }
  if (typeof raw.url === "string") {
    spec.url = raw.url;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }

  return spec;
}

function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string): string | undefined {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}

function getFirstFrontmatterValue(
  frontmatter: ParsedSkillFrontmatter,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = getFrontmatterValue(frontmatter, key)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseFrontmatterBool(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanValue(value);
  return parsed === undefined ? fallback : parsed;
}

function normalizeContextMode(value: string | undefined): SkillExecutionContextMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "inline" || normalized === "fork") {
    return normalized;
  }
  return undefined;
}

export function resolveOpenClawMetadata(
  frontmatter: ParsedSkillFrontmatter,
): OpenClawSkillMetadata | undefined {
  const raw = getFrontmatterValue(frontmatter, "metadata");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const metadataRawCandidates = [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS];
    let metadataRaw: unknown;
    for (const key of metadataRawCandidates) {
      const candidate = parsed[key];
      if (candidate && typeof candidate === "object") {
        metadataRaw = candidate;
        break;
      }
    }
    if (!metadataRaw || typeof metadataRaw !== "object") {
      return undefined;
    }
    const metadataObj = metadataRaw as Record<string, unknown>;
    const requiresRaw =
      typeof metadataObj.requires === "object" && metadataObj.requires !== null
        ? (metadataObj.requires as Record<string, unknown>)
        : undefined;
    const installRaw = Array.isArray(metadataObj.install) ? (metadataObj.install as unknown[]) : [];
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry));
    const osRaw = normalizeStringList(metadataObj.os);
    return {
      always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
      emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
      homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
      skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
      primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
      os: osRaw.length > 0 ? osRaw : undefined,
      requires: requiresRaw
        ? {
            bins: normalizeStringList(requiresRaw.bins),
            anyBins: normalizeStringList(requiresRaw.anyBins),
            env: normalizeStringList(requiresRaw.env),
            config: normalizeStringList(requiresRaw.config),
          }
        : undefined,
      install: install.length > 0 ? install : undefined,
    };
  } catch {
    return undefined;
  }
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterValue(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterValue(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

export function resolveSkillDefinitionMetadata(
  frontmatter: ParsedSkillFrontmatter,
): SkillDefinitionMetadata | undefined {
  const aliases = normalizeStringList(frontmatter.aliases ?? frontmatter.alias);
  const whenToUse = getFirstFrontmatterValue(frontmatter, ["when-to-use", "when_to_use"]);
  const argumentHint = getFirstFrontmatterValue(frontmatter, ["argument-hint", "argument_hint"]);
  const argumentsList = normalizeStringList(frontmatter.arguments);
  const allowedTools = normalizeStringList(
    frontmatter["allowed-tools"] ?? frontmatter.allowed_tools,
  );
  const model = getFirstFrontmatterValue(frontmatter, [
    "model",
    "model-override",
    "model_override",
  ]);
  const effort = getFirstFrontmatterValue(frontmatter, [
    "effort",
    "reasoning-effort",
    "reasoning_effort",
  ]);
  const context = normalizeContextMode(getFirstFrontmatterValue(frontmatter, ["context"]));
  const agent = getFirstFrontmatterValue(frontmatter, ["agent"]);
  const pathFilters = normalizeStringList(
    frontmatter.paths ??
      frontmatter.path ??
      frontmatter["path-filters"] ??
      frontmatter.path_filters,
  );

  if (
    aliases.length === 0 &&
    !whenToUse &&
    !argumentHint &&
    argumentsList.length === 0 &&
    allowedTools.length === 0 &&
    !model &&
    !effort &&
    !context &&
    !agent &&
    pathFilters.length === 0
  ) {
    return undefined;
  }

  return {
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    ...(argumentsList.length > 0 ? { arguments: argumentsList } : {}),
    ...(allowedTools.length > 0 ? { allowedTools } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(context ? { context } : {}),
    ...(agent ? { agent } : {}),
    ...(pathFilters.length > 0 ? { pathFilters } : {}),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
