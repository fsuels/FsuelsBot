import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";

export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".openclaw", `workspace-${profile}`);
  }
  return path.join(home, ".openclaw", "workspace");
}

export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md";
const DEFAULT_INSTRUCTION_INCLUDE_DEPTH = 8;
const ALLOWED_INSTRUCTION_INCLUDE_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);
const HTML_COMMENT_BLOCK_RE = /<!--[\s\S]*?-->/g;

export type WorkspaceInstructionSourceGroup =
  | "project"
  | "project-local"
  | "user"
  | "managed"
  | "built-in"
  | "unknown";

export type WorkspaceInstructionProvenance = {
  path: string;
  sourceGroup: WorkspaceInstructionSourceGroup;
  parentInclude?: string;
  rawChars: number;
  transformedChars: number;
};

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

function stripHtmlComments(content: string): string {
  return content.replace(HTML_COMMENT_BLOCK_RE, "");
}

function normalizeInstructionText(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return stripHtmlComments(stripFrontMatter(normalized)).replace(/^\s+/, "");
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

function normalizeStringList(raw: string | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to line-based parsing.
    }
  }
  return trimmed
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveTargetPathCandidates(
  workspaceDir: string,
  targetPath?: string,
  workspaceDirAliases: string[] = [],
): string[] {
  const roots = Array.from(
    new Set([workspaceDir, ...workspaceDirAliases].map((value) => path.resolve(value))),
  );
  const rawTarget = targetPath?.trim() ? resolveUserPath(targetPath) : workspaceDir;
  const candidateTargets: string[] = [path.resolve(rawTarget)];
  try {
    const realTarget = fsSync.realpathSync.native?.(rawTarget) ?? fsSync.realpathSync(rawTarget);
    candidateTargets.push(realTarget);
  } catch {
    // Missing target paths still work through the unresolved path.
  }

  for (const root of roots) {
    for (const candidateTarget of candidateTargets) {
      if (!isPathWithin(root, candidateTarget)) {
        continue;
      }
      const relative = normalizePosixPath(path.relative(root, candidateTarget));
      return [relative || "."];
    }
  }
  return ["."];
}

function resolveWorkspaceInstructionSourceGroup(params: {
  name?: string;
  filePath: string;
  workspaceDir: string;
}): WorkspaceInstructionSourceGroup {
  const normalizedName = (params.name ?? path.basename(params.filePath)).trim().toUpperCase();
  if (normalizedName === "IDENTITY.MD" || normalizedName === "USER.MD") {
    return "user";
  }
  if (
    normalizedName === "HEARTBEAT.MD" ||
    normalizedName === "ACTIVE_TASK" ||
    normalizedName === "TASK_TRACKER"
  ) {
    return "managed";
  }
  const relativePath = normalizePosixPath(path.relative(params.workspaceDir, params.filePath));
  if (
    relativePath.startsWith(".openclaw/") ||
    relativePath.startsWith(".private/") ||
    relativePath.startsWith(".local/")
  ) {
    return "project-local";
  }
  return "project";
}

function parseIncludeDirective(line: string): string | undefined {
  const match = line.match(/^\s*@include\s+(.+?)\s*$/);
  if (!match?.[1]) {
    return undefined;
  }
  const raw = match[1].trim();
  if (!raw) {
    return undefined;
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    const unquoted = raw.slice(1, -1).trim();
    return unquoted || undefined;
  }
  return raw;
}

function matchesInstructionTarget(params: {
  content: string;
  workspaceDir: string;
  workspaceDirAliases?: string[];
  targetPath?: string;
}): boolean {
  const frontmatter = parseFrontmatterBlock(params.content);
  const pathRules = normalizeStringList(frontmatter.paths ?? frontmatter.path);
  if (pathRules.length === 0) {
    return true;
  }
  const candidates = resolveTargetPathCandidates(
    params.workspaceDir,
    params.targetPath,
    params.workspaceDirAliases,
  );
  return pathRules.some((glob) =>
    candidates.some((candidate) => path.posix.matchesGlob(candidate, normalizePosixPath(glob))),
  );
}

async function resolveCanonicalPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function loadInstructionFile(
  filePath: string,
  state: InstructionIncludeLoadState,
  opts?: {
    displayName?: string;
    parentInclude?: string;
    depth?: number;
  },
): Promise<LoadedInstructionFile | null> {
  const depth = opts?.depth ?? 0;
  const resolvedPath = path.resolve(filePath);
  const canonicalPath = await resolveCanonicalPath(resolvedPath);
  const displayName = opts?.displayName ?? path.basename(canonicalPath);
  if (depth > state.maxDepth) {
    state.warn?.(
      `workspace instruction include depth exceeded for ${displayName} (max ${state.maxDepth})`,
    );
    return null;
  }
  if (!isPathWithin(state.workspaceDir, canonicalPath)) {
    state.warn?.(`workspace instruction include blocked outside workspace: ${canonicalPath}`);
    return null;
  }
  const ext = path.extname(canonicalPath).toLowerCase();
  if (ext && !ALLOWED_INSTRUCTION_INCLUDE_EXTENSIONS.has(ext)) {
    state.warn?.(`workspace instruction include skipped for non-text file: ${canonicalPath}`);
    return null;
  }
  if (state.activePaths.has(canonicalPath)) {
    state.warn?.(`workspace instruction include cycle detected: ${canonicalPath}`);
    return null;
  }
  if (state.loadedPaths.has(canonicalPath)) {
    state.warn?.(`workspace instruction include skipped duplicate path: ${canonicalPath}`);
    return null;
  }

  const rawContent = await fs.readFile(canonicalPath, "utf-8");
  if (
    !matchesInstructionTarget({
      content: rawContent,
      workspaceDir: state.workspaceDir,
      workspaceDirAliases: state.workspaceDirAliases,
      targetPath: state.targetPath,
    })
  ) {
    return null;
  }

  state.activePaths.add(canonicalPath);
  state.loadedPaths.add(canonicalPath);
  try {
    const sourceGroup = resolveWorkspaceInstructionSourceGroup({
      name: displayName,
      filePath: canonicalPath,
      workspaceDir: state.workspaceDir,
    });
    const renderedLines: string[] = [];
    const provenance: WorkspaceInstructionProvenance[] = [];
    for (const line of normalizeInstructionText(rawContent).split("\n")) {
      const includeTarget = parseIncludeDirective(line);
      if (!includeTarget) {
        renderedLines.push(line);
        continue;
      }
      const childPath = path.isAbsolute(includeTarget)
        ? path.resolve(includeTarget)
        : path.resolve(path.dirname(canonicalPath), includeTarget);
      const child = await loadInstructionFile(childPath, state, {
        parentInclude: canonicalPath,
        depth: depth + 1,
      });
      if (child?.transformedContent) {
        renderedLines.push(child.transformedContent);
      }
      if (child?.provenance?.length) {
        provenance.push(...child.provenance);
      }
    }

    const transformedContent = renderedLines.join("\n").trim();
    return {
      rawContent,
      transformedContent,
      sourceGroup,
      provenance: [
        {
          path: canonicalPath,
          sourceGroup,
          parentInclude: opts?.parentInclude,
          rawChars: rawContent.length,
          transformedChars: transformedContent.length,
        },
        ...provenance,
      ],
    };
  } finally {
    state.activePaths.delete(canonicalPath);
  }
}

async function loadTemplate(name: string): Promise<string> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const templatePath = path.join(templateDir, name);
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return stripFrontMatter(content);
  } catch {
    throw new Error(
      `Missing workspace template: ${name} (${templatePath}). Ensure docs/reference/templates are packaged.`,
    );
  }
}

export type WorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_BOOTSTRAP_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME
  | typeof DEFAULT_MEMORY_ALT_FILENAME;

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  rawContent?: string;
  missing: boolean;
  sourceGroup?: WorkspaceInstructionSourceGroup;
  provenance?: WorkspaceInstructionProvenance[];
};

type InstructionIncludeLoadState = {
  workspaceDir: string;
  workspaceDirAliases: string[];
  targetPath?: string;
  warn?: (message: string) => void;
  maxDepth: number;
  activePaths: Set<string>;
  loadedPaths: Set<string>;
};

type LoadedInstructionFile = {
  rawContent: string;
  transformedContent: string;
  sourceGroup: WorkspaceInstructionSourceGroup;
  provenance: WorkspaceInstructionProvenance[];
};

async function writeFileIfMissing(filePath: string, content: string) {
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
}

async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function ensureGitRepo(dir: string, isBrandNewWorkspace: boolean) {
  if (!isBrandNewWorkspace) {
    return;
  }
  if (await hasGitRepo(dir)) {
    return;
  }
  if (!(await isGitAvailable())) {
    return;
  }
  try {
    await runCommandWithTimeout(["git", "init"], { cwd: dir, timeoutMs: 10_000 });
  } catch {
    // Ignore git init failures; workspace creation should still succeed.
  }
}

export async function ensureAgentWorkspace(params?: {
  dir?: string;
  ensureBootstrapFiles?: boolean;
}): Promise<{
  dir: string;
  agentsPath?: string;
  soulPath?: string;
  toolsPath?: string;
  identityPath?: string;
  userPath?: string;
  heartbeatPath?: string;
  bootstrapPath?: string;
}> {
  const rawDir = params?.dir?.trim() ? params.dir.trim() : DEFAULT_AGENT_WORKSPACE_DIR;
  const dir = resolveUserPath(rawDir);
  await fs.mkdir(dir, { recursive: true });

  if (!params?.ensureBootstrapFiles) {
    return { dir };
  }

  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);

  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME);
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);

  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);
  if (isBrandNewWorkspace) {
    await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    bootstrapPath,
  };
}

async function resolveMemoryBootstrapEntries(
  resolvedDir: string,
): Promise<Array<{ name: WorkspaceBootstrapFileName; filePath: string }>> {
  const candidates: WorkspaceBootstrapFileName[] = [
    DEFAULT_MEMORY_FILENAME,
    DEFAULT_MEMORY_ALT_FILENAME,
  ];
  const entries: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  for (const name of candidates) {
    const filePath = path.join(resolvedDir, name);
    try {
      await fs.access(filePath);
      entries.push({ name, filePath });
    } catch {
      // optional
    }
  }
  if (entries.length <= 1) {
    return entries;
  }

  const seen = new Set<string>();
  const deduped: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  for (const entry of entries) {
    let key = entry.filePath;
    try {
      key = await fs.realpath(entry.filePath);
    } catch {}
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

export async function loadWorkspaceBootstrapFiles(
  dir: string,
  opts?: {
    warn?: (message: string) => void;
    targetPath?: string;
  },
): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);
  const canonicalWorkspaceDir = await resolveCanonicalPath(resolvedDir);

  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(canonicalWorkspaceDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
  ];

  entries.push(...(await resolveMemoryBootstrapEntries(canonicalWorkspaceDir)));

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const loaded = await loadInstructionFile(entry.filePath, {
        workspaceDir: canonicalWorkspaceDir,
        workspaceDirAliases: [resolvedDir],
        targetPath: opts?.targetPath,
        warn: opts?.warn,
        maxDepth: DEFAULT_INSTRUCTION_INCLUDE_DEPTH,
        activePaths: new Set<string>(),
        loadedPaths: new Set<string>(),
      });
      result.push({
        name: entry.name,
        path: entry.filePath,
        content: loaded?.transformedContent,
        rawContent: loaded?.rawContent,
        missing: false,
        sourceGroup: loaded?.sourceGroup,
        provenance: loaded?.provenance,
      });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }
  return result;
}

const SUBAGENT_BOOTSTRAP_ALLOWLIST = new Set([DEFAULT_AGENTS_FILENAME, DEFAULT_TOOLS_FILENAME]);

export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || !isSubagentSessionKey(sessionKey)) {
    return files;
  }
  return files.filter((file) => SUBAGENT_BOOTSTRAP_ALLOWLIST.has(file.name));
}
