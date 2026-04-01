import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createAgentSession, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionEntry, SessionMaintenanceState } from "../config/sessions/types.js";
import type {
  PostTurnMaintenanceContext,
  PostTurnMaintenanceJob,
} from "./post-turn-maintenance.js";
import { loadSessionStore, resolveStorePath, updateSessionStoreEntry } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { hashText, isMemoryPath, listMemoryFiles, normalizeRelPath } from "../memory/internal.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import { resolveAgentIdFromSessionKey } from "./agent-scope.js";
import { getApiKeyForModel } from "./model-auth.js";
import { ensureOpenClawModelsJson } from "./models-config.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { applySystemPromptOverrideToSession } from "./pi-embedded-runner/system-prompt.js";
import { splitSdkTools } from "./pi-embedded-runner/tool-split.js";
import { createOpenClawFindTool } from "./pi-tools.find.js";
import {
  createWorkspaceEditTool,
  createWorkspaceReadTool,
  createWorkspaceWriteTool,
} from "./pi-tools.read.js";
import {
  applyToolContracts,
  createStructuredToolFailureResult,
  type ContractAwareTool,
} from "./tool-contracts.js";
import { createGrepTool } from "./tools/grep-tool.js";

const log = createSubsystemLogger("agents/durable-memory-maintenance");

const DEFAULT_TURN_THROTTLE = 1;
const DEFAULT_MAX_TURNS = 5;
const MAX_RECENT_TRANSCRIPT_CHARS = 24_000;
const MAX_TOOL_RESULT_TEXT_CHARS = 800;
const MAX_TEXT_BLOCK_CHARS = 2_000;

export const DURABLE_MEMORY_EXTRACTOR_SYSTEM_PROMPT = [
  "You are OpenClaw's background durable-memory maintainer.",
  "Your job is to update durable memory markdown files from the recent conversation slice.",
  "Only inspect the supplied conversation slice and the current memory files available in this workspace copy.",
  "Do not verify against source code, git history, tests, or unrelated project files.",
  "Read candidate memory files first, then apply the smallest necessary edits.",
  "Prefer merging into existing topic files over creating near-duplicate files.",
  "Keep memory current-state and terse. Remove stale or contradicted facts at the source instead of appending history.",
  "Do not write changelogs, diary recaps, or session summaries.",
].join("\n");

export type DurableMemoryWorkerParams = {
  workspaceDir: string;
  agentDir?: string;
  config?: PostTurnMaintenanceContext["config"];
  provider: string;
  model: string;
  authProfileId?: string;
  systemPrompt: string;
  prompt: string;
  maxTurns: number;
};

export type DurableMemoryMaintenanceOptions = {
  now?: () => number;
  turnThrottle?: number;
  maxTurns?: number;
  runExtractor?: (params: DurableMemoryWorkerParams) => Promise<void>;
};

type VisibleConversationSlice = {
  recentRawMessages: AgentMessage[];
  recentVisibleMessages: AgentMessage[];
  nextCursorVisibleMessageCount: number;
};

type MemoryWorkspaceSnapshot = {
  relPath: string;
  hash: string;
};

type MemoryManifestEntry = {
  relPath: string;
  sizeBytes: number;
  heading?: string;
};

type ParsedToolCall = {
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
};

function isVisibleConversationMessage(message: AgentMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

function toToolCallArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseToolCallArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return toToolCallArgs(parsed);
    } catch {
      return {};
    }
  }
  return toToolCallArgs(value);
}

function parseAssistantToolCalls(message: AgentMessage): ParsedToolCall[] {
  const messageContent = (message as { content?: unknown }).content;
  if (message.role !== "assistant" || !Array.isArray(messageContent)) {
    return [];
  }
  const calls: ParsedToolCall[] = [];
  for (const block of messageContent) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as unknown as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (type !== "toolUse" && type !== "toolCall") {
      continue;
    }
    const toolName = typeof record.name === "string" ? record.name.trim() : "";
    if (!toolName) {
      continue;
    }
    calls.push({
      toolName,
      toolCallId: typeof record.id === "string" ? record.id : undefined,
      args: parseToolCallArguments("input" in record ? record.input : record.arguments),
    });
  }
  return calls;
}

function extractToolPath(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return normalizeRelPath(value);
    }
  }
  return undefined;
}

function extractApplyPatchTargets(patch: string): string[] {
  const matches = patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm);
  const out: string[] = [];
  for (const match of matches) {
    const filePath = match[1]?.trim();
    if (!filePath) {
      continue;
    }
    out.push(normalizeRelPath(filePath));
  }
  return out;
}

function toolCallTouchesMemory(call: ParsedToolCall): boolean {
  const normalizedTool = call.toolName.trim().toLowerCase();
  if (normalizedTool === "apply_patch") {
    const patch = typeof call.args.patch === "string" ? call.args.patch : "";
    return extractApplyPatchTargets(patch).some((filePath) => isMemoryPath(filePath));
  }
  if (normalizedTool !== "write" && normalizedTool !== "edit") {
    return false;
  }
  const filePath = extractToolPath(call.args);
  return Boolean(filePath && isMemoryPath(filePath));
}

export function detectMainAgentMemoryWrite(messages: readonly AgentMessage[]): boolean {
  const memoryToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of parseAssistantToolCalls(message)) {
        if (toolCallTouchesMemory(call) && call.toolCallId) {
          memoryToolCallIds.add(call.toolCallId);
        }
      }
      continue;
    }
    if (message.role !== "toolResult") {
      continue;
    }
    const toolResultRecord = message as unknown as {
      toolCallId?: string;
      toolUseId?: string;
    };
    const correlationId =
      typeof toolResultRecord.toolCallId === "string"
        ? toolResultRecord.toolCallId
        : typeof toolResultRecord.toolUseId === "string"
          ? toolResultRecord.toolUseId
          : undefined;
    if (correlationId && memoryToolCallIds.has(correlationId)) {
      return true;
    }
  }
  return false;
}

export function sliceMessagesSinceVisibleCursor(
  messages: readonly AgentMessage[],
  cursorVisibleMessageCount = 0,
): VisibleConversationSlice {
  const clampedCursor = Math.max(0, Math.floor(cursorVisibleMessageCount));
  let visibleCount = 0;
  let rawStartIndex = messages.length;
  const recentVisibleMessages: AgentMessage[] = [];

  messages.forEach((message, index) => {
    if (!isVisibleConversationMessage(message)) {
      return;
    }
    visibleCount += 1;
    if (visibleCount <= clampedCursor) {
      return;
    }
    if (rawStartIndex === messages.length) {
      rawStartIndex = index;
    }
    recentVisibleMessages.push(message);
  });

  return {
    recentRawMessages: rawStartIndex >= messages.length ? [] : messages.slice(rawStartIndex),
    recentVisibleMessages,
    nextCursorVisibleMessageCount: visibleCount,
  };
}

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n...[truncated]`;
}

function formatMessageContent(message: AgentMessage): string {
  if (message.role === "toolResult") {
    const messageContent = (message as { content?: unknown }).content;
    const blocks = Array.isArray(messageContent) ? messageContent : [];
    const textParts: string[] = [];
    for (const block of blocks) {
      const record =
        block && typeof block === "object" ? (block as { type?: unknown; text?: unknown }) : null;
      if (record?.type === "text" && typeof record.text === "string") {
        textParts.push(record.text);
      }
    }
    const text = textParts.join("\n").trim();
    const label = message.toolName ? `[tool result: ${message.toolName}]` : "[tool result]";
    return text ? `${label}\n${truncateText(text, MAX_TOOL_RESULT_TEXT_CHARS)}` : label;
  }

  const lines: string[] = [];
  const messageContent = (message as { content?: unknown }).content;
  if (Array.isArray(messageContent)) {
    for (const block of messageContent) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const record = block as unknown as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      if (type === "text" && typeof record.text === "string" && record.text.trim()) {
        lines.push(truncateText(record.text, MAX_TEXT_BLOCK_CHARS));
        continue;
      }
      if ((type === "toolUse" || type === "toolCall") && typeof record.name === "string") {
        const args = parseToolCallArguments("input" in record ? record.input : record.arguments);
        lines.push(
          `[tool call: ${record.name}] ${truncateText(JSON.stringify(args), MAX_TEXT_BLOCK_CHARS)}`,
        );
      }
    }
  }
  if (lines.length === 0 && typeof (message as { content?: unknown }).content === "string") {
    lines.push(
      truncateText(String((message as { content?: string }).content), MAX_TEXT_BLOCK_CHARS),
    );
  }
  return lines.filter(Boolean).join("\n");
}

export function renderRecentConversationSlice(messages: readonly AgentMessage[]): string {
  const lines: string[] = [];
  let chars = 0;
  for (const message of messages) {
    const roleLabel =
      message.role === "toolResult"
        ? "Tool"
        : message.role === "assistant"
          ? "Assistant"
          : message.role === "user"
            ? "User"
            : "Message";
    const body = formatMessageContent(message);
    if (!body) {
      continue;
    }
    const rendered = `${roleLabel}:\n${body}`.trim();
    if (chars + rendered.length > MAX_RECENT_TRANSCRIPT_CHARS && lines.length > 0) {
      lines.push("...[older recent messages truncated]");
      break;
    }
    lines.push(rendered);
    chars += rendered.length;
  }
  return lines.join("\n\n").trim();
}

async function readFirstHeading(absPath: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(absPath, "utf-8");
    const heading = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#{1,6}\s+/.test(line));
    return heading?.replace(/^#{1,6}\s+/, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function buildMemoryManifest(workspaceDir: string): Promise<MemoryManifestEntry[]> {
  const files = await listMemoryFiles(workspaceDir);
  const entries = await Promise.all(
    files.map(async (absPath) => {
      const relPath = normalizeRelPath(path.relative(workspaceDir, absPath));
      const stat = await fs.stat(absPath);
      return {
        relPath,
        sizeBytes: stat.size,
        heading: await readFirstHeading(absPath),
      } satisfies MemoryManifestEntry;
    }),
  );
  entries.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return entries;
}

export function renderMemoryManifest(entries: readonly MemoryManifestEntry[]): string {
  if (entries.length === 0) {
    return "No existing durable memory files yet.";
  }
  return entries
    .map((entry) => {
      const heading = entry.heading ? ` | heading: ${entry.heading}` : "";
      return `- ${entry.relPath} | ${entry.sizeBytes} bytes${heading}`;
    })
    .join("\n");
}

export function buildDurableMemoryExtractorPrompt(params: {
  recentConversation: string;
  memoryManifest: string;
}): string {
  return [
    "Update durable memory only if the recent conversation contains information worth keeping across future sessions.",
    "Rules:",
    "- Analyze only the recent conversation slice below.",
    "- Do not verify against source code, git, tests, or unrelated files.",
    "- Read the candidate memory files you need first, ideally in parallel.",
    "- Then perform the necessary write/edit actions, ideally in parallel.",
    "- Do not bounce between exploratory reads and writes over many extra turns.",
    "- Prefer updating existing topic files over creating new duplicates.",
    "- Keep any index-like notes terse and navigational, not content-heavy.",
    "- Replace or remove stale/wrong statements instead of appending a timeline.",
    "- If nothing durable should change, make no file edits.",
    "",
    "Current durable memory manifest:",
    params.memoryManifest,
    "",
    "Recent conversation slice:",
    params.recentConversation || "(No recent conversation content available.)",
  ].join("\n");
}

function isAllowedMemoryWorkspacePath(
  rawPath: unknown,
  options?: { allowDirectoryRoot?: boolean },
): boolean {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return false;
  }
  const normalized = normalizeRelPath(rawPath);
  if (options?.allowDirectoryRoot && (normalized === "memory" || normalized === "memory/")) {
    return true;
  }
  return isMemoryPath(normalized);
}

function withPathRestriction(
  tool: ContractAwareTool,
  params: {
    allowMissingPath?: boolean;
    defaultPathAllowed?: boolean;
  } = {},
): ContractAwareTool {
  return applyToolContracts({
    ...tool,
    execute: async (toolCallId, input, signal, onUpdate) => {
      const record =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const candidatePath = record.path ?? record.file_path;
      const missingPath = candidatePath == null || candidatePath === "";
      const allowedPath =
        missingPath && params.allowMissingPath
          ? true
          : params.defaultPathAllowed && (candidatePath === "." || candidatePath === "./")
            ? true
            : isAllowedMemoryWorkspacePath(candidatePath, {
                allowDirectoryRoot: tool.name === "find" || tool.name === "grep",
              });
      if (!allowedPath) {
        return createStructuredToolFailureResult({
          toolName: tool.name,
          code: "precondition_failed",
          message: `${tool.name} may only access MEMORY.md or files under memory/.`,
        });
      }
      return await tool.execute(toolCallId, input, signal, onUpdate);
    },
  });
}

export function createDurableMemoryWorkerTools(workspaceDir: string): ContractAwareTool[] {
  return [
    withPathRestriction(createWorkspaceReadTool(workspaceDir), {
      allowMissingPath: false,
    }),
    withPathRestriction(createWorkspaceWriteTool(workspaceDir), {
      allowMissingPath: false,
    }),
    withPathRestriction(createWorkspaceEditTool(workspaceDir), {
      allowMissingPath: false,
    }),
    withPathRestriction(
      createOpenClawFindTool({
        workspaceRoot: workspaceDir,
      }) as ContractAwareTool,
      {
        allowMissingPath: true,
        defaultPathAllowed: true,
      },
    ),
    withPathRestriction(
      createGrepTool({
        cwd: workspaceDir,
      }) as ContractAwareTool,
      {
        allowMissingPath: true,
        defaultPathAllowed: true,
      },
    ),
  ];
}

async function snapshotMemoryWorkspace(
  workspaceDir: string,
): Promise<Map<string, MemoryWorkspaceSnapshot>> {
  const files = await listMemoryFiles(workspaceDir);
  const entries = await Promise.all(
    files.map(async (absPath) => {
      const text = await fs.readFile(absPath, "utf-8");
      const relPath = normalizeRelPath(path.relative(workspaceDir, absPath));
      return {
        relPath,
        hash: hashText(text),
      } satisfies MemoryWorkspaceSnapshot;
    }),
  );
  return new Map(entries.map((entry) => [entry.relPath, entry]));
}

async function copyMemoryWorkspace(params: {
  sourceWorkspaceDir: string;
  targetWorkspaceDir: string;
}): Promise<void> {
  const files = await listMemoryFiles(params.sourceWorkspaceDir);
  await fs.mkdir(path.join(params.targetWorkspaceDir, "memory"), { recursive: true });
  await Promise.all(
    files.map(async (absPath) => {
      const relPath = normalizeRelPath(path.relative(params.sourceWorkspaceDir, absPath));
      if (!isMemoryPath(relPath)) {
        return;
      }
      const targetPath = path.join(params.targetWorkspaceDir, relPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(absPath, targetPath);
    }),
  );
}

async function syncChangedMemoryFiles(params: {
  sourceWorkspaceDir: string;
  targetWorkspaceDir: string;
  before: Map<string, MemoryWorkspaceSnapshot>;
}): Promise<string[]> {
  const after = await snapshotMemoryWorkspace(params.sourceWorkspaceDir);
  const changed: string[] = [];
  for (const [relPath, snapshot] of after.entries()) {
    if (params.before.get(relPath)?.hash === snapshot.hash) {
      continue;
    }
    const sourcePath = path.join(params.sourceWorkspaceDir, relPath);
    const targetPath = path.join(params.targetWorkspaceDir, relPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    changed.push(relPath);
  }
  changed.sort((left, right) => left.localeCompare(right));
  return changed;
}

function readMaintenanceState(
  entry: SessionEntry,
): NonNullable<SessionMaintenanceState["durableMemory"]> {
  return entry.maintenance?.durableMemory ?? {};
}

async function updateDurableMemoryState(params: {
  storePath: string;
  sessionKey: string;
  mutate: (
    current: NonNullable<SessionMaintenanceState["durableMemory"]>,
    entry: SessionEntry,
  ) => NonNullable<SessionMaintenanceState["durableMemory"]>;
}): Promise<void> {
  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: async (entry) => {
      const nextDurable = params.mutate(readMaintenanceState(entry), entry);
      return {
        maintenance: {
          ...entry.maintenance,
          durableMemory: nextDurable,
        },
      };
    },
  });
}

export async function runDurableMemoryWorker(params: DurableMemoryWorkerParams): Promise<void> {
  const agentDir = params.agentDir ?? resolveOpenClawAgentDir();
  await ensureOpenClawModelsJson(params.config, agentDir);
  const { model, error, authStorage, modelRegistry } = resolveModel(
    params.provider,
    params.model,
    agentDir,
    params.config,
  );
  if (!model) {
    throw new Error(error ?? `Unknown model: ${params.provider}/${params.model}`);
  }

  const apiKeyInfo = await getApiKeyForModel({
    model,
    cfg: params.config,
    profileId: params.authProfileId,
    agentDir,
  });
  if (!apiKeyInfo.apiKey && apiKeyInfo.mode !== "aws-sdk") {
    throw new Error(
      `No API key resolved for provider "${model.provider}" (auth mode: ${apiKeyInfo.mode}).`,
    );
  }
  if (apiKeyInfo.apiKey) {
    if (model.provider === "github-copilot") {
      const { resolveCopilotApiToken } = await import("../providers/github-copilot-token.js");
      const copilotToken = await resolveCopilotApiToken({
        githubToken: apiKeyInfo.apiKey,
      });
      authStorage.setRuntimeApiKey(model.provider, copilotToken.token);
    } else {
      authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
    }
  }

  const tools = createDurableMemoryWorkerTools(params.workspaceDir);
  const { builtInTools, customTools } = splitSdkTools({
    tools,
    sandboxEnabled: false,
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const sessionManager = SessionManager.inMemory();
  const { session } = await createAgentSession({
    cwd: params.workspaceDir,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: "off",
    tools: builtInTools,
    customTools,
    sessionManager,
    settingsManager,
  });
  applySystemPromptOverrideToSession(session, params.systemPrompt);

  let turnCount = 0;
  let capped = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "turn_end") {
      return;
    }
    turnCount += 1;
    const toolResultCount = Array.isArray(event.toolResults) ? event.toolResults.length : 0;
    if (turnCount >= params.maxTurns && toolResultCount > 0) {
      capped = true;
      void session.abort().catch(() => undefined);
    }
  });

  try {
    await session.prompt(params.prompt);
  } catch (error) {
    if (!capped) {
      throw error;
    }
    log.warn(`durable memory worker hit turn cap (${params.maxTurns}); stopping early`);
  } finally {
    unsubscribe();
    session.dispose();
  }
}

export function createDurableMemoryMaintenanceJob(
  options: DurableMemoryMaintenanceOptions = {},
): PostTurnMaintenanceJob {
  const now = options.now ?? (() => Date.now());
  const turnThrottle = Math.max(1, Math.floor(options.turnThrottle ?? DEFAULT_TURN_THROTTLE));
  const maxTurns = Math.max(1, Math.floor(options.maxTurns ?? DEFAULT_MAX_TURNS));
  const runExtractor = options.runExtractor ?? runDurableMemoryWorker;

  return {
    name: "durable-memory-extractor",
    run: async (context) => {
      const agentId = context.agentId ?? resolveAgentIdFromSessionKey(context.sessionKey);
      const storePath = resolveStorePath(context.config?.session?.store, { agentId });
      const sessionEntry = loadSessionStore(storePath)[context.sessionKey];
      if (!sessionEntry) {
        return;
      }

      const maintenanceState = readMaintenanceState(sessionEntry);
      const recentSlice = sliceMessagesSinceVisibleCursor(
        context.messagesSnapshot,
        maintenanceState.cursorVisibleMessageCount,
      );
      if (
        recentSlice.nextCursorVisibleMessageCount <=
          (maintenanceState.cursorVisibleMessageCount ?? 0) ||
        recentSlice.recentRawMessages.length === 0
      ) {
        return;
      }

      if (detectMainAgentMemoryWrite(recentSlice.recentRawMessages)) {
        await updateDurableMemoryState({
          storePath,
          sessionKey: context.sessionKey,
          mutate: (current) => ({
            ...current,
            cursorVisibleMessageCount: recentSlice.nextCursorVisibleMessageCount,
            eligibleTurns: 0,
            updatedAt: now(),
            lastSkipReason: "main_memory_write",
          }),
        });
        log.debug(
          `skipping durable memory extraction for ${context.sessionKey}: main agent already wrote memory`,
        );
        return;
      }

      const eligibleTurns = (maintenanceState.eligibleTurns ?? 0) + 1;
      if (eligibleTurns < turnThrottle) {
        await updateDurableMemoryState({
          storePath,
          sessionKey: context.sessionKey,
          mutate: (current) => ({
            ...current,
            eligibleTurns,
          }),
        });
        return;
      }

      const tempWorkspaceDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openclaw-durable-memory-maintenance-"),
      );
      try {
        await copyMemoryWorkspace({
          sourceWorkspaceDir: context.workspaceDir,
          targetWorkspaceDir: tempWorkspaceDir,
        });
        const before = await snapshotMemoryWorkspace(tempWorkspaceDir);
        const manifest = renderMemoryManifest(await buildMemoryManifest(context.workspaceDir));
        const recentConversation = renderRecentConversationSlice(recentSlice.recentRawMessages);
        const prompt = buildDurableMemoryExtractorPrompt({
          memoryManifest: manifest,
          recentConversation,
        });

        await runExtractor({
          workspaceDir: tempWorkspaceDir,
          agentDir: context.agentDir,
          config: context.config,
          provider: context.provider,
          model: context.model,
          authProfileId: context.authProfileId,
          systemPrompt: DURABLE_MEMORY_EXTRACTOR_SYSTEM_PROMPT,
          prompt,
          maxTurns,
        });

        const changedFiles = await syncChangedMemoryFiles({
          sourceWorkspaceDir: tempWorkspaceDir,
          targetWorkspaceDir: context.workspaceDir,
          before,
        });

        await updateDurableMemoryState({
          storePath,
          sessionKey: context.sessionKey,
          mutate: (current) => ({
            ...current,
            cursorVisibleMessageCount: recentSlice.nextCursorVisibleMessageCount,
            eligibleTurns: 0,
            updatedAt: now(),
            lastSkipReason: undefined,
          }),
        });

        if (changedFiles.length > 0) {
          log.info(
            `durable memory extractor updated ${changedFiles.length} file(s) for ${context.sessionKey}: ${changedFiles.join(", ")}`,
          );
        }
      } finally {
        await fs.rm(tempWorkspaceDir, { recursive: true, force: true });
      }
    },
  };
}
