import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MEMORY_TEXT_LENGTH = 500;
const MIN_MEMORY_TEXT_LENGTH = 10;
const MAX_REFERENCE_TOKEN_LENGTH = 120;
const RG_TIMEOUT_MS = 1500;
const WALK_MAX_FILE_BYTES = 256 * 1024;
const WALK_MAX_FILES = 1500;
const WALK_IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const WALK_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export const LEGACY_MEMORY_CATEGORIES = [
  "preference",
  "fact",
  "decision",
  "entity",
  "other",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type LegacyMemoryCategory = (typeof LEGACY_MEMORY_CATEGORIES)[number];
export type MemoryInputType = MemoryType | LegacyMemoryCategory;
export type MemorySourceRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type PreparedMemory = {
  text: string;
  type: MemoryType;
  importance: number;
  savedAt: number;
};

export type MemoryVerification = {
  status: "clear" | "conflict" | "verify";
  note?: string;
  matched: string[];
  missing: string[];
  needsReview: boolean;
};

export type RecallCandidate = {
  id: string;
  text: string;
  type?: string;
  category?: string;
  importance: number;
  savedAt?: number;
  createdAt?: number;
};

export type RecallView = {
  id: string;
  text: string;
  type: MemoryType;
  importance: number;
  savedAt?: number;
  summary: string;
  stale: boolean;
  stalenessNote?: string;
  verification: MemoryVerification;
};

type FeedbackKind = "correction" | "confirmation";
type ConcreteReference = {
  kind: "command" | "file" | "flag" | "symbol";
  value: string;
};

const ignoreMemoryPatterns = [
  /\bignore memory\b/i,
  /\bdon['’]t use memory\b/i,
  /\bdo not use memory\b/i,
];

const userPatterns = [
  /\bmy name is\b/i,
  /\bmy (?:email|phone|number)\b/i,
  /\bcall me\b/i,
  /\b(?:reach|text) me\b/i,
  /\bi (?:prefer|like|love|hate|dislike|want|need)\b/i,
  /\bthe user (?:prefers|likes|loves|hates|wants|needs)\b/i,
  /\bfor me\b/i,
  /\balways use\b/i,
  /\bnever use\b/i,
  /\bremember that I\b/i,
];

const projectPatterns = [
  /\bwe (?:use|ship|deploy|keep|track|store|treat)\b/i,
  /\bour (?:repo|repository|project|workflow|codebase|default|convention)\b/i,
  /\bthis (?:repo|repository|project|codebase)\b/i,
  /\bsource of truth\b/i,
  /\bconvention\b/i,
  /\bmust\b/i,
];

const referencePatterns = [
  /https?:\/\//i,
  /\b[A-Z]{2,10}-\d+\b/,
  /\b(?:docs?|runbook|dashboard|sheet|notion|ticket|issue)\b/i,
];

const correctionPatterns = [
  /\byou should\b/i,
  /\bplease don['’]t\b/i,
  /\bdo not\b/i,
  /\binstead\b/i,
  /\bthat['’]s wrong\b/i,
  /\bactually\b/i,
  /\bi said\b/i,
  /\bthe correct\b/i,
];

const confirmationPatterns = [
  /\bthat was the right call\b/i,
  /\bthat was the right move\b/i,
  /\bthat['’]s the correct approach\b/i,
  /\bgood call to\b/i,
  /\bgood idea to\b/i,
  /\bsmart to\b/i,
  /\bkeep doing that\b/i,
  /\bworked well because\b/i,
];

const genericPraisePatterns = [
  /^(?:thanks|thank you|great job|nice work|awesome|perfect|looks good|sounds good|well done)[!. ]*$/i,
  /^(?:great|nice|awesome|perfect)[!. ]*$/i,
];

const ephemeralTaskStatePatterns = [
  /\bcurrently\b/i,
  /\bright now\b/i,
  /\bthis (?:turn|conversation|request|task)\b/i,
  /\bnext step\b/i,
  /\btodo\b/i,
  /\bwork in progress\b/i,
  /\bblocked\b/i,
  /\bpending\b/i,
  /\bjust (?:fixed|changed|updated|finished)\b/i,
  /\blater today\b/i,
];

const derivableRepoFactPatterns = [
  /\b(?:src|extensions|docs|scripts|workspace)\/[^\s`]+/i,
  /\b[A-Za-z0-9_./-]+\.(?:cjs|css|html|js|json|jsx|md|mjs|py|sh|sql|ts|tsx|yaml|yml)\b/,
  /`[A-Za-z_][A-Za-z0-9_]*(?:\(\))?`/,
  /\B--[a-z0-9][a-z0-9-]*/i,
];

const feedbackSpecificityPatterns = [
  /\bbecause\b/i,
  /\bso that\b/i,
  /\bwhen\b/i,
  /\bin similar situations\b/i,
  /\bfor risky\b/i,
  /\bbefore\b/i,
];

const concreteFilePattern =
  /\b(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:cjs|css|html|js|json|jsx|md|mjs|py|sh|sql|ts|tsx|yaml|yml)\b/g;
const backtickPattern = /`([^`]+)`/g;
const flagPattern = /\B--[a-z0-9][a-z0-9-]*/gi;
const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\(\)/g;
const commandPattern = /\b(?:pnpm|npm|bun|yarn|openclaw|git)\s+[^\n`]+/gi;

const workspaceSearchCache = new Map<string, boolean>();
const workspaceFileCache = new Map<string, boolean>();

function normalizeInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function toDate(value?: Date | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  return new Date();
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function replaceWordBoundary(text: string, pattern: RegExp, replacement: string): string {
  return text.replace(pattern, replacement);
}

function resolveRelativeWeekday(
  direction: "last" | "next",
  weekdayName: string,
  now: Date,
): string {
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const targetDay = weekdays.indexOf(weekdayName.toLowerCase());
  if (targetDay < 0) {
    return `${direction} ${weekdayName}`;
  }
  const currentDay = now.getDay();
  let delta = targetDay - currentDay;
  if (direction === "next") {
    if (delta <= 0) {
      delta += 7;
    }
  } else if (delta >= 0) {
    delta -= 7;
  }
  return formatIsoDate(addDays(now, delta));
}

export function normalizeRelativeDates(text: string, nowInput?: Date | number): string {
  const now = toDate(nowInput);
  const today = formatIsoDate(now);
  const tomorrow = formatIsoDate(addDays(now, 1));
  const yesterday = formatIsoDate(addDays(now, -1));
  let normalized = text;
  normalized = replaceWordBoundary(normalized, /\btoday\b/gi, today);
  normalized = replaceWordBoundary(normalized, /\btomorrow\b/gi, tomorrow);
  normalized = replaceWordBoundary(normalized, /\byesterday\b/gi, yesterday);
  normalized = normalized.replace(
    /\b(next|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (_, direction: "last" | "next", weekday: string) =>
      resolveRelativeWeekday(direction, weekday, now),
  );
  return normalized;
}

function containsInjectedContext(text: string): boolean {
  return text.includes("<relevant-memories>");
}

function looksSystemGenerated(text: string): boolean {
  return text.startsWith("<") && text.includes("</");
}

function looksAgentSummary(text: string): boolean {
  return text.includes("**") && text.includes("\n-");
}

function emojiCount(text: string): number {
  return (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
}

function detectFeedbackKind(text: string): FeedbackKind | null {
  if (correctionPatterns.some((pattern) => pattern.test(text))) {
    return "correction";
  }
  if (
    confirmationPatterns.some((pattern) => pattern.test(text)) ||
    (feedbackSpecificityPatterns.some((pattern) => pattern.test(text)) &&
      /(?:right|correct|good|smart)/i.test(text))
  ) {
    return "confirmation";
  }
  return null;
}

function isGenericPraise(text: string): boolean {
  if (genericPraisePatterns.some((pattern) => pattern.test(text))) {
    return true;
  }
  return (
    /(thanks|thank you|great job|nice work|awesome|perfect|looks good|sounds good|well done)/i.test(
      text,
    ) && detectFeedbackKind(text) === null
  );
}

function isEphemeralTaskState(text: string): boolean {
  return ephemeralTaskStatePatterns.some((pattern) => pattern.test(text));
}

function hasPolicySignal(text: string): boolean {
  return (
    /\b(?:always|never|prefer|should|must|remember|avoid|keep doing|source of truth)\b/i.test(
      text,
    ) || detectFeedbackKind(text) !== null
  );
}

function isDerivableRepoFact(text: string): boolean {
  return derivableRepoFactPatterns.some((pattern) => pattern.test(text)) && !hasPolicySignal(text);
}

function normalizeStoredType(type: string | undefined, text: string): MemoryType {
  switch (type) {
    case "user":
    case "feedback":
    case "project":
    case "reference":
      return type;
    case "preference":
    case "entity":
      return "user";
    case "decision":
      return "project";
    case "fact":
      if (userPatterns.some((pattern) => pattern.test(text))) {
        return "user";
      }
      if (projectPatterns.some((pattern) => pattern.test(text))) {
        return "project";
      }
      return "reference";
    default:
      if (referencePatterns.some((pattern) => pattern.test(text))) {
        return "reference";
      }
      if (projectPatterns.some((pattern) => pattern.test(text))) {
        return "project";
      }
      return "reference";
  }
}

export function classifyMemoryType(
  textInput: string,
  sourceRole: MemorySourceRole = "user",
): MemoryType | null {
  const text = normalizeRelativeDates(normalizeInputText(textInput));
  if (isGenericPraise(text)) {
    return null;
  }
  if (detectFeedbackKind(text)) {
    return "feedback";
  }
  if (userPatterns.some((pattern) => pattern.test(text))) {
    return "user";
  }
  if (projectPatterns.some((pattern) => pattern.test(text))) {
    return "project";
  }
  if (referencePatterns.some((pattern) => pattern.test(text))) {
    return "reference";
  }
  if (sourceRole === "user" && /\bremember\b/i.test(text)) {
    return "user";
  }
  return null;
}

function ensureSentence(text: string): string {
  if (!text) {
    return text;
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstMeaningfulLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ?? text.trim();
}

function buildStructuredMemoryBody(
  type: MemoryType,
  normalizedText: string,
  feedbackKind: FeedbackKind | null,
): string {
  if (type !== "feedback" && type !== "project") {
    return normalizedText;
  }
  if (/\nWhy:\n/i.test(normalizedText) && /\nHow to apply:\n/i.test(normalizedText)) {
    return normalizedText;
  }

  const firstLine = ensureSentence(firstMeaningfulLine(normalizedText));
  const why =
    type === "feedback"
      ? feedbackKind === "confirmation"
        ? "User confirmation of a non-obvious choice that worked well and is worth repeating."
        : "User correction that should override older assumptions in similar situations."
      : "Durable project context that should persist beyond the current task or conversation.";
  const how =
    type === "feedback"
      ? feedbackKind === "confirmation"
        ? "Reuse this approach in similar situations and mention it as a known-good pattern."
        : "Apply this correction in future turns and prefer it over stale habits or prior guesses."
      : "Use this as an operating rule when planning, editing, or reviewing related work.";

  return [firstLine, "", "Why:", why, "", "How to apply:", how].join("\n");
}

function defaultImportance(type: MemoryType): number {
  switch (type) {
    case "feedback":
      return 0.85;
    case "project":
      return 0.8;
    case "user":
      return 0.75;
    case "reference":
      return 0.7;
  }
}

export function prepareMemoryForStorage(params: {
  text: string;
  explicitType?: MemoryInputType;
  importance?: number;
  now?: Date | number;
  sourceRole?: MemorySourceRole;
}): PreparedMemory | null {
  const sourceRole = params.sourceRole ?? "unknown";
  const raw = normalizeInputText(params.text);
  if (raw.length < MIN_MEMORY_TEXT_LENGTH || raw.length > MAX_MEMORY_TEXT_LENGTH) {
    return null;
  }
  if (containsInjectedContext(raw) || looksSystemGenerated(raw) || looksAgentSummary(raw)) {
    return null;
  }
  if (emojiCount(raw) > 3) {
    return null;
  }

  const normalizedText = normalizeRelativeDates(raw, params.now);
  if (isGenericPraise(normalizedText)) {
    return null;
  }
  if (isEphemeralTaskState(normalizedText)) {
    return null;
  }

  const explicitType = params.explicitType
    ? normalizeStoredType(params.explicitType, normalizedText)
    : undefined;
  const type = explicitType ?? classifyMemoryType(normalizedText, sourceRole);
  if (!type) {
    return null;
  }

  if (type !== "feedback" && sourceRole !== "user" && !explicitType) {
    return null;
  }
  if (type !== "feedback" && type !== "user" && isDerivableRepoFact(normalizedText)) {
    return null;
  }
  if (type === "reference" && !referencePatterns.some((pattern) => pattern.test(normalizedText))) {
    return null;
  }

  const feedbackKind = detectFeedbackKind(normalizedText);
  const text = buildStructuredMemoryBody(type, normalizedText, feedbackKind);
  const now = toDate(params.now);

  return {
    text,
    type,
    importance: params.importance ?? defaultImportance(type),
    savedAt: now.getTime(),
  };
}

type TextMessage = {
  role?: string;
  content?: unknown;
};

function extractMessageTexts(messages: readonly unknown[] | undefined): string[] {
  if (!messages) {
    return [];
  }
  const texts: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const msg = message as TextMessage;
    if (typeof msg.content === "string") {
      texts.push(msg.content);
      continue;
    }
    if (!Array.isArray(msg.content)) {
      continue;
    }
    for (const block of msg.content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block as Record<string, unknown>).type === "text" &&
        "text" in block &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        texts.push((block as Record<string, unknown>).text as string);
      }
    }
  }
  return texts;
}

export function shouldIgnoreMemory(params: {
  prompt?: string;
  messages?: readonly unknown[];
}): boolean {
  const recentMessages = extractMessageTexts(params.messages).slice(-6);
  const texts = [params.prompt ?? "", ...recentMessages];
  return texts.some((text) => ignoreMemoryPatterns.some((pattern) => pattern.test(text)));
}

function resolveSavedAt(candidate: RecallCandidate): number | undefined {
  if (typeof candidate.savedAt === "number" && Number.isFinite(candidate.savedAt)) {
    return candidate.savedAt;
  }
  if (typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)) {
    return candidate.createdAt;
  }
  return undefined;
}

function buildStalenessNote(savedAt: number | undefined, now = Date.now()): string | undefined {
  if (!savedAt || !Number.isFinite(savedAt)) {
    return "Saved date unknown; verify against current repo or state before relying on it.";
  }
  if (now - savedAt <= DAY_MS) {
    return undefined;
  }
  return "Historical memory; verify against current repo or state before relying on it.";
}

function summarizeMemory(text: string): string {
  return firstMeaningfulLine(normalizeInputText(text));
}

function pathContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseConcreteReference(token: string): ConcreteReference | null {
  const value = token.trim();
  if (!value || value.length > MAX_REFERENCE_TOKEN_LENGTH) {
    return null;
  }
  if (
    /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:cjs|css|html|js|json|jsx|md|mjs|py|sh|sql|ts|tsx|yaml|yml)$/i.test(
      value,
    )
  ) {
    return { kind: "file", value };
  }
  if (/^--[a-z0-9][a-z0-9-]*$/i.test(value)) {
    return { kind: "flag", value };
  }
  if (/^(?:pnpm|npm|bun|yarn|openclaw|git)\b/i.test(value)) {
    return { kind: "command", value };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(value)) {
    return { kind: "symbol", value: value.slice(0, -2) };
  }
  if (/^[A-Za-z_][A-Za-z0-9_./:-]*$/.test(value)) {
    return { kind: "symbol", value };
  }
  return null;
}

function extractConcreteReferences(text: string): ConcreteReference[] {
  const references = new Map<string, ConcreteReference>();
  const addReference = (reference: ConcreteReference | null) => {
    if (!reference) {
      return;
    }
    references.set(`${reference.kind}:${reference.value}`, reference);
  };

  for (const match of text.matchAll(backtickPattern)) {
    addReference(parseConcreteReference(match[1] ?? ""));
  }
  for (const match of text.matchAll(concreteFilePattern)) {
    addReference({ kind: "file", value: match[0] });
  }
  for (const match of text.matchAll(flagPattern)) {
    addReference({ kind: "flag", value: match[0] });
  }
  for (const match of text.matchAll(callPattern)) {
    addReference({ kind: "symbol", value: match[1] });
  }
  for (const match of text.matchAll(commandPattern)) {
    addReference({ kind: "command", value: match[0].trim() });
  }

  return Array.from(references.values());
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function searchWorkspaceWithRipgrep(
  token: string,
  workspaceDir: string,
): Promise<boolean | null> {
  try {
    await execFile(
      "rg",
      [
        "-l",
        "-m",
        "1",
        "--fixed-strings",
        "--hidden",
        "--glob",
        "!.git",
        "--glob",
        "!node_modules",
        "--",
        token,
        workspaceDir,
      ],
      {
        maxBuffer: 64 * 1024,
        timeout: RG_TIMEOUT_MS,
      },
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: number }).code;
    if (code === 1) {
      return false;
    }
    return null;
  }
}

async function walkWorkspace(
  workspaceDir: string,
  visitor: (pathname: string) => Promise<boolean>,
): Promise<boolean> {
  const queue = [workspaceDir];
  let visitedFiles = 0;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const pathname = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_IGNORED_DIRS.has(entry.name)) {
          queue.push(pathname);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      visitedFiles += 1;
      if (visitedFiles > WALK_MAX_FILES) {
        return false;
      }
      const stop = await visitor(pathname);
      if (stop) {
        return true;
      }
    }
  }
  return false;
}

async function searchWorkspaceSlow(token: string, workspaceDir: string): Promise<boolean> {
  return await walkWorkspace(workspaceDir, async (pathname) => {
    if (!WALK_TEXT_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
      return false;
    }
    const stat = await fs.stat(pathname).catch(() => null);
    if (!stat || stat.size > WALK_MAX_FILE_BYTES) {
      return false;
    }
    const content = await fs.readFile(pathname, "utf-8").catch(() => "");
    return content.includes(token);
  });
}

async function searchWorkspaceToken(token: string, workspaceDir: string): Promise<boolean> {
  const cacheKey = `${workspaceDir}\u0000${token}`;
  const cached = workspaceSearchCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const rgResult = await searchWorkspaceWithRipgrep(token, workspaceDir);
  const found = rgResult !== null ? rgResult : await searchWorkspaceSlow(token, workspaceDir);
  workspaceSearchCache.set(cacheKey, found);
  return found;
}

async function findWorkspaceFile(name: string, workspaceDir: string): Promise<boolean> {
  const cacheKey = `${workspaceDir}\u0000file:${name}`;
  const cached = workspaceFileCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const found = await walkWorkspace(
    workspaceDir,
    async (pathname) => path.basename(pathname) === name,
  );
  workspaceFileCache.set(cacheKey, found);
  return found;
}

async function verifyConcreteReference(
  reference: ConcreteReference,
  workspaceDir: string,
): Promise<boolean> {
  if (reference.kind === "file") {
    const resolved = path.resolve(workspaceDir, reference.value);
    if (pathContained(workspaceDir, resolved) && (await exists(resolved))) {
      return true;
    }
    return await findWorkspaceFile(path.basename(reference.value), workspaceDir);
  }
  return await searchWorkspaceToken(reference.value, workspaceDir);
}

export async function verifyMemoryAgainstWorkspace(params: {
  text: string;
  workspaceDir?: string;
}): Promise<MemoryVerification> {
  const references = extractConcreteReferences(params.text);
  if (references.length === 0) {
    return { status: "clear", matched: [], missing: [], needsReview: false };
  }
  if (!params.workspaceDir) {
    return {
      status: "verify",
      note: "Concrete repo references were not verified because no workspace was available.",
      matched: references.map((reference) => reference.value),
      missing: [],
      needsReview: false,
    };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const reference of references) {
    const found = await verifyConcreteReference(reference, params.workspaceDir);
    if (found) {
      matched.push(reference.value);
    } else {
      missing.push(reference.value);
    }
  }

  if (missing.length > 0) {
    return {
      status: "conflict",
      note: `Current workspace no longer matches this memory (${missing.join(", ")}).`,
      matched,
      missing,
      needsReview: true,
    };
  }

  return {
    status: "clear",
    note: "Concrete repo references verified in the current workspace.",
    matched,
    missing,
    needsReview: false,
  };
}

export async function buildRecallView(params: {
  candidate: RecallCandidate;
  workspaceDir?: string;
  now?: number;
}): Promise<RecallView> {
  const savedAt = resolveSavedAt(params.candidate);
  const verification = await verifyMemoryAgainstWorkspace({
    text: params.candidate.text,
    workspaceDir: params.workspaceDir,
  });
  return {
    id: params.candidate.id,
    text: params.candidate.text,
    type: normalizeStoredType(
      params.candidate.type ?? params.candidate.category,
      params.candidate.text,
    ),
    importance: params.candidate.importance,
    savedAt,
    summary: summarizeMemory(params.candidate.text),
    stale:
      Boolean(savedAt && params.now && params.now - savedAt > DAY_MS) ||
      Boolean(savedAt && !params.now && Date.now() - savedAt > DAY_MS),
    stalenessNote: buildStalenessNote(savedAt, params.now),
    verification,
  };
}

function savedAtText(savedAt: number | undefined): string {
  if (!savedAt || !Number.isFinite(savedAt)) {
    return "saved date unknown";
  }
  return `saved ${new Date(savedAt).toISOString().slice(0, 10)}`;
}

export function formatRecallLine(params: {
  view: RecallView;
  score: number;
  includeBody?: boolean;
}): string {
  const parts = [`[${params.view.type}] ${params.view.summary}`];
  parts.push(`score ${(params.score * 100).toFixed(0)}%`);
  parts.push(savedAtText(params.view.savedAt));
  if (params.view.stalenessNote) {
    parts.push(params.view.stalenessNote);
  }
  if (params.view.verification.note) {
    parts.push(params.view.verification.note);
  }
  const header = parts.join(" | ");
  if (!params.includeBody || params.view.text === params.view.summary) {
    return header;
  }
  return `${header}\n${params.view.text}`;
}
