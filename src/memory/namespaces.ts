import { normalizeRelPath } from "./internal.js";

export type MemoryNamespace = "task" | "global" | "legacy" | "other";

export const MEMORY_GLOBAL_DIR = "memory/global";
export const MEMORY_TASKS_DIR = "memory/tasks";

export function normalizeMemoryTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeTaskPathSegment(taskId: string): string {
  const trimmed = normalizeMemoryTaskId(taskId) ?? "";
  const flattened = trimmed.replace(/[\\/]+/g, "-").replace(/\.\.+/g, "-");
  const wildcardSafe = flattened.replace(/[%*?]/g, "-");
  const compacted = wildcardSafe.replace(/-+/g, "-").trim();
  return compacted || "default";
}

export function resolveTaskMemoryFilePath(taskId: string): string {
  return `${MEMORY_TASKS_DIR}/${sanitizeTaskPathSegment(taskId)}.md`;
}

export function resolveTaskMemoryDirPath(taskId: string): string {
  return `${MEMORY_TASKS_DIR}/${sanitizeTaskPathSegment(taskId)}`;
}

export function classifyMemoryPath(relPath: string): { namespace: MemoryNamespace; taskId?: string } {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return { namespace: "other" };
  if (normalized === "MEMORY.md" || normalized === "memory.md") {
    return { namespace: "global" };
  }
  if (normalized.startsWith(`${MEMORY_TASKS_DIR}/`)) {
    const rest = normalized.slice(MEMORY_TASKS_DIR.length + 1);
    if (!rest) return { namespace: "task" };
    const firstSegment = rest.split("/")[0]?.trim();
    if (!firstSegment) return { namespace: "task" };
    if (firstSegment.endsWith(".md")) {
      const taskId = firstSegment.slice(0, -3).trim();
      return taskId ? { namespace: "task", taskId } : { namespace: "task" };
    }
    return { namespace: "task", taskId: firstSegment };
  }
  if (normalized.startsWith(`${MEMORY_GLOBAL_DIR}/`)) {
    return { namespace: "global" };
  }
  if (normalized.startsWith("memory/")) {
    return { namespace: "legacy" };
  }
  return { namespace: "other" };
}
