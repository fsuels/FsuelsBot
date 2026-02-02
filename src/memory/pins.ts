import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SESSION_TASK_ID } from "../sessions/task-context.js";
import { ensureDir } from "./internal.js";
import { normalizeMemoryTaskId, resolveTaskMemoryDirPath } from "./namespaces.js";

export type MemoryPinType = "fact" | "preference" | "constraint" | "temporary";
export type MemoryPinScope = "global" | "task";

export type MemoryPinRecord = {
  id: string;
  type: MemoryPinType;
  scope: MemoryPinScope;
  text: string;
  taskId?: string;
  entity?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

type MemoryPinsStore = {
  version: 1;
  updatedAt: number;
  pins: MemoryPinRecord[];
};

const PINS_STORE_REL_PATH = "memory/.pins.json";
const GLOBAL_PINS_REL_PATH = "memory/global/pins.md";
const DEFAULT_TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEntity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = normalizeText(value);
  return trimmed || undefined;
}

function defaultStore(): MemoryPinsStore {
  return { version: 1, updatedAt: Date.now(), pins: [] };
}

function isPinExpired(pin: MemoryPinRecord, now = Date.now()): boolean {
  return typeof pin.expiresAt === "number" && pin.expiresAt <= now;
}

function pinSort(a: MemoryPinRecord, b: MemoryPinRecord): number {
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return b.updatedAt - a.updatedAt;
}

function resolveTaskPinPath(taskId: string): string {
  return `${resolveTaskMemoryDirPath(taskId)}/pins.md`;
}

async function readStore(workspaceDir: string): Promise<MemoryPinsStore> {
  const filePath = path.join(workspaceDir, PINS_STORE_REL_PATH);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as MemoryPinsStore;
    const pins = Array.isArray(parsed?.pins) ? parsed.pins : [];
    return {
      version: 1,
      updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      pins: pins
        .filter((pin) => pin && typeof pin === "object")
        .map((pin) => {
          const type = String(pin.type ?? "").trim().toLowerCase();
          const normalizedType: MemoryPinType =
            type === "fact" || type === "preference" || type === "constraint" || type === "temporary"
              ? type
              : "fact";
          const scope = pin.scope === "task" ? "task" : "global";
          const text = normalizeText(String(pin.text ?? ""));
          const taskId = normalizeMemoryTaskId(pin.taskId);
          const createdAt = Number.isFinite(pin.createdAt) ? Math.floor(pin.createdAt) : Date.now();
          const updatedAt = Number.isFinite(pin.updatedAt) ? Math.floor(pin.updatedAt) : createdAt;
          const expiresAt =
            typeof pin.expiresAt === "number" && Number.isFinite(pin.expiresAt)
              ? Math.floor(pin.expiresAt)
              : undefined;
          const entity = normalizeEntity(typeof pin.entity === "string" ? pin.entity : undefined);
          return {
            id: String(pin.id ?? randomUUID()),
            type: normalizedType,
            scope,
            text,
            taskId: scope === "task" ? taskId : undefined,
            entity,
            createdAt,
            updatedAt,
            expiresAt,
          } as MemoryPinRecord;
        })
        .filter((pin) => pin.text.length > 0),
    };
  } catch {
    return defaultStore();
  }
}

async function writeStore(workspaceDir: string, store: MemoryPinsStore): Promise<void> {
  const filePath = path.join(workspaceDir, PINS_STORE_REL_PATH);
  ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function buildPinsMarkdown(pins: MemoryPinRecord[]): string {
  const nowIso = new Date().toISOString();
  const lines: string[] = [
    "# Memory Pins",
    `> Generated at ${nowIso}. Edit with /pin or /forget commands.`,
    "",
  ];
  const sections: Array<{ type: MemoryPinType; title: string }> = [
    { type: "constraint", title: "Constraints (must inject)" },
    { type: "fact", title: "Facts (durable)" },
    { type: "preference", title: "Preferences (soft)" },
    { type: "temporary", title: "Temporary (auto-expire)" },
  ];
  for (const section of sections) {
    const sectionPins = pins.filter((pin) => pin.type === section.type).sort(pinSort);
    if (sectionPins.length === 0) continue;
    lines.push(`## ${section.title}`);
    for (const pin of sectionPins) {
      lines.push(`- [${pin.type}] ${pin.text}`);
      lines.push(`  - id: ${pin.id}`);
      lines.push(`  - updated: ${new Date(pin.updatedAt).toISOString()}`);
      if (pin.entity) lines.push(`  - entity: ${pin.entity}`);
      if (typeof pin.expiresAt === "number") {
        lines.push(`  - expires: ${new Date(pin.expiresAt).toISOString()}`);
      }
    }
    lines.push("");
  }
  if (!pins.length) {
    lines.push("_No active pins._");
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function writePinMarkdownFiles(workspaceDir: string, pins: MemoryPinRecord[]): Promise<void> {
  const globalPins = pins.filter((pin) => pin.scope === "global");
  const globalPath = path.join(workspaceDir, GLOBAL_PINS_REL_PATH);
  ensureDir(path.dirname(globalPath));
  await fs.writeFile(globalPath, buildPinsMarkdown(globalPins), "utf-8");

  const byTask = new Map<string, MemoryPinRecord[]>();
  for (const pin of pins) {
    if (pin.scope !== "task" || !pin.taskId) continue;
    const key = pin.taskId;
    const list = byTask.get(key) ?? [];
    list.push(pin);
    byTask.set(key, list);
  }

  for (const [taskId, taskPins] of byTask.entries()) {
    const relPath = resolveTaskPinPath(taskId);
    const absPath = path.join(workspaceDir, relPath);
    ensureDir(path.dirname(absPath));
    await fs.writeFile(absPath, buildPinsMarkdown(taskPins), "utf-8");
  }
}

function filterActivePins(pins: MemoryPinRecord[], now = Date.now()): MemoryPinRecord[] {
  return pins.filter((pin) => !isPinExpired(pin, now));
}

export async function listMemoryPins(params: {
  workspaceDir: string;
  scope?: MemoryPinScope | "all";
  taskId?: string;
  includeExpired?: boolean;
  now?: number;
}): Promise<MemoryPinRecord[]> {
  const store = await readStore(params.workspaceDir);
  const now = params.now ?? Date.now();
  const taskId = normalizeMemoryTaskId(params.taskId);
  const scope = params.scope ?? "all";
  return store.pins
    .filter((pin) => {
      if (!params.includeExpired && isPinExpired(pin, now)) return false;
      if (scope !== "all" && pin.scope !== scope) return false;
      if (taskId && pin.taskId !== taskId) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertMemoryPin(params: {
  workspaceDir: string;
  type: MemoryPinType;
  text: string;
  scope?: MemoryPinScope;
  taskId?: string;
  entity?: string;
  ttlMs?: number;
  now?: number;
}): Promise<MemoryPinRecord> {
  const store = await readStore(params.workspaceDir);
  const now = params.now ?? Date.now();
  const text = normalizeText(params.text);
  if (!text) throw new Error("pin text required");
  const scope = params.scope ?? "global";
  const taskId =
    scope === "task"
      ? normalizeMemoryTaskId(params.taskId) ?? DEFAULT_SESSION_TASK_ID
      : undefined;
  const entity = normalizeEntity(params.entity);
  const ttlMs =
    typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs) && params.ttlMs > 0
      ? Math.floor(params.ttlMs)
      : undefined;
  const expiresAt =
    params.type === "temporary" ? now + (ttlMs ?? DEFAULT_TEMPORARY_TTL_MS) : undefined;
  const existing = store.pins.find(
    (pin) =>
      pin.type === params.type &&
      pin.scope === scope &&
      (pin.taskId ?? "") === (taskId ?? "") &&
      pin.text.toLowerCase() === text.toLowerCase() &&
      !isPinExpired(pin, now),
  );
  if (existing) {
    existing.updatedAt = now;
    existing.entity = entity;
    existing.expiresAt = expiresAt;
    store.updatedAt = now;
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins, now));
    return existing;
  }
  const created: MemoryPinRecord = {
    id: `pin_${randomUUID()}`,
    type: params.type,
    scope,
    text,
    taskId,
    entity,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
  store.pins.push(created);
  store.updatedAt = now;
  await writeStore(params.workspaceDir, store);
  await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins, now));
  return created;
}

export async function removeMemoryPin(params: {
  workspaceDir: string;
  id: string;
  now?: number;
}): Promise<boolean> {
  const store = await readStore(params.workspaceDir);
  const before = store.pins.length;
  store.pins = store.pins.filter((pin) => pin.id !== params.id);
  if (store.pins.length === before) return false;
  store.updatedAt = params.now ?? Date.now();
  await writeStore(params.workspaceDir, store);
  await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins));
  return true;
}

export async function pruneExpiredMemoryPins(params: {
  workspaceDir: string;
  now?: number;
}): Promise<number> {
  const store = await readStore(params.workspaceDir);
  const now = params.now ?? Date.now();
  const before = store.pins.length;
  store.pins = filterActivePins(store.pins, now);
  const removed = before - store.pins.length;
  if (removed <= 0) return 0;
  store.updatedAt = now;
  await writeStore(params.workspaceDir, store);
  await writePinMarkdownFiles(params.workspaceDir, store.pins);
  return removed;
}

export async function forgetMemoryPins(params: {
  workspaceDir: string;
  taskId?: string;
  entity?: string;
  text?: string;
  before?: number;
  now?: number;
}): Promise<number> {
  const store = await readStore(params.workspaceDir);
  const taskId = normalizeMemoryTaskId(params.taskId);
  const entityNeedle = params.entity?.trim().toLowerCase();
  const textNeedle = params.text?.trim().toLowerCase();
  const before = typeof params.before === "number" && Number.isFinite(params.before) ? params.before : undefined;
  const beforeCount = store.pins.length;
  store.pins = store.pins.filter((pin) => {
    if (taskId && pin.taskId === taskId) return false;
    if (entityNeedle && pin.entity?.toLowerCase() === entityNeedle) return false;
    if (textNeedle && pin.text.toLowerCase().includes(textNeedle)) return false;
    if (before != null && pin.updatedAt < before) return false;
    return true;
  });
  const removed = beforeCount - store.pins.length;
  if (removed <= 0) return 0;
  store.updatedAt = params.now ?? Date.now();
  await writeStore(params.workspaceDir, store);
  await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins));
  return removed;
}

export async function listConstraintPinsForInjection(params: {
  workspaceDir: string;
  taskId?: string;
  now?: number;
}): Promise<MemoryPinRecord[]> {
  const now = params.now ?? Date.now();
  const taskId = normalizeMemoryTaskId(params.taskId);
  const pins = await listMemoryPins({
    workspaceDir: params.workspaceDir,
    scope: "all",
  });
  return pins
    .filter((pin) => {
      if (pin.type !== "constraint" || isPinExpired(pin, now)) return false;
      if (pin.scope === "global") return true;
      if (!taskId) return false;
      return pin.taskId === taskId;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
