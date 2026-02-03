import fs from "node:fs/promises";
import path from "node:path";

import { isPathWithinRoot } from "./internal.js";
import {
  normalizeMemoryTaskId,
  resolveTaskMemoryDirPath,
  resolveTaskMemoryFilePath,
} from "./namespaces.js";
import { forgetMemoryPins } from "./pins.js";

export type ForgetMemoryResult = {
  removedLines: number;
  removedFiles: number;
  removedPins: number;
  scannedFiles: number;
};

function asNeedle(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function isMarkdown(pathname: string): boolean {
  return pathname.toLowerCase().endsWith(".md");
}

async function walkMarkdownFiles(dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isMarkdown(entry.name)) continue;
    out.push(full);
  }
}

async function removePathIfExists(absPath: string, rm: () => Promise<void>): Promise<number> {
  try {
    await fs.stat(absPath);
  } catch {
    return 0;
  }
  try {
    await rm();
    return 1;
  } catch {
    return 0;
  }
}

async function removeTaskMemory(workspaceDir: string, taskId: string): Promise<number> {
  const absTaskFile = path.join(workspaceDir, resolveTaskMemoryFilePath(taskId));
  const absTaskDir = path.join(workspaceDir, resolveTaskMemoryDirPath(taskId));
  if (!isPathWithinRoot(workspaceDir, absTaskFile)) return 0;
  if (!isPathWithinRoot(workspaceDir, absTaskDir)) return 0;
  let removed = 0;
  removed += await removePathIfExists(absTaskFile, async () => {
    await fs.rm(absTaskFile, { force: true });
  });
  removed += await removePathIfExists(absTaskDir, async () => {
    await fs.rm(absTaskDir, { recursive: true, force: true });
  });
  return removed;
}

function isOlderThan(relPath: string, before: number): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const m = normalized.match(/^memory\/(\d{4}-\d{2}-\d{2})(?:[^/]*)\.md$/);
  if (!m?.[1]) return false;
  const ts = Date.parse(`${m[1]}T00:00:00.000Z`);
  if (!Number.isFinite(ts)) return false;
  return ts < before;
}

export async function forgetMemoryWorkspace(params: {
  workspaceDir: string;
  text?: string;
  taskId?: string;
  entity?: string;
  before?: number;
  includePins?: boolean;
}): Promise<ForgetMemoryResult> {
  const textNeedle = asNeedle(params.text);
  const entityNeedle = asNeedle(params.entity);
  const taskId = normalizeMemoryTaskId(params.taskId);
  const before =
    typeof params.before === "number" && Number.isFinite(params.before) ? params.before : undefined;
  const files: string[] = [];
  await walkMarkdownFiles(path.join(params.workspaceDir, "memory"), files);
  const removeNeedles = [textNeedle, entityNeedle].filter(Boolean) as string[];

  let removedLines = 0;
  let removedFiles = 0;
  let scannedFiles = 0;

  if (taskId) {
    removedFiles += await removeTaskMemory(params.workspaceDir, taskId);
  }

  for (const absPath of files) {
    if (!isPathWithinRoot(params.workspaceDir, absPath)) continue;
    const relPath = path.relative(params.workspaceDir, absPath).replace(/\\/g, "/");
    if (taskId && relPath.startsWith(`memory/tasks/${taskId}/`)) continue;
    if (taskId && relPath === `memory/tasks/${taskId}.md`) continue;
    if (before != null && isOlderThan(relPath, before)) {
      try {
        await fs.rm(absPath, { force: true });
        removedFiles += 1;
      } catch {}
      continue;
    }
    if (!removeNeedles.length) continue;
    scannedFiles += 1;
    let content = "";
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const kept = lines.filter((line) => {
      const lowered = line.toLowerCase();
      return !removeNeedles.some((needle) => lowered.includes(needle));
    });
    if (kept.length === lines.length) continue;
    removedLines += lines.length - kept.length;
    await fs.writeFile(absPath, `${kept.join("\n")}\n`, "utf-8");
  }

  const removedPins = params.includePins
    ? await forgetMemoryPins({
        workspaceDir: params.workspaceDir,
        taskId,
        entity: entityNeedle,
        text: textNeedle,
        before,
      })
    : 0;

  return {
    removedLines,
    removedFiles,
    removedPins,
    scannedFiles,
  };
}
