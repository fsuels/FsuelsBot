import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  RevenueCapitalLimits,
  RevenueConfig,
  RevenueDecisionThresholds,
  RevenueOpsConfig,
  RevenueScoringWeights,
  RevenueServiceSku,
  RevenueTimeToCashBand,
} from "./types.js";
import { resolveStateDir } from "../config/paths.js";

export const DEFAULT_REVENUE_CONFIG: RevenueConfig = {
  version: 1,
  weights: {
    demand: 0.18,
    pricingPower: 0.14,
    competitionInverse: 0.1,
    regRiskInverse: 0.07,
    speedToValidation: 0.08,
    marginPotential: 0.12,
    deliveryEffortInverse: 0.09,
    channelFrictionInverse: 0.05,
    refundSupportRiskInverse: 0.05,
    timeToCashScore: 0.12,
  },
  timeToCashBands: [
    { maxDays: 7, score: 100 },
    { maxDays: 14, score: 85 },
    { maxDays: 21, score: 70 },
    { maxDays: 30, score: 50 },
    { maxDays: 60, score: 30 },
    { maxDays: Number.MAX_SAFE_INTEGER, score: 10 },
  ],
  thresholds: {
    goMin: 72,
    watchMin: 58,
    minDemandForGo: 60,
    minMarginForGo: 60,
    maxTimeToFirstDollarDays: 21,
    maxPaybackDays: 30,
    highUpfrontCostFraction: 0.25,
    highUpfrontPaybackDays: 14,
    minDemandConfirmationsForHighUpfront: 2,
    researchTimeoutPasses: 3,
    researchTimeoutMinutes: 120,
  },
  capitalLimits: {
    startingCapitalUsd: 1000,
    liquidityBufferUsd: 700,
    maxCashBurnPerExperimentUsd: 250,
    maxWeeklyCashBurnUsd: 250,
    maxWeeklyHours: 20,
    maxConcurrentExperiments: 3,
    maxProjectShare: 0.4,
    postSignalTopShare: 0.7,
    postSignalMaxProjects: 2,
    postSignalMinSignalScore: 70,
  },
  ops: {
    maxOutboundDraftsPerDay: 10,
    maxApprovalMinutesPerDay: 20,
    autoApproveRisk: "low",
    autoRejectMissingFields: true,
    minOpportunitiesScoredPerDay: 5,
    minKillRate14d: 0.3,
  },
  demandSources: [
    "search_trends",
    "marketplace_listings",
    "forums_complaints",
    "job_posts",
    "community_requests",
  ],
  services: [
    {
      id: "research-brief",
      name: "Opportunity + Competitor Brief",
      priceUsd: 149,
      turnaroundHours: 24,
      description: "3-5 page brief with a go/no-go recommendation and experiment plan.",
    },
    {
      id: "conversion-pack",
      name: "Listing/Conversion Optimization Pack",
      priceUsd: 299,
      turnaroundHours: 48,
      description: "Offer rewrite, conversion checklist, and three headline variants.",
    },
    {
      id: "automation-setup",
      name: "Automation Setup + Weekly Reporting",
      priceUsd: 499,
      turnaroundHours: 72,
      description: "Setup automation baseline and recurring KPI report cadence.",
    },
  ],
  outboundCompliance: {
    maxSendsPerDay: 10,
    requirePersonalization: true,
    requireOptOut: true,
  },
};

type RevenueConfigOverrides = Partial<RevenueConfig> & {
  weights?: Partial<RevenueScoringWeights>;
  timeToCashBands?: RevenueTimeToCashBand[];
  thresholds?: Partial<RevenueDecisionThresholds>;
  capitalLimits?: Partial<RevenueCapitalLimits>;
  ops?: Partial<RevenueOpsConfig>;
  services?: RevenueServiceSku[];
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return out.length > 0 ? out : undefined;
}

function normalizeWeights(base: RevenueScoringWeights, override?: Partial<RevenueScoringWeights>) {
  if (!override) {
    return base;
  }
  return {
    demand: parseNumber(override.demand) ?? base.demand,
    pricingPower: parseNumber(override.pricingPower) ?? base.pricingPower,
    competitionInverse: parseNumber(override.competitionInverse) ?? base.competitionInverse,
    regRiskInverse: parseNumber(override.regRiskInverse) ?? base.regRiskInverse,
    speedToValidation: parseNumber(override.speedToValidation) ?? base.speedToValidation,
    marginPotential: parseNumber(override.marginPotential) ?? base.marginPotential,
    deliveryEffortInverse:
      parseNumber(override.deliveryEffortInverse) ?? base.deliveryEffortInverse,
    channelFrictionInverse:
      parseNumber(override.channelFrictionInverse) ?? base.channelFrictionInverse,
    refundSupportRiskInverse:
      parseNumber(override.refundSupportRiskInverse) ?? base.refundSupportRiskInverse,
    timeToCashScore: parseNumber(override.timeToCashScore) ?? base.timeToCashScore,
  };
}

function normalizeBands(
  base: RevenueTimeToCashBand[],
  override?: RevenueTimeToCashBand[],
): RevenueTimeToCashBand[] {
  if (!Array.isArray(override) || override.length === 0) {
    return base;
  }
  const cleaned = override
    .map((item) => {
      const maxDays = parseNumber(item.maxDays);
      const score = parseNumber(item.score);
      if (maxDays === undefined || score === undefined) {
        return null;
      }
      return {
        maxDays: clampNumber(maxDays, 1, Number.MAX_SAFE_INTEGER),
        score: clampNumber(score, 0, 100),
      };
    })
    .filter((item): item is RevenueTimeToCashBand => item !== null)
    .toSorted((a, b) => a.maxDays - b.maxDays);
  return cleaned.length > 0 ? cleaned : base;
}

function normalizeThresholds(
  base: RevenueDecisionThresholds,
  override?: Partial<RevenueDecisionThresholds>,
): RevenueDecisionThresholds {
  if (!override) {
    return base;
  }
  return {
    goMin: clampNumber(parseNumber(override.goMin) ?? base.goMin, 0, 100),
    watchMin: clampNumber(parseNumber(override.watchMin) ?? base.watchMin, 0, 100),
    minDemandForGo: clampNumber(
      parseNumber(override.minDemandForGo) ?? base.minDemandForGo,
      0,
      100,
    ),
    minMarginForGo: clampNumber(
      parseNumber(override.minMarginForGo) ?? base.minMarginForGo,
      0,
      100,
    ),
    maxTimeToFirstDollarDays: Math.max(
      1,
      Math.floor(parseNumber(override.maxTimeToFirstDollarDays) ?? base.maxTimeToFirstDollarDays),
    ),
    maxPaybackDays: Math.max(
      1,
      Math.floor(parseNumber(override.maxPaybackDays) ?? base.maxPaybackDays),
    ),
    highUpfrontCostFraction: clampNumber(
      parseNumber(override.highUpfrontCostFraction) ?? base.highUpfrontCostFraction,
      0,
      1,
    ),
    highUpfrontPaybackDays: Math.max(
      1,
      Math.floor(parseNumber(override.highUpfrontPaybackDays) ?? base.highUpfrontPaybackDays),
    ),
    minDemandConfirmationsForHighUpfront: Math.max(
      0,
      Math.floor(
        parseNumber(override.minDemandConfirmationsForHighUpfront) ??
          base.minDemandConfirmationsForHighUpfront,
      ),
    ),
    researchTimeoutPasses: Math.max(
      1,
      Math.floor(parseNumber(override.researchTimeoutPasses) ?? base.researchTimeoutPasses),
    ),
    researchTimeoutMinutes: Math.max(
      15,
      Math.floor(parseNumber(override.researchTimeoutMinutes) ?? base.researchTimeoutMinutes),
    ),
  };
}

function normalizeCapital(
  base: RevenueCapitalLimits,
  override?: Partial<RevenueCapitalLimits>,
): RevenueCapitalLimits {
  if (!override) {
    return base;
  }
  return {
    startingCapitalUsd: Math.max(
      1,
      parseNumber(override.startingCapitalUsd) ?? base.startingCapitalUsd,
    ),
    liquidityBufferUsd: Math.max(
      0,
      parseNumber(override.liquidityBufferUsd) ?? base.liquidityBufferUsd,
    ),
    maxCashBurnPerExperimentUsd: Math.max(
      1,
      parseNumber(override.maxCashBurnPerExperimentUsd) ?? base.maxCashBurnPerExperimentUsd,
    ),
    maxWeeklyCashBurnUsd: Math.max(
      1,
      parseNumber(override.maxWeeklyCashBurnUsd) ?? base.maxWeeklyCashBurnUsd,
    ),
    maxWeeklyHours: Math.max(1, parseNumber(override.maxWeeklyHours) ?? base.maxWeeklyHours),
    maxConcurrentExperiments: Math.max(
      1,
      Math.floor(parseNumber(override.maxConcurrentExperiments) ?? base.maxConcurrentExperiments),
    ),
    maxProjectShare: clampNumber(
      parseNumber(override.maxProjectShare) ?? base.maxProjectShare,
      0.1,
      1,
    ),
    postSignalTopShare: clampNumber(
      parseNumber(override.postSignalTopShare) ?? base.postSignalTopShare,
      0.4,
      1,
    ),
    postSignalMaxProjects: Math.max(
      1,
      Math.floor(parseNumber(override.postSignalMaxProjects) ?? base.postSignalMaxProjects),
    ),
    postSignalMinSignalScore: clampNumber(
      parseNumber(override.postSignalMinSignalScore) ?? base.postSignalMinSignalScore,
      0,
      100,
    ),
  };
}

function normalizeOps(
  base: RevenueOpsConfig,
  override?: Partial<RevenueOpsConfig>,
): RevenueOpsConfig {
  if (!override) {
    return base;
  }
  const autoApproveRisk = override.autoApproveRisk;
  return {
    maxOutboundDraftsPerDay: Math.max(
      1,
      Math.floor(parseNumber(override.maxOutboundDraftsPerDay) ?? base.maxOutboundDraftsPerDay),
    ),
    maxApprovalMinutesPerDay: Math.max(
      5,
      Math.floor(parseNumber(override.maxApprovalMinutesPerDay) ?? base.maxApprovalMinutesPerDay),
    ),
    autoApproveRisk:
      autoApproveRisk === "medium" || autoApproveRisk === "low"
        ? autoApproveRisk
        : base.autoApproveRisk,
    autoRejectMissingFields:
      typeof override.autoRejectMissingFields === "boolean"
        ? override.autoRejectMissingFields
        : base.autoRejectMissingFields,
    minOpportunitiesScoredPerDay: Math.max(
      1,
      Math.floor(
        parseNumber(override.minOpportunitiesScoredPerDay) ?? base.minOpportunitiesScoredPerDay,
      ),
    ),
    minKillRate14d: clampNumber(parseNumber(override.minKillRate14d) ?? base.minKillRate14d, 0, 1),
  };
}

function mergeConfig(base: RevenueConfig, override?: RevenueConfigOverrides): RevenueConfig {
  if (!override) {
    return base;
  }
  const services =
    Array.isArray(override.services) && override.services.length > 0
      ? override.services
      : base.services;
  const demandSources = parseStringArray(override.demandSources) ?? base.demandSources;
  return {
    version: Math.max(1, Math.floor(parseNumber(override.version) ?? base.version)),
    weights: normalizeWeights(base.weights, override.weights),
    timeToCashBands: normalizeBands(base.timeToCashBands, override.timeToCashBands),
    thresholds: normalizeThresholds(base.thresholds, override.thresholds),
    capitalLimits: normalizeCapital(base.capitalLimits, override.capitalLimits),
    ops: normalizeOps(base.ops, override.ops),
    demandSources,
    services,
    outboundCompliance: {
      maxSendsPerDay: Math.max(
        1,
        Math.floor(
          parseNumber(override.outboundCompliance?.maxSendsPerDay) ??
            base.outboundCompliance.maxSendsPerDay,
        ),
      ),
      requirePersonalization:
        typeof override.outboundCompliance?.requirePersonalization === "boolean"
          ? override.outboundCompliance.requirePersonalization
          : base.outboundCompliance.requirePersonalization,
      requireOptOut:
        typeof override.outboundCompliance?.requireOptOut === "boolean"
          ? override.outboundCompliance.requireOptOut
          : base.outboundCompliance.requireOptOut,
    },
  };
}

export function resolveRevenueRootDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir = resolveStateDir(env),
): string {
  const override = env.OPENCLAW_REVENUE_DIR?.trim();
  if (!override) {
    return path.join(stateDir, "revenue");
  }
  if (override.startsWith("~/")) {
    return path.resolve(path.join(env.HOME ?? os.homedir(), override.slice(2)));
  }
  if (override === "~") {
    return path.resolve(env.HOME ?? os.homedir());
  }
  return path.resolve(override);
}

export function resolveRevenueConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir = resolveStateDir(env),
): string {
  const override = env.OPENCLAW_REVENUE_CONFIG?.trim();
  if (override) {
    if (override.startsWith("~/")) {
      return path.resolve(path.join(env.HOME ?? os.homedir(), override.slice(2)));
    }
    return path.resolve(override);
  }
  return path.join(resolveRevenueRootDir(env, stateDir), "config.json");
}

export async function loadRevenueConfig(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  configPath?: string;
}): Promise<RevenueConfig> {
  const env = params?.env ?? process.env;
  const stateDir = params?.stateDir ?? resolveStateDir(env);
  const configPath = params?.configPath ?? resolveRevenueConfigPath(env, stateDir);
  const raw = await fs.readFile(configPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return DEFAULT_REVENUE_CONFIG;
  }
  try {
    const parsed = JSON.parse(raw) as RevenueConfigOverrides;
    return mergeConfig(DEFAULT_REVENUE_CONFIG, parsed);
  } catch {
    return DEFAULT_REVENUE_CONFIG;
  }
}

export async function ensureRevenueConfig(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  configPath?: string;
}): Promise<{ config: RevenueConfig; path: string }> {
  const env = params?.env ?? process.env;
  const stateDir = params?.stateDir ?? resolveStateDir(env);
  const configPath = params?.configPath ?? resolveRevenueConfigPath(env, stateDir);
  const config = await loadRevenueConfig({ env, stateDir, configPath });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const existing = await fs.readFile(configPath, "utf-8").catch(() => "");
  if (!existing.trim()) {
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  }
  return { config, path: configPath };
}

export async function saveRevenueConfig(
  config: RevenueConfig,
  params?: {
    env?: NodeJS.ProcessEnv;
    stateDir?: string;
    configPath?: string;
  },
): Promise<string> {
  const env = params?.env ?? process.env;
  const stateDir = params?.stateDir ?? resolveStateDir(env);
  const configPath = params?.configPath ?? resolveRevenueConfigPath(env, stateDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return configPath;
}
