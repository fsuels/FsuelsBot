import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveRevenueConfigPath, resolveRevenueRootDir } from "./config.js";

export type RevenuePaths = {
  rootDir: string;
  configPath: string;
  autopilotPath: string;
  opportunitiesPath: string;
  opportunityCandidatesPath: string;
  experimentsPath: string;
  ledgerPath: string;
  approvalQueuePath: string;
  ordersPath: string;
  allocationsPath: string;
  reportsDir: string;
  deliverablesDir: string;
};

export function resolveRevenuePaths(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}): RevenuePaths {
  const env = params?.env ?? process.env;
  const stateDir = params?.stateDir ?? resolveStateDir(env);
  const rootDir = params?.revenueRootDir
    ? path.resolve(params.revenueRootDir)
    : resolveRevenueRootDir(env, stateDir);
  const configPath =
    env.OPENCLAW_REVENUE_CONFIG?.trim().length && !params?.revenueRootDir
      ? resolveRevenueConfigPath(env, stateDir)
      : path.join(rootDir, "config.json");
  return {
    rootDir,
    configPath,
    autopilotPath: path.join(rootDir, "autopilot.json"),
    opportunitiesPath: path.join(rootDir, "opportunities.jsonl"),
    opportunityCandidatesPath: path.join(rootDir, "inbox", "opportunity-candidates.jsonl"),
    experimentsPath: path.join(rootDir, "experiments.json"),
    ledgerPath: path.join(rootDir, "ledger.jsonl"),
    approvalQueuePath: path.join(rootDir, "approval-queue.jsonl"),
    ordersPath: path.join(rootDir, "orders.json"),
    allocationsPath: path.join(rootDir, "allocations-weekly.jsonl"),
    reportsDir: path.join(rootDir, "reports"),
    deliverablesDir: path.join(rootDir, "deliverables"),
  };
}

export async function ensureRevenueDirs(paths: RevenuePaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.rootDir, { recursive: true }),
    fs.mkdir(path.dirname(paths.opportunityCandidatesPath), { recursive: true }),
    fs.mkdir(paths.reportsDir, { recursive: true }),
    fs.mkdir(paths.deliverablesDir, { recursive: true }),
  ]);
}

const appendLocks = new Map<string, Promise<void>>();

export async function appendJsonlLine<T>(filePath: string, row: T): Promise<void> {
  const resolved = path.resolve(filePath);
  const previous = appendLocks.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.appendFile(resolved, `${JSON.stringify(row)}\n`, "utf-8");
    });
  appendLocks.set(resolved, next);
  await next;
}

export async function appendJsonlLines<T>(filePath: string, rows: T[]): Promise<void> {
  for (const row of rows) {
    await appendJsonlLine(filePath, row);
  }
}

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(path.resolve(filePath), "utf-8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Ignore malformed rows.
    }
  }
  return out;
}

export async function resetJsonlFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.writeFile(path.resolve(filePath), "", "utf-8");
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  const raw = await fs.readFile(path.resolve(filePath), "utf-8").catch(() => "");
  if (!raw.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function writeMarkdownFile(filePath: string, value: string): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, value.endsWith("\n") ? value : `${value}\n`, "utf-8");
}

export function dateStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
