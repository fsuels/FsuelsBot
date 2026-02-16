import type { RevenueAutopilotState } from "./types.js";
import {
  runRevenueDailyRoutine,
  runWeeklyCapitalReview,
  type RevenueDailyRoutineResult,
} from "./jobs.js";
import { readJsonFile, resolveRevenuePaths, writeJsonFile } from "./store.js";

const DEFAULT_REVENUE_AUTOPILOT_STATE: RevenueAutopilotState = {
  enabled: false,
  keepInbox: false,
};

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const asInt = Math.floor(value);
  return asInt > 0 ? asInt : undefined;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value > 0 ? Math.floor(value) : undefined;
}

function normalizeAutopilotState(raw: unknown): RevenueAutopilotState {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_REVENUE_AUTOPILOT_STATE };
  }
  const source = raw as Record<string, unknown>;
  return {
    enabled: parseBoolean(source.enabled, false),
    keepInbox: parseBoolean(source.keepInbox, false),
    demandLimit: positiveInt(source.demandLimit),
    outreachMaxDrafts: positiveInt(source.outreachMaxDrafts),
    deliveryLimit: positiveInt(source.deliveryLimit),
    lastDailyRunDate: parseString(source.lastDailyRunDate),
    lastDailyAttemptDate: parseString(source.lastDailyAttemptDate),
    lastWeeklyRunKey: parseString(source.lastWeeklyRunKey),
    lastWeeklyAttemptKey: parseString(source.lastWeeklyAttemptKey),
    lastRunAt: parseTimestamp(source.lastRunAt),
    lastError: parseString(source.lastError),
  };
}

function dateKey(now: number): string {
  const d = new Date(now);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoWeekKey(now: number): string {
  const local = new Date(now);
  const date = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isMonday(now: number): boolean {
  return new Date(now).getDay() === 1;
}

async function readState(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}): Promise<{ path: string; state: RevenueAutopilotState }> {
  const paths = resolveRevenuePaths(params);
  const raw = await readJsonFile<unknown>(paths.autopilotPath, {});
  return {
    path: paths.autopilotPath,
    state: normalizeAutopilotState(raw),
  };
}

async function saveState(path: string, state: RevenueAutopilotState): Promise<void> {
  await writeJsonFile(path, state);
}

export async function getRevenueAutopilotState(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}): Promise<RevenueAutopilotState> {
  const loaded = await readState(params);
  return loaded.state;
}

export async function configureRevenueAutopilot(params: {
  enabled?: boolean;
  demandLimit?: number;
  outreachMaxDrafts?: number;
  deliveryLimit?: number;
  keepInbox?: boolean;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}): Promise<RevenueAutopilotState> {
  const loaded = await readState(params);
  const next: RevenueAutopilotState = {
    ...loaded.state,
    enabled: typeof params.enabled === "boolean" ? params.enabled : loaded.state.enabled,
    keepInbox: typeof params.keepInbox === "boolean" ? params.keepInbox : loaded.state.keepInbox,
    demandLimit:
      typeof params.demandLimit === "number" && Number.isFinite(params.demandLimit)
        ? Math.max(1, Math.floor(params.demandLimit))
        : loaded.state.demandLimit,
    outreachMaxDrafts:
      typeof params.outreachMaxDrafts === "number" && Number.isFinite(params.outreachMaxDrafts)
        ? Math.max(1, Math.floor(params.outreachMaxDrafts))
        : loaded.state.outreachMaxDrafts,
    deliveryLimit:
      typeof params.deliveryLimit === "number" && Number.isFinite(params.deliveryLimit)
        ? Math.max(1, Math.floor(params.deliveryLimit))
        : loaded.state.deliveryLimit,
  };
  await saveState(loaded.path, next);
  return next;
}

export type RevenueAutopilotRunResult = {
  state: RevenueAutopilotState;
  ranDaily: boolean;
  ranWeekly: boolean;
  dailyResult?: RevenueDailyRoutineResult;
  weeklyResult?: Awaited<ReturnType<typeof runWeeklyCapitalReview>>;
  errors: string[];
};

let autopilotRunInFlight: Promise<RevenueAutopilotRunResult> | null = null;

export async function runRevenueAutopilotIfDue(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
  forceDaily?: boolean;
  forceWeekly?: boolean;
}): Promise<RevenueAutopilotRunResult> {
  if (autopilotRunInFlight) {
    return autopilotRunInFlight;
  }

  autopilotRunInFlight = (async () => {
    const now = params?.now ?? Date.now();
    const currentDay = dateKey(now);
    const currentWeek = isoWeekKey(now);
    const loaded = await readState(params);
    const state = { ...loaded.state };
    const errors: string[] = [];

    let ranDaily = false;
    let ranWeekly = false;
    let dailyResult: RevenueDailyRoutineResult | undefined;
    let weeklyResult: Awaited<ReturnType<typeof runWeeklyCapitalReview>> | undefined;

    const shouldRunDaily =
      params?.forceDaily === true || (state.enabled && state.lastDailyAttemptDate !== currentDay);
    const shouldRunWeekly =
      params?.forceWeekly === true ||
      (state.enabled && isMonday(now) && state.lastWeeklyAttemptKey !== currentWeek);

    if (shouldRunDaily) {
      state.lastDailyAttemptDate = currentDay;
      try {
        dailyResult = await runRevenueDailyRoutine({
          env: params?.env,
          stateDir: params?.stateDir,
          revenueRootDir: params?.revenueRootDir,
          now,
          demandLimit: state.demandLimit,
          outreachMaxDrafts: state.outreachMaxDrafts,
          deliveryLimit: state.deliveryLimit,
          keepInbox: state.keepInbox,
        });
        ranDaily = true;
        state.lastDailyRunDate = currentDay;
        state.lastRunAt = now;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errors.push(`daily: ${detail}`);
      }
    }

    if (shouldRunWeekly) {
      state.lastWeeklyAttemptKey = currentWeek;
      try {
        weeklyResult = await runWeeklyCapitalReview({
          env: params?.env,
          stateDir: params?.stateDir,
          revenueRootDir: params?.revenueRootDir,
          now,
        });
        ranWeekly = true;
        state.lastWeeklyRunKey = currentWeek;
        state.lastRunAt = now;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errors.push(`weekly: ${detail}`);
      }
    }

    state.lastError = errors.length > 0 ? errors.join(" | ") : undefined;
    await saveState(loaded.path, state);

    return {
      state,
      ranDaily,
      ranWeekly,
      dailyResult,
      weeklyResult,
      errors,
    };
  })();

  try {
    return await autopilotRunInFlight;
  } finally {
    autopilotRunInFlight = null;
  }
}
