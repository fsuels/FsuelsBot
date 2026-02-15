import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
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

export type MemoryPinRemoveIntent = {
  token: string;
  pinId: string;
  scope: MemoryPinScope;
  taskId?: string;
  createdAt: number;
  expiresAt: number;
};

type MemoryPinsStore = {
  version: 1;
  updatedAt: number;
  pins: MemoryPinRecord[];
  removeIntents?: MemoryPinRemoveIntent[];
};

const PINS_STORE_REL_PATH = "memory/.pins.json";
const GLOBAL_PINS_REL_PATH = "memory/global/pins.md";
const TASKS_ROOT_REL_PATH = "memory/tasks";
const DEFAULT_TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000;
const PINS_STORE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEntity(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = normalizeText(value);
  return trimmed || undefined;
}

function defaultStore(): MemoryPinsStore {
  return { version: 1, updatedAt: Date.now(), pins: [], removeIntents: [] };
}

function isPinExpired(pin: MemoryPinRecord, now = Date.now()): boolean {
  return typeof pin.expiresAt === "number" && pin.expiresAt <= now;
}

function pinSort(a: MemoryPinRecord, b: MemoryPinRecord): number {
  if (a.type !== b.type) {
    return a.type.localeCompare(b.type);
  }
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
          const type = String(pin.type ?? "")
            .trim()
            .toLowerCase();
          const normalizedType: MemoryPinType =
            type === "fact" ||
            type === "preference" ||
            type === "constraint" ||
            type === "temporary"
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
      removeIntents: Array.isArray(parsed?.removeIntents)
        ? parsed.removeIntents
            .filter((entry) => entry && typeof entry === "object")
            .map((entry): MemoryPinRemoveIntent | null => {
              const token = typeof entry.token === "string" ? entry.token.trim() : "";
              const pinId = typeof entry.pinId === "string" ? entry.pinId.trim() : "";
              const createdAt =
                typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
                  ? Math.floor(entry.createdAt)
                  : Date.now();
              const expiresAt =
                typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt)
                  ? Math.floor(entry.expiresAt)
                  : createdAt;
              const scope = entry.scope === "task" ? "task" : "global";
              const taskId = scope === "task" ? normalizeMemoryTaskId(entry.taskId) : undefined;
              if (!token || !pinId) {
                return null;
              }
              if (scope === "task") {
                return taskId ? { token, pinId, scope, taskId, createdAt, expiresAt } : null;
              }
              return { token, pinId, scope, createdAt, expiresAt };
            })
            .filter((entry): entry is MemoryPinRemoveIntent => entry !== null)
        : [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return defaultStore();
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`memory pins store read failed: ${detail}`, { cause: error });
  }
}

async function writeStore(workspaceDir: string, store: MemoryPinsStore): Promise<void> {
  const filePath = path.join(workspaceDir, PINS_STORE_REL_PATH);
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = path.join(dir, `${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  try {
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureStoreFile(workspaceDir: string): Promise<void> {
  const filePath = path.join(workspaceDir, PINS_STORE_REL_PATH);
  ensureDir(path.dirname(filePath));
  try {
    await fs.access(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    try {
      await fs.writeFile(filePath, `${JSON.stringify(defaultStore(), null, 2)}\n`, {
        encoding: "utf-8",
        flag: "wx",
      });
    } catch (writeError) {
      const writeCode = (writeError as NodeJS.ErrnoException).code;
      if (writeCode !== "EEXIST") {
        throw writeError;
      }
    }
  }
}

async function withPinsStoreLock<T>(workspaceDir: string, fn: () => Promise<T>): Promise<T> {
  const filePath = path.join(workspaceDir, PINS_STORE_REL_PATH);
  await ensureStoreFile(workspaceDir);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, PINS_STORE_LOCK_OPTIONS);
    return await fn();
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // ignore unlock failures
      }
    }
  }
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
    const sectionPins = pins.filter((pin) => pin.type === section.type).toSorted(pinSort);
    if (sectionPins.length === 0) {
      continue;
    }
    lines.push(`## ${section.title}`);
    for (const pin of sectionPins) {
      lines.push(`- [${pin.type}] ${pin.text}`);
      lines.push(`  - id: ${pin.id}`);
      lines.push(`  - updated: ${new Date(pin.updatedAt).toISOString()}`);
      if (pin.entity) {
        lines.push(`  - entity: ${pin.entity}`);
      }
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
    if (pin.scope !== "task" || !pin.taskId) {
      continue;
    }
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

  const tasksRoot = path.join(workspaceDir, TASKS_ROOT_REL_PATH);
  let taskEntries: Dirent[] = [];
  try {
    taskEntries = await fs.readdir(tasksRoot, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of taskEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskId = normalizeMemoryTaskId(entry.name);
    if (!taskId || byTask.has(taskId)) {
      continue;
    }
    const stalePinPath = path.join(tasksRoot, entry.name, "pins.md");
    try {
      await fs.rm(stalePinPath, { force: true });
    } catch {}
  }
}

function filterActivePins(pins: MemoryPinRecord[], now = Date.now()): MemoryPinRecord[] {
  return pins.filter((pin) => !isPinExpired(pin, now));
}

function filterActiveRemoveIntents(
  intents: MemoryPinRemoveIntent[],
  now = Date.now(),
): MemoryPinRemoveIntent[] {
  return intents.filter((intent) => intent.expiresAt > now);
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
      if (!params.includeExpired && isPinExpired(pin, now)) {
        return false;
      }
      if (scope !== "all" && pin.scope !== scope) {
        return false;
      }
      if (taskId && pin.taskId !== taskId) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
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
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const text = normalizeText(params.text);
    if (!text) {
      throw new Error("pin text required");
    }
    const scope = params.scope ?? "global";
    const taskId =
      scope === "task"
        ? (normalizeMemoryTaskId(params.taskId) ?? DEFAULT_SESSION_TASK_ID)
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
      // Pins are immutable by default; duplicate inserts are idempotent.
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
  });
}

export async function editMemoryPin(params: {
  workspaceDir: string;
  id: string;
  text: string;
  entity?: string;
  ttlMs?: number;
  now?: number;
}): Promise<MemoryPinRecord | null> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const text = normalizeText(params.text);
    if (!text) {
      throw new Error("pin text required");
    }
    const index = store.pins.findIndex((pin) => pin.id === params.id);
    if (index < 0) {
      return null;
    }
    const current = store.pins[index];
    const ttlMs =
      typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs) && params.ttlMs > 0
        ? Math.floor(params.ttlMs)
        : undefined;
    const expiresAt =
      current.type === "temporary" ? now + (ttlMs ?? DEFAULT_TEMPORARY_TTL_MS) : undefined;
    const next: MemoryPinRecord = {
      ...current,
      text,
      entity: normalizeEntity(params.entity) ?? current.entity,
      updatedAt: now,
      expiresAt,
    };
    store.pins[index] = next;
    store.updatedAt = now;
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins, now));
    return next;
  });
}

export async function removeMemoryPin(params: {
  workspaceDir: string;
  id: string;
  now?: number;
}): Promise<boolean> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const before = store.pins.length;
    store.pins = store.pins.filter((pin) => pin.id !== params.id);
    if (store.pins.length === before) {
      return false;
    }
    store.updatedAt = params.now ?? Date.now();
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins));
    return true;
  });
}

export async function createMemoryPinRemoveIntent(params: {
  workspaceDir: string;
  id: string;
  ttlMs?: number;
  now?: number;
}): Promise<{
  token: string;
  pinId: string;
  scope: MemoryPinScope;
  taskId?: string;
  expiresAt: number;
} | null> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const pin = store.pins.find((entry) => entry.id === params.id);
    if (!pin) {
      return null;
    }
    const ttlMs =
      typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs) && params.ttlMs > 0
        ? Math.floor(params.ttlMs)
        : 3 * 60 * 1000;
    const intents = filterActiveRemoveIntents(store.removeIntents ?? [], now);
    const existing = intents.find((intent) => intent.pinId === pin.id);
    if (existing) {
      store.removeIntents = intents;
      store.updatedAt = now;
      await writeStore(params.workspaceDir, store);
      return {
        token: existing.token,
        pinId: existing.pinId,
        scope: existing.scope,
        taskId: existing.taskId,
        expiresAt: existing.expiresAt,
      };
    }
    const created: MemoryPinRemoveIntent = {
      token: `pdel_${randomUUID().slice(0, 12)}`,
      pinId: pin.id,
      scope: pin.scope,
      taskId: pin.taskId,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    store.removeIntents = [...intents, created];
    store.updatedAt = now;
    await writeStore(params.workspaceDir, store);
    return {
      token: created.token,
      pinId: created.pinId,
      scope: created.scope,
      taskId: created.taskId,
      expiresAt: created.expiresAt,
    };
  });
}

/**
 * Validate a pin removal intent WITHOUT mutating the store. Returns the intent
 * and the target pin record so the caller can commit durable events (WAL) before
 * performing the actual removal via {@link executePinRemoval}.
 */
export async function validatePinRemoveIntent(params: {
  workspaceDir: string;
  token: string;
  now?: number;
}): Promise<{
  valid: boolean;
  pinId?: string;
  scope?: MemoryPinScope;
  taskId?: string;
  expired?: boolean;
  pin?: MemoryPinRecord;
  intentToken?: string;
}> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const token = params.token.trim();
    if (!token) {
      return { valid: false };
    }
    const intents = store.removeIntents ?? [];
    const index = intents.findIndex((intent) => intent.token === token);
    if (index < 0) {
      return { valid: false };
    }
    const intent = intents[index]!;
    if (intent.expiresAt <= now) {
      // Clean up expired intent without removing the pin.
      const nextIntents = intents.filter((entry) => entry.token !== token);
      store.removeIntents = nextIntents;
      store.updatedAt = now;
      await writeStore(params.workspaceDir, store);
      return {
        valid: false,
        expired: true,
        pinId: intent.pinId,
        scope: intent.scope,
        taskId: intent.taskId,
      };
    }
    const pin = store.pins.find((p) => p.id === intent.pinId);
    return {
      valid: !!pin,
      pinId: intent.pinId,
      scope: intent.scope,
      taskId: intent.taskId,
      pin: pin ? { ...pin } : undefined,
      intentToken: token,
    };
  });
}

/**
 * Execute the actual pin removal after a durable WAL commit has succeeded.
 * Removes the pin from the store, clears the intent, writes to disk, and
 * re-renders markdown views.
 */
export async function executePinRemoval(params: {
  workspaceDir: string;
  token: string;
  now?: number;
}): Promise<{ removed: boolean }> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const token = params.token.trim();
    if (!token) {
      return { removed: false };
    }
    const intents = store.removeIntents ?? [];
    const intent = intents.find((entry) => entry.token === token);
    if (!intent) {
      return { removed: false };
    }
    const before = store.pins.length;
    store.pins = store.pins.filter((pin) => pin.id !== intent.pinId);
    const removed = store.pins.length < before;
    store.removeIntents = intents.filter((entry) => entry.token !== token);
    store.updatedAt = now;
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins, now));
    return { removed };
  });
}

/**
 * Convenience wrapper that validates and immediately executes pin removal.
 * Preserves backward compatibility for callers that don't need WAL-first
 * semantics. New command handlers should use {@link validatePinRemoveIntent}
 * + WAL commit + {@link executePinRemoval} instead.
 */
export async function confirmMemoryPinRemoveIntent(params: {
  workspaceDir: string;
  token: string;
  now?: number;
}): Promise<{
  removed: boolean;
  pinId?: string;
  scope?: MemoryPinScope;
  taskId?: string;
  expired?: boolean;
}> {
  const validation = await validatePinRemoveIntent(params);
  if (!validation.valid) {
    return {
      removed: false,
      pinId: validation.pinId,
      scope: validation.scope,
      taskId: validation.taskId,
      expired: validation.expired,
    };
  }
  const execution = await executePinRemoval({
    workspaceDir: params.workspaceDir,
    token: params.token,
    now: params.now,
  });
  return {
    removed: execution.removed,
    pinId: validation.pinId,
    scope: validation.scope,
    taskId: validation.taskId,
  };
}

export async function cancelMemoryPinRemoveIntent(params: {
  workspaceDir: string;
  token: string;
  now?: number;
}): Promise<boolean> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const token = params.token.trim();
    if (!token) {
      return false;
    }
    const store = await readStore(params.workspaceDir);
    const before = (store.removeIntents ?? []).length;
    store.removeIntents = (store.removeIntents ?? []).filter((intent) => intent.token !== token);
    if ((store.removeIntents ?? []).length === before) {
      return false;
    }
    store.updatedAt = params.now ?? Date.now();
    await writeStore(params.workspaceDir, store);
    return true;
  });
}

export async function pruneExpiredMemoryPins(params: {
  workspaceDir: string;
  now?: number;
}): Promise<number> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const now = params.now ?? Date.now();
    const before = store.pins.length;
    store.pins = filterActivePins(store.pins, now);
    const removed = before - store.pins.length;
    if (removed <= 0) {
      return 0;
    }
    store.updatedAt = now;
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, store.pins);
    return removed;
  });
}

export async function forgetMemoryPins(params: {
  workspaceDir: string;
  taskId?: string;
  entity?: string;
  text?: string;
  before?: number;
  now?: number;
}): Promise<number> {
  return withPinsStoreLock(params.workspaceDir, async () => {
    const store = await readStore(params.workspaceDir);
    const taskId = normalizeMemoryTaskId(params.taskId);
    const entityNeedle = params.entity?.trim().toLowerCase();
    const textNeedle = params.text?.trim().toLowerCase();
    const before =
      typeof params.before === "number" && Number.isFinite(params.before)
        ? params.before
        : undefined;
    const beforeCount = store.pins.length;
    store.pins = store.pins.filter((pin) => {
      if (taskId && pin.taskId === taskId) {
        return false;
      }
      if (entityNeedle && pin.entity?.toLowerCase() === entityNeedle) {
        return false;
      }
      if (textNeedle && pin.text.toLowerCase().includes(textNeedle)) {
        return false;
      }
      if (before != null && pin.updatedAt < before) {
        return false;
      }
      return true;
    });
    const removed = beforeCount - store.pins.length;
    if (removed <= 0) {
      return 0;
    }
    store.updatedAt = params.now ?? Date.now();
    await writeStore(params.workspaceDir, store);
    await writePinMarkdownFiles(params.workspaceDir, filterActivePins(store.pins));
    return removed;
  });
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
      if (pin.type !== "constraint" || isPinExpired(pin, now)) {
        return false;
      }
      if (pin.scope === "global") {
        return true;
      }
      if (!taskId) {
        return false;
      }
      return pin.taskId === taskId;
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
}
