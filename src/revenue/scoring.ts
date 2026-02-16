import type {
  RevenueConfig,
  RevenueOpportunityCandidate,
  RevenueOpportunityRecord,
} from "./types.js";
import { toSlug } from "./store.js";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function inversePercent(value: number): number {
  return 100 - clampPercent(value);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.85;
  }
  return Math.max(0.7, Math.min(1, value));
}

function sanitizeDays(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function sanitizeAmount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function sanitizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function deriveTimeToCashScore(expectedDays: number, config: RevenueConfig): number {
  const days = Math.max(1, Math.floor(expectedDays));
  const bands = [...config.timeToCashBands].toSorted((a, b) => a.maxDays - b.maxDays);
  for (const band of bands) {
    if (days <= band.maxDays) {
      return clampPercent(band.score);
    }
  }
  return clampPercent(bands.at(-1)?.score ?? 0);
}

export function hasResearchTimedOut(
  candidate: RevenueOpportunityCandidate,
  config: RevenueConfig,
): boolean {
  const passCount = sanitizeCount(candidate.researchPassCount);
  const minutes = sanitizeCount(candidate.researchMinutesSpent);
  return (
    passCount >= config.thresholds.researchTimeoutPasses ||
    minutes >= config.thresholds.researchTimeoutMinutes
  );
}

function canPassHighUpfrontGate(
  candidate: RevenueOpportunityCandidate,
  config: RevenueConfig,
): boolean {
  const upfrontCostUsd = sanitizeAmount(candidate.upfrontCostUsd);
  const paybackDaysEstimate = sanitizeDays(
    candidate.paybackDaysEstimate,
    config.thresholds.maxPaybackDays,
  );
  const demandConfirmations = sanitizeCount(candidate.demandConfirmations);
  const highUpfrontThreshold =
    config.capitalLimits.startingCapitalUsd * config.thresholds.highUpfrontCostFraction;

  if (upfrontCostUsd <= highUpfrontThreshold) {
    return true;
  }

  const fastPayback = paybackDaysEstimate <= config.thresholds.highUpfrontPaybackDays;
  const enoughConfirmations =
    demandConfirmations >= config.thresholds.minDemandConfirmationsForHighUpfront;

  return fastPayback || enoughConfirmations;
}

function scoreCore(
  candidate: RevenueOpportunityCandidate,
  config: RevenueConfig,
): {
  rawScore: number;
  score: number;
  confidence: number;
  timeToCashScore: number;
  expectedDaysToFirstRevenue: number;
  paybackDaysEstimate: number;
} {
  const weights = config.weights;
  const expectedDaysToFirstRevenue = sanitizeDays(
    candidate.expectedDaysToFirstRevenue,
    config.thresholds.maxTimeToFirstDollarDays,
  );
  const paybackDaysEstimate = sanitizeDays(
    candidate.paybackDaysEstimate,
    config.thresholds.maxPaybackDays,
  );
  const timeToCashScore = clampPercent(
    candidate.timeToCashScore ?? deriveTimeToCashScore(expectedDaysToFirstRevenue, config),
  );

  const weightedTotal =
    weights.demand * clampPercent(candidate.demand) +
    weights.pricingPower * clampPercent(candidate.pricingPower) +
    weights.competitionInverse * inversePercent(candidate.competition) +
    weights.regRiskInverse * inversePercent(candidate.regRisk) +
    weights.speedToValidation * clampPercent(candidate.speedToValidation) +
    weights.marginPotential * clampPercent(candidate.marginPotential) +
    weights.deliveryEffortInverse * inversePercent(candidate.deliveryEffort) +
    weights.channelFrictionInverse * inversePercent(candidate.channelFriction) +
    weights.refundSupportRiskInverse * inversePercent(candidate.refundSupportRisk) +
    weights.timeToCashScore * timeToCashScore;

  const weightSum =
    weights.demand +
    weights.pricingPower +
    weights.competitionInverse +
    weights.regRiskInverse +
    weights.speedToValidation +
    weights.marginPotential +
    weights.deliveryEffortInverse +
    weights.channelFrictionInverse +
    weights.refundSupportRiskInverse +
    weights.timeToCashScore;

  const confidence = clampConfidence(candidate.confidence ?? 0.85);
  const rawScore = weightSum > 0 ? weightedTotal / weightSum : 0;
  const score = clampPercent(rawScore * confidence);

  return {
    rawScore,
    score,
    confidence,
    timeToCashScore,
    expectedDaysToFirstRevenue,
    paybackDaysEstimate,
  };
}

export function evaluateOpportunity(
  candidate: RevenueOpportunityCandidate,
  config: RevenueConfig,
): Pick<
  RevenueOpportunityRecord,
  | "score"
  | "rawScore"
  | "confidence"
  | "decision"
  | "forcedDecision"
  | "timeToCashScore"
  | "reasons"
> {
  const {
    score,
    rawScore,
    confidence,
    timeToCashScore,
    expectedDaysToFirstRevenue,
    paybackDaysEstimate,
  } = scoreCore(candidate, config);

  const reasons: string[] = [];
  const demand = clampPercent(candidate.demand);
  const margin = clampPercent(candidate.marginPotential);
  const goEligibleByMetrics =
    demand >= config.thresholds.minDemandForGo && margin >= config.thresholds.minMarginForGo;
  if (!goEligibleByMetrics) {
    if (demand < config.thresholds.minDemandForGo) {
      reasons.push("Demand below go threshold");
    }
    if (margin < config.thresholds.minMarginForGo) {
      reasons.push("Margin potential below go threshold");
    }
  }

  const goEligibleByCashCycle =
    expectedDaysToFirstRevenue <= config.thresholds.maxTimeToFirstDollarDays &&
    paybackDaysEstimate <= config.thresholds.maxPaybackDays;

  if (!goEligibleByCashCycle) {
    reasons.push("Cash cycle exceeds threshold");
  }

  const goEligibleByUpfront = canPassHighUpfrontGate(candidate, config);
  if (!goEligibleByUpfront) {
    reasons.push("Upfront cost too high for current capital constraints");
  }

  let decision: RevenueOpportunityRecord["decision"] = "no-go";
  if (
    score >= config.thresholds.goMin &&
    goEligibleByMetrics &&
    goEligibleByCashCycle &&
    goEligibleByUpfront
  ) {
    decision = "go";
  } else if (
    score >= config.thresholds.watchMin &&
    expectedDaysToFirstRevenue <= config.thresholds.maxPaybackDays
  ) {
    decision = "watch";
  }

  const timedOut = hasResearchTimedOut(candidate, config);
  let forcedDecision = false;
  if (timedOut && decision === "watch") {
    forcedDecision = true;
    decision =
      score >= config.thresholds.goMin &&
      goEligibleByMetrics &&
      goEligibleByCashCycle &&
      goEligibleByUpfront
        ? "go"
        : "no-go";
    reasons.push("Research timeout hit; forced final decision");
  }

  if (decision === "go") {
    reasons.push("Meets score, margin, and liquidity gates");
  }
  if (decision === "watch") {
    reasons.push("Promising but below go confidence/quality threshold");
  }
  if (decision === "no-go" && reasons.length === 0) {
    reasons.push("Score below watch threshold");
  }

  return {
    score: Number(score.toFixed(2)),
    rawScore: Number(rawScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    decision,
    forcedDecision,
    timeToCashScore: Number(timeToCashScore.toFixed(2)),
    reasons,
  };
}

function buildOpportunityId(candidate: RevenueOpportunityCandidate, createdAt: number): string {
  const provided = candidate.id?.trim();
  if (provided) {
    return provided;
  }
  const base = toSlug(candidate.title) || "opportunity";
  return `${base}-${createdAt}`;
}

export function scoreOpportunity(
  candidate: RevenueOpportunityCandidate,
  config: RevenueConfig,
  createdAt = Date.now(),
): RevenueOpportunityRecord {
  const scored = evaluateOpportunity(candidate, config);
  return {
    ...candidate,
    id: buildOpportunityId(candidate, createdAt),
    createdAt: candidate.createdAt ?? createdAt,
    score: scored.score,
    rawScore: scored.rawScore,
    confidence: scored.confidence,
    decision: scored.decision,
    forcedDecision: scored.forcedDecision,
    timeToCashScore: scored.timeToCashScore,
    reasons: scored.reasons,
  };
}
