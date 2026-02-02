import fs from "node:fs/promises";
import path from "node:path";

import { ensureDir } from "./internal.js";
import { normalizeMemoryTaskId, resolveTaskMemoryFilePath } from "./namespaces.js";

export type TaskMemorySnapshot = {
  goal?: string;
  currentState?: string;
  decisions: string[];
  openQuestions: string[];
  nextActions: string[];
  keyEntities: string[];
  pinned: string[];
  notes: string[];
};

export type TaskMemoryMergeResult = {
  applied: boolean;
  changed: boolean;
  relPath?: string;
  reason?: string;
};

const EMPTY_SNAPSHOT: TaskMemorySnapshot = {
  decisions: [],
  openQuestions: [],
  nextActions: [],
  keyEntities: [],
  pinned: [],
  notes: [],
};

type SnapshotParseState = {
  snapshot: TaskMemorySnapshot;
  hasKnownSection: boolean;
  hasNonEmptyContent: boolean;
};

const KNOWN_SECTIONS: Record<string, keyof TaskMemorySnapshot> = {
  goal: "goal",
  currentstate: "currentState",
  currentstatus: "currentState",
  state: "currentState",
  decisions: "decisions",
  decision: "decisions",
  openquestions: "openQuestions",
  questions: "openQuestions",
  openitems: "openQuestions",
  nextactions: "nextActions",
  actions: "nextActions",
  todo: "nextActions",
  todos: "nextActions",
  keyentities: "keyEntities",
  entities: "keyEntities",
  pinned: "pinned",
  pins: "pinned",
  notes: "notes",
};

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeHeading = (value: string): string => value.replace(/[^a-z0-9]+/gi, "").toLowerCase();

function normalizeListLine(line: string): string {
  const stripped = line
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
  return stripped;
}

function dedupe(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function parseSectionHeading(line: string): keyof TaskMemorySnapshot | null {
  const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
  if (!headingMatch) return null;
  const key = normalizeHeading(headingMatch[1] ?? "");
  return KNOWN_SECTIONS[key] ?? null;
}

function parseInlineSectionLine(
  line: string,
): { section: keyof TaskMemorySnapshot; value: string } | null {
  const match = line.match(/^\s*([A-Za-z ]+)\s*:\s*(.+)\s*$/);
  if (!match) return null;
  const section = KNOWN_SECTIONS[normalizeHeading(match[1] ?? "")];
  if (!section) return null;
  return {
    section,
    value: match[2] ?? "",
  };
}

function appendSectionLine(
  snapshot: TaskMemorySnapshot,
  section: keyof TaskMemorySnapshot,
  line: string,
): void {
  const cleaned = normalizeListLine(line);
  if (!cleaned) return;
  if (section === "goal" || section === "currentState") {
    const current = snapshot[section];
    const next = current ? `${current}\n${cleaned}` : cleaned;
    snapshot[section] = next;
    return;
  }
  snapshot[section].push(cleaned);
}

function finalizeSnapshot(snapshot: TaskMemorySnapshot): TaskMemorySnapshot {
  const next: TaskMemorySnapshot = {
    goal: snapshot.goal ? normalizeText(snapshot.goal) : undefined,
    currentState: snapshot.currentState ? normalizeText(snapshot.currentState) : undefined,
    decisions: dedupe(snapshot.decisions),
    openQuestions: dedupe(snapshot.openQuestions),
    nextActions: dedupe(snapshot.nextActions),
    keyEntities: dedupe(snapshot.keyEntities),
    pinned: dedupe(snapshot.pinned),
    notes: dedupe(snapshot.notes),
  };
  if (!next.goal) delete next.goal;
  if (!next.currentState) delete next.currentState;
  return next;
}

export function parseTaskMemorySnapshot(markdown: string): TaskMemorySnapshot | null {
  const lines = markdown.split(/\r?\n/);
  const snapshot: TaskMemorySnapshot = {
    goal: undefined,
    currentState: undefined,
    decisions: [],
    openQuestions: [],
    nextActions: [],
    keyEntities: [],
    pinned: [],
    notes: [],
  };

  let section: keyof TaskMemorySnapshot | null = null;
  let hasKnownSection = false;
  let hasNonEmptyContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    hasNonEmptyContent = true;
    if (/^\s*#\s+task memory\s*$/i.test(line)) continue;
    if (!section && /^\s*-\s*taskid\s*:/i.test(line)) continue;
    const heading = parseSectionHeading(line);
    if (heading) {
      section = heading;
      hasKnownSection = true;
      continue;
    }
    const inline = parseInlineSectionLine(line);
    if (inline) {
      appendSectionLine(snapshot, inline.section, inline.value);
      hasKnownSection = true;
      continue;
    }
    if (!section) {
      snapshot.notes.push(normalizeListLine(line));
      continue;
    }
    appendSectionLine(snapshot, section, line);
  }

  if (!hasNonEmptyContent) return { ...EMPTY_SNAPSHOT };
  if (!hasKnownSection) return null;
  return finalizeSnapshot(snapshot);
}

function parseResolvedMarkers(items: string[]): { open: string[]; resolved: Set<string> } {
  const open: string[] = [];
  const resolved = new Set<string>();
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    if (/^resolved\s*:/i.test(normalized)) {
      const marker = normalizeText(normalized.replace(/^resolved\s*:/i, ""));
      if (marker) resolved.add(marker.toLowerCase());
      continue;
    }
    open.push(normalized);
  }
  return { open, resolved };
}

function parsePinMarkers(items: string[]): { pins: string[]; unpins: Set<string> } {
  const pins: string[] = [];
  const unpins = new Set<string>();
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    if (/^unpin\s*:/i.test(normalized) || /^remove\s*:/i.test(normalized)) {
      const marker = normalizeText(normalized.replace(/^(unpin|remove)\s*:/i, ""));
      if (marker) unpins.add(marker.toLowerCase());
      continue;
    }
    pins.push(normalized.replace(/^pin\s*:/i, "").trim());
  }
  return { pins: dedupe(pins), unpins };
}

function entityKey(entity: string): string {
  const cleaned = normalizeText(entity);
  const colon = cleaned.indexOf(":");
  if (colon > 0) return normalizeKey(cleaned.slice(0, colon));
  const dash = cleaned.indexOf(" - ");
  if (dash > 0) return normalizeKey(cleaned.slice(0, dash));
  return normalizeKey(cleaned);
}

function mergeEntities(existing: string[], incoming: string[]): string[] {
  const out: string[] = [];
  const indexByKey = new Map<string, number>();
  for (const entity of dedupe(existing)) {
    const key = entityKey(entity);
    if (!key) continue;
    indexByKey.set(key, out.length);
    out.push(entity);
  }
  for (const entity of dedupe(incoming)) {
    const key = entityKey(entity);
    if (!key) continue;
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      indexByKey.set(key, out.length);
      out.push(entity);
      continue;
    }
    out[existingIndex] = entity;
  }
  return out;
}

export function mergeTaskMemorySnapshots(params: {
  existing: TaskMemorySnapshot;
  incoming: TaskMemorySnapshot;
}): TaskMemorySnapshot {
  const existing = params.existing;
  const incoming = params.incoming;

  const incomingGoal = incoming.goal ? normalizeText(incoming.goal) : undefined;
  const incomingCurrentState = incoming.currentState ? normalizeText(incoming.currentState) : undefined;

  const resolvedQuestions = parseResolvedMarkers(incoming.openQuestions);
  const nextOpenQuestions = dedupe([
    ...existing.openQuestions.filter(
      (item) => !resolvedQuestions.resolved.has(normalizeText(item).toLowerCase()),
    ),
    ...resolvedQuestions.open,
  ]);

  const pinMarkers = parsePinMarkers(incoming.pinned);
  const mergedPinned = dedupe([
    ...existing.pinned.filter((item) => !pinMarkers.unpins.has(normalizeText(item).toLowerCase())),
    ...pinMarkers.pins,
  ]);

  return finalizeSnapshot({
    goal: incomingGoal || existing.goal,
    currentState: incomingCurrentState || existing.currentState,
    decisions: dedupe([...existing.decisions, ...incoming.decisions]),
    openQuestions: nextOpenQuestions,
    nextActions: incoming.nextActions.length > 0 ? dedupe(incoming.nextActions) : existing.nextActions,
    keyEntities: mergeEntities(existing.keyEntities, incoming.keyEntities),
    pinned: mergedPinned,
    notes: dedupe([...existing.notes, ...incoming.notes]),
  });
}

function renderSection(title: string, lines: string[]): string[] {
  const out = [`## ${title}`];
  if (lines.length === 0) {
    out.push("_None._", "");
    return out;
  }
  for (const line of lines) {
    out.push(`- ${line}`);
  }
  out.push("");
  return out;
}

export function renderTaskMemorySnapshot(params: {
  taskId: string;
  snapshot: TaskMemorySnapshot;
}): string {
  const taskId = normalizeMemoryTaskId(params.taskId) ?? params.taskId;
  const snapshot = finalizeSnapshot(params.snapshot);
  const lines: string[] = [
    "# Task Memory",
    "",
    `- taskId: ${taskId}`,
    "",
    "## Goal",
    snapshot.goal ?? "_None._",
    "",
    "## Current State",
    snapshot.currentState ?? "_None._",
    "",
    ...renderSection("Decisions", snapshot.decisions),
    ...renderSection("Open Questions", snapshot.openQuestions),
    ...renderSection("Next Actions", snapshot.nextActions),
    ...renderSection("Key Entities", snapshot.keyEntities),
    ...renderSection("Pinned", snapshot.pinned),
  ];
  if (snapshot.notes.length > 0) {
    lines.push(...renderSection("Notes", snapshot.notes));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function snapshotFromMarkdown(markdown: string): SnapshotParseState {
  const parsed = parseTaskMemorySnapshot(markdown);
  if (!parsed) {
    const hasNonEmptyContent = markdown.trim().length > 0;
    return {
      snapshot: { ...EMPTY_SNAPSHOT, notes: hasNonEmptyContent ? [normalizeText(markdown)] : [] },
      hasKnownSection: false,
      hasNonEmptyContent,
    };
  }
  const hasKnownSection =
    Boolean(parsed.goal) ||
    Boolean(parsed.currentState) ||
    parsed.decisions.length > 0 ||
    parsed.openQuestions.length > 0 ||
    parsed.nextActions.length > 0 ||
    parsed.keyEntities.length > 0 ||
    parsed.pinned.length > 0 ||
    parsed.notes.length > 0;
  return {
    snapshot: parsed,
    hasKnownSection,
    hasNonEmptyContent: markdown.trim().length > 0,
  };
}

export async function mergeTaskMemoryFile(params: {
  workspaceDir: string;
  taskId?: string;
  existingMarkdown?: string;
}): Promise<TaskMemoryMergeResult> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) return { applied: false, changed: false, reason: "missing-task-id" };
  const relPath = resolveTaskMemoryFilePath(taskId);
  const absPath = path.join(params.workspaceDir, relPath);

  let rawAfterFlush = "";
  try {
    rawAfterFlush = await fs.readFile(absPath, "utf-8");
  } catch {
    return { applied: false, changed: false, reason: "file-missing", relPath };
  }

  const afterParse = snapshotFromMarkdown(rawAfterFlush);
  if (!afterParse.hasKnownSection && afterParse.hasNonEmptyContent) {
    return { applied: false, changed: false, reason: "unstructured-content", relPath };
  }

  const existingParse = snapshotFromMarkdown(params.existingMarkdown ?? "");
  const merged = mergeTaskMemorySnapshots({
    existing: existingParse.snapshot,
    incoming: afterParse.snapshot,
  });
  const rendered = renderTaskMemorySnapshot({ taskId, snapshot: merged });
  if (rendered.trim() === rawAfterFlush.trim()) {
    return { applied: true, changed: false, relPath };
  }

  ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, rendered, "utf-8");
  return { applied: true, changed: true, relPath };
}
