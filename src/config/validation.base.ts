import type { ZodIssue } from "zod";
import path from "node:path";
import type { OpenClawConfig, ConfigValidationIssue } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { findDuplicateAgentDirs, formatDuplicateAgentDirError } from "./agent-dirs.js";
import { applyAgentDefaults, applyModelDefaults, applySessionDefaults } from "./defaults.js";
import { findLegacyConfigIssues } from "./legacy.js";
import { getConfigIssueDocLink, getConfigIssueSuggestion } from "./trust-boundaries.js";
import { OpenClawSchema } from "./zod-schema.js";

const AVATAR_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

function formatIssuePath(pathSegments: ReadonlyArray<PropertyKey>): string {
  return pathSegments.map(String).join(".");
}

function readValueAtIssuePath(root: unknown, pathSegments: ReadonlyArray<PropertyKey>): unknown {
  let current = root;
  for (const segment of pathSegments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = typeof segment === "number" ? segment : Number.parseInt(String(segment), 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[String(segment)];
  }
  return current;
}

function readExpectedFromIssue(issue: ZodIssue): string | undefined {
  const issueLike = issue as {
    expected?: unknown;
    values?: unknown;
    keys?: unknown;
    errors?: unknown;
  };
  if (Array.isArray(issueLike.values) && issueLike.values.length > 0) {
    return issueLike.values.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (typeof issueLike.expected === "string" && issueLike.expected.trim()) {
    return issueLike.expected;
  }
  if (Array.isArray(issueLike.keys) && issueLike.keys.length > 0) {
    return `recognized keys: ${issueLike.keys.join(", ")}`;
  }
  if (issue.code === "invalid_union" && Array.isArray(issueLike.errors)) {
    const unionValues = issueLike.errors
      .flatMap((entry) => (Array.isArray(entry) ? entry : []))
      .flatMap((entry) => {
        const candidate = entry as { values?: unknown };
        return Array.isArray(candidate.values) ? candidate.values : [];
      });
    if (unionValues.length > 0) {
      return Array.from(new Set(unionValues.map((value) => JSON.stringify(value)))).join(" | ");
    }
  }
  return undefined;
}

function buildValidationIssueFromZod(issue: ZodIssue, root: unknown): ConfigValidationIssue {
  const path = formatIssuePath(issue.path);
  const expected = readExpectedFromIssue(issue);
  const invalidValue = readValueAtIssuePath(root, issue.path);
  const suggestion = getConfigIssueSuggestion({
    path,
    message: issue.message,
    expected,
  });
  const docLink = getConfigIssueDocLink(path);

  return {
    path,
    message: issue.message,
    ...(expected ? { expected } : {}),
    ...(invalidValue !== undefined ? { invalidValue } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(docLink ? { docLink } : {}),
  };
}

function isWorkspaceAvatarPath(value: string, workspaceDir: string): boolean {
  const workspaceRoot = path.resolve(workspaceDir);
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === "") {
    return true;
  }
  if (relative.startsWith("..")) {
    return false;
  }
  return !path.isAbsolute(relative);
}

function validateIdentityAvatar(config: OpenClawConfig): ConfigValidationIssue[] {
  const agents = config.agents?.list;
  if (!Array.isArray(agents) || agents.length === 0) {
    return [];
  }
  const issues: ConfigValidationIssue[] = [];
  for (const [index, entry] of agents.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const avatarRaw = entry.identity?.avatar;
    if (typeof avatarRaw !== "string") {
      continue;
    }
    const avatar = avatarRaw.trim();
    if (!avatar) {
      continue;
    }
    if (AVATAR_DATA_RE.test(avatar) || AVATAR_HTTP_RE.test(avatar)) {
      continue;
    }
    if (avatar.startsWith("~")) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
      });
      continue;
    }
    const hasScheme = AVATAR_SCHEME_RE.test(avatar);
    if (hasScheme && !WINDOWS_ABS_RE.test(avatar)) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
      });
      continue;
    }
    const workspaceDir = resolveAgentWorkspaceDir(
      config,
      entry.id ?? resolveDefaultAgentId(config),
    );
    if (!isWorkspaceAvatarPath(avatar, workspaceDir)) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must stay within the agent workspace.",
      });
    }
  }
  return issues;
}

export function validateConfigObject(
  raw: unknown,
): { ok: true; config: OpenClawConfig } | { ok: false; issues: ConfigValidationIssue[] } {
  const legacyIssues = findLegacyConfigIssues(raw);
  if (legacyIssues.length > 0) {
    return {
      ok: false,
      issues: legacyIssues.map((iss) => ({
        path: iss.path,
        message: iss.message,
      })),
    };
  }
  const validated = OpenClawSchema.safeParse(raw);
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map((issue) => buildValidationIssueFromZod(issue, raw)),
    };
  }
  const duplicates = findDuplicateAgentDirs(validated.data as OpenClawConfig);
  if (duplicates.length > 0) {
    return {
      ok: false,
      issues: [
        {
          path: "agents.list",
          message: formatDuplicateAgentDirError(duplicates),
        },
      ],
    };
  }
  const avatarIssues = validateIdentityAvatar(validated.data as OpenClawConfig);
  if (avatarIssues.length > 0) {
    return { ok: false, issues: avatarIssues };
  }
  return {
    ok: true,
    config: applyModelDefaults(
      applyAgentDefaults(applySessionDefaults(validated.data as OpenClawConfig)),
    ),
  };
}
