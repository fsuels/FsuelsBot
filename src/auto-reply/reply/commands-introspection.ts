import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { CommandHandler } from "./commands-types.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import { readConfigFileSnapshot } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { countToolResults, extractToolCallNames } from "../../utils/transcript-tools.js";

type GitWorkspaceSummary = {
  hasGit: boolean;
  workspaceExists: boolean;
  isRepo: boolean;
  repoRoot?: string;
  branch?: string;
  statusLines: string[];
  stagedStatLines: string[];
  unstagedStatLines: string[];
  error?: string;
};

type TranscriptMessageSummary = {
  role: string;
  text: string;
  toolCalls: string[];
  toolResultCount: number;
  toolResultErrors: number;
  timestamp?: string;
};

function extractCommandArgs(normalized: string, commandName: string): string | undefined {
  const prefix = `/${commandName}`;
  if (normalized === prefix) {
    return undefined;
  }
  if (!normalized.startsWith(`${prefix} `)) {
    return undefined;
  }
  const rest = normalized.slice(prefix.length).trim();
  return rest || undefined;
}

async function pathExists(pathname?: string | null): Promise<boolean> {
  const resolved = pathname?.trim();
  if (!resolved) {
    return false;
  }
  try {
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}

async function isWritablePath(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function splitNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function isGitMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

function isNotGitRepo(stderr: string, stdout = ""): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("not a git repository") ||
    combined.includes("unable to change to") ||
    combined.includes("cannot change to")
  );
}

async function collectGitWorkspaceSummary(workspaceDir: string): Promise<GitWorkspaceSummary> {
  const workspaceExists = await pathExists(workspaceDir);
  if (!workspaceExists) {
    return {
      hasGit: false,
      workspaceExists: false,
      isRepo: false,
      statusLines: [],
      stagedStatLines: [],
      unstagedStatLines: [],
      error: `workspace missing: ${workspaceDir}`,
    };
  }

  try {
    const revParse = await runCommandWithTimeout(
      ["git", "-C", workspaceDir, "rev-parse", "--show-toplevel"],
      5_000,
    );
    if (revParse.code !== 0) {
      return {
        hasGit: true,
        workspaceExists,
        isRepo: false,
        statusLines: [],
        stagedStatLines: [],
        unstagedStatLines: [],
        error: splitNonEmptyLines(revParse.stderr || revParse.stdout)[0],
      };
    }

    const repoRoot = revParse.stdout.trim() || workspaceDir;
    const [branchResult, statusResult, stagedResult, unstagedResult] = await Promise.all([
      runCommandWithTimeout(["git", "-C", workspaceDir, "rev-parse", "--abbrev-ref", "HEAD"], 5_000),
      runCommandWithTimeout(
        ["git", "-C", workspaceDir, "status", "--short", "--untracked-files=all"],
        5_000,
      ),
      runCommandWithTimeout(["git", "-C", workspaceDir, "diff", "--stat", "--cached"], 5_000),
      runCommandWithTimeout(["git", "-C", workspaceDir, "diff", "--stat"], 5_000),
    ]);

    return {
      hasGit: true,
      workspaceExists,
      isRepo: true,
      repoRoot,
      branch: branchResult.stdout.trim() || undefined,
      statusLines: splitNonEmptyLines(statusResult.stdout),
      stagedStatLines: splitNonEmptyLines(stagedResult.stdout),
      unstagedStatLines: splitNonEmptyLines(unstagedResult.stdout),
      error: undefined,
    };
  } catch (error) {
    if (isGitMissing(error)) {
      return {
        hasGit: false,
        workspaceExists,
        isRepo: false,
        statusLines: [],
        stagedStatLines: [],
        unstagedStatLines: [],
        error: "git is not installed",
      };
    }

    const detail = error instanceof Error ? error.message : String(error);
    if (isNotGitRepo(detail)) {
      return {
        hasGit: true,
        workspaceExists,
        isRepo: false,
        statusLines: [],
        stagedStatLines: [],
        unstagedStatLines: [],
        error: detail,
      };
    }

    return {
      hasGit: true,
      workspaceExists,
      isRepo: false,
      statusLines: [],
      stagedStatLines: [],
      unstagedStatLines: [],
      error: detail,
    };
  }
}

function summarizeTranscriptRole(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  return value.trim();
}

function extractTextPartsFromContent(content: unknown): string[] {
  if (typeof content === "string") {
    return content.trim() ? [content.trim()] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const texts: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const block = entry as Record<string, unknown>;
    const blockType = typeof block.type === "string" ? block.type.trim().toLowerCase() : "";
    if (
      (blockType === "text" ||
        blockType === "input_text" ||
        blockType === "output_text" ||
        blockType === "reasoning") &&
      typeof block.text === "string" &&
      block.text.trim()
    ) {
      texts.push(block.text.trim());
      continue;
    }
    if (
      (blockType === "tool_result" || blockType === "tool_result_error") &&
      typeof block.content === "string" &&
      block.content.trim()
    ) {
      texts.push(block.content.trim());
      continue;
    }
  }
  return texts;
}

function extractTranscriptMessages(raw: string): TranscriptMessageSummary[] {
  const messages: TranscriptMessageSummary[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const candidate =
      record.message && typeof record.message === "object"
        ? (record.message as Record<string, unknown>)
        : record;
    const role = summarizeTranscriptRole(candidate.role ?? record.role);
    if (role === "unknown" || role === "session") {
      continue;
    }

    const textParts = extractTextPartsFromContent(candidate.content);
    const text =
      textParts.join("\n\n").trim() ||
      (typeof candidate.text === "string" ? candidate.text.trim() : "") ||
      (typeof record.text === "string" ? record.text.trim() : "");
    const toolCalls = extractToolCallNames(candidate);
    const toolResults = countToolResults(candidate);
    const timestampValue = candidate.timestamp ?? record.timestamp;
    const timestamp =
      typeof timestampValue === "number" && Number.isFinite(timestampValue)
        ? new Date(timestampValue).toISOString()
        : typeof timestampValue === "string" && timestampValue.trim()
          ? timestampValue.trim()
          : undefined;

    messages.push({
      role,
      text,
      toolCalls,
      toolResultCount: toolResults.total,
      toolResultErrors: toolResults.errors,
      timestamp,
    });
  }
  return messages;
}

function summarizeFirstUserPrompt(messages: TranscriptMessageSummary[]): string | undefined {
  const firstUser = messages.find((message) => message.role === "user" && message.text.trim());
  return firstUser?.text.trim() || undefined;
}

function summarizeFinalAssistantText(messages: TranscriptMessageSummary[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.text.trim()) {
      return message.text.trim();
    }
  }
  return undefined;
}

function sanitizeExportBasename(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]+/g, "");
  const sanitized = ascii
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .toLowerCase();
  return sanitized || "session";
}

function buildTimestampSlug(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  const hours = `${now.getHours()}`.padStart(2, "0");
  const minutes = `${now.getMinutes()}`.padStart(2, "0");
  const seconds = `${now.getSeconds()}`.padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function resolveExportBasename(params: {
  requested?: string;
  transcriptMessages: TranscriptMessageSummary[];
}): { ok: true; basename: string } | { ok: false; message: string } {
  const requested = params.requested?.trim();
  if (requested) {
    if (
      path.isAbsolute(requested) ||
      requested !== path.basename(requested) ||
      requested.includes("..")
    ) {
      return {
        ok: false,
        message: "Export filename must be a plain filename inside the OpenClaw export directory.",
      };
    }
    const parsed = path.parse(requested);
    const ext = parsed.ext.toLowerCase();
    const safeExt = ext === ".txt" ? ".txt" : ".md";
    const base = sanitizeExportBasename(parsed.name || requested);
    return { ok: true, basename: `${base}${safeExt}` };
  }

  const promptSlug = sanitizeExportBasename(
    summarizeFirstUserPrompt(params.transcriptMessages)?.slice(0, 48) || "session",
  );
  return {
    ok: true,
    basename: `${buildTimestampSlug()}-${promptSlug}.md`,
  };
}

function renderTranscript(messages: TranscriptMessageSummary[]): string {
  if (messages.length === 0) {
    return "_No transcript messages available._";
  }

  return messages
    .map((message, index) => {
      const lines = [`### ${index + 1}. ${message.role}`];
      if (message.timestamp) {
        lines[0] += ` · ${message.timestamp}`;
      }
      if (message.text) {
        lines.push("", message.text);
      }
      if (message.toolCalls.length > 0) {
        lines.push("", `Tool calls: ${message.toolCalls.join(", ")}`);
      }
      if (message.toolResultCount > 0) {
        const errorSuffix =
          message.toolResultErrors > 0 ? ` (${message.toolResultErrors} error)` : "";
        lines.push("", `Tool results: ${message.toolResultCount}${errorSuffix}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export async function buildDoctorText(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
  workspaceDir: string;
}): Promise<string> {
  const snapshot = await readConfigFileSnapshot();
  const warnings = snapshot.warnings ?? [];
  const git = await collectGitWorkspaceSummary(params.workspaceDir);
  const authMode = resolveModelAuthMode(params.provider, params.cfg) ?? "unknown";
  const runtimeStatus = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.sessionKey ?? params.sessionEntry?.sessionId ?? "main",
  });
  const workspaceExists = await pathExists(params.workspaceDir);
  const workspaceWritable = workspaceExists ? await isWritablePath(params.workspaceDir) : false;
  const transcriptPath =
    params.sessionEntry?.sessionFile?.trim() ||
    (params.sessionEntry?.sessionId
      ? resolveSessionFilePath(params.sessionEntry.sessionId, params.sessionEntry)
      : undefined);
  const transcriptExists = await pathExists(transcriptPath);

  let dockerLine: string | undefined;
  if ((runtimeStatus.mode ?? "off") !== "off") {
    try {
      const docker = await runCommandWithTimeout(["docker", "--version"], 5_000);
      dockerLine =
        docker.code === 0
          ? `Docker: ${docker.stdout.trim() || docker.stderr.trim() || "available"}`
          : `Docker: unavailable (${splitNonEmptyLines(docker.stderr || docker.stdout)[0] ?? "exit failure"})`;
    } catch (error) {
      dockerLine = `Docker: unavailable (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  const suggestions: string[] = [];
  if (!snapshot.valid) {
    suggestions.push("Run `openclaw doctor --repair` to repair config or state issues.");
  }
  if (authMode === "unknown") {
    suggestions.push(
      `Configure credentials for ${params.provider} or switch to a provider that is already authenticated.`,
    );
  }
  if (!workspaceExists) {
    suggestions.push("Point the agent at an existing workspace before asking for code edits.");
  } else if (!workspaceWritable) {
    suggestions.push("Grant write access to the workspace or switch to a writable workspace path.");
  }
  if (!git.hasGit) {
    suggestions.push("Install git to unlock workspace diff inspection and cleaner session exports.");
  } else if (!git.isRepo) {
    suggestions.push(
      "OpenClaw can still work here, but diff/export are more useful inside a git repository.",
    );
  }
  if (
    (runtimeStatus.mode ?? "off") !== "off" &&
    dockerLine?.toLowerCase().includes("unavailable")
  ) {
    suggestions.push("Install or start Docker, or disable sandboxing if this workspace should run direct.");
  }
  if (!transcriptExists) {
    suggestions.push("This session has no transcript file yet; send a normal turn first or start a fresh session.");
  }

  const lines = [
    "Health check",
    `Config: ${snapshot.valid ? "ok" : snapshot.exists ? "invalid" : "missing"}`,
    `Model: ${params.provider}/${params.model}`,
    `Auth: ${authMode}`,
    `Workspace: ${
      workspaceExists
        ? workspaceWritable
          ? `writable (${params.workspaceDir})`
          : `read-only (${params.workspaceDir})`
        : `missing (${params.workspaceDir})`
    }`,
    `Git: ${
      !git.hasGit
        ? "unavailable"
        : git.isRepo
          ? `${git.repoRoot}${git.branch ? ` (${git.branch})` : ""}`
          : "workspace is not a git repo"
    }`,
    `Sandbox: ${runtimeStatus.mode ?? "off"} (${runtimeStatus.sandboxed ? "sandboxed" : "direct"})`,
    transcriptPath
      ? `Transcript: ${transcriptExists ? `ready (${transcriptPath})` : `missing (${transcriptPath})`}`
      : "Transcript: not created yet",
  ];
  if (dockerLine) {
    lines.push(dockerLine);
  }
  if (warnings.length > 0) {
    lines.push(`Config warnings: ${warnings.length}`);
  }
  if (suggestions.length > 0) {
    lines.push("", "Suggestions");
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }
  return lines.join("\n");
}

export async function buildDiffText(workspaceDir: string): Promise<string> {
  const git = await collectGitWorkspaceSummary(workspaceDir);
  if (!git.workspaceExists) {
    return `Workspace missing: ${workspaceDir}`;
  }
  if (!git.hasGit) {
    return "Git is not installed, so workspace diff is unavailable.";
  }
  if (!git.isRepo) {
    return `No git repository found at ${workspaceDir}.`;
  }

  const lines = ["Workspace diff", `Repo: ${git.repoRoot ?? workspaceDir}`];
  if (git.branch) {
    lines.push(`Branch: ${git.branch}`);
  }

  if (
    git.statusLines.length === 0 &&
    git.stagedStatLines.length === 0 &&
    git.unstagedStatLines.length === 0
  ) {
    lines.push("Working tree clean.");
    return lines.join("\n");
  }

  if (git.statusLines.length > 0) {
    lines.push("", "Status");
    for (const line of git.statusLines.slice(0, 20)) {
      lines.push(line);
    }
    if (git.statusLines.length > 20) {
      lines.push(`... ${git.statusLines.length - 20} more`);
    }
  }

  if (git.stagedStatLines.length > 0) {
    lines.push("", "Staged diff stat");
    lines.push(...git.stagedStatLines.slice(0, 20));
  }

  if (git.unstagedStatLines.length > 0) {
    lines.push("", "Working tree diff stat");
    lines.push(...git.unstagedStatLines.slice(0, 20));
  }

  return lines.join("\n");
}

export async function exportSessionReport(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string;
  sessionEntry?: SessionEntry;
  sessionKey: string;
  workspaceDir: string;
  requestedFilename?: string;
}): Promise<{ path: string; basename: string }> {
  const transcriptPath =
    params.sessionEntry?.sessionFile?.trim() ||
    (params.sessionEntry?.sessionId
      ? resolveSessionFilePath(params.sessionEntry.sessionId, params.sessionEntry)
      : undefined);
  const transcriptRaw =
    transcriptPath && (await pathExists(transcriptPath))
      ? await fs.readFile(transcriptPath, "utf8")
      : "";
  const transcriptMessages = extractTranscriptMessages(transcriptRaw);
  const basenameResult = resolveExportBasename({
    requested: params.requestedFilename,
    transcriptMessages,
  });
  if (!basenameResult.ok) {
    throw new Error(basenameResult.message);
  }

  const exportDir = path.join(resolveStateDir(), "exports", "sessions");
  await fs.mkdir(exportDir, { recursive: true, mode: 0o700 });

  const doctorText = await buildDoctorText({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
  });
  const diffText = await buildDiffText(params.workspaceDir);
  const finalAssistantText = summarizeFinalAssistantText(transcriptMessages);
  const outputPath = path.join(exportDir, basenameResult.basename);
  const contents = [
    "# OpenClaw Session Export",
    "",
    `- Exported: ${new Date().toISOString()}`,
    `- Session key: ${params.sessionKey}`,
    `- Session id: ${params.sessionEntry?.sessionId ?? "unknown"}`,
    `- Workspace: ${params.workspaceDir}`,
    `- Model: ${params.provider}/${params.model}`,
    transcriptPath ? `- Transcript path: ${transcriptPath}` : "- Transcript path: unavailable",
    "",
    "## Doctor",
    "",
    "```text",
    doctorText,
    "```",
    "",
    "## Diff",
    "",
    "```text",
    diffText,
    "```",
    "",
    "## Final Assistant Message",
    "",
    finalAssistantText ? finalAssistantText : "_No assistant message found in the session transcript._",
    "",
    "## Transcript",
    "",
    renderTranscript(transcriptMessages),
    "",
  ].join("\n");

  await fs.writeFile(outputPath, contents, { encoding: "utf8", mode: 0o600 });
  return { path: outputPath, basename: basenameResult.basename };
}

export const handleDoctorCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/doctor" && !normalized.startsWith("/doctor ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /doctor from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const text = await buildDoctorText({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
  });
  return { shouldContinue: false, reply: { text } };
};

export const handleDiffCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/diff" && !normalized.startsWith("/diff ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /diff from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return {
    shouldContinue: false,
    reply: { text: await buildDiffText(params.workspaceDir) },
  };
};

export const handleExportCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/export" && !normalized.startsWith("/export ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /export from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  try {
    const requestedFilename = extractCommandArgs(normalized, "export");
    const result = await exportSessionReport({
      cfg: params.cfg,
      provider: params.provider,
      model: params.model,
      sessionEntry: params.sessionEntry,
      sessionKey: params.sessionKey,
      workspaceDir: params.workspaceDir,
      requestedFilename,
    });
    return {
      shouldContinue: false,
      reply: {
        text: `Session export written to ${result.path}`,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      shouldContinue: false,
      reply: { text: `⚠️ Export failed: ${detail}` },
    };
  }
};
