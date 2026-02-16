import type {
  RevenueAllocationAction,
  RevenueAllocationDecision,
  RevenueConfig,
  RevenueExperimentRecord,
  RevenueLedgerEvent,
  RevenueProjectSnapshot,
} from "./types.js";

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function roiScore(revenueUsd: number, cashSpentUsd: number): number {
  const revenue = Math.max(0, revenueUsd);
  const cost = Math.max(0, cashSpentUsd);
  if (cost === 0) {
    return revenue > 0 ? 90 : 40;
  }
  const ratio = (revenue - cost) / cost;
  return clamp(50 + ratio * 50, 0, 100);
}

export function liquidityScore(expectedDaysToFirstRevenue: number, config: RevenueConfig): number {
  const days = Math.max(1, Math.floor(expectedDaysToFirstRevenue));
  const baseline = Math.max(1, config.thresholds.maxTimeToFirstDollarDays);
  const ratio = baseline / days;
  return clamp(ratio * 100, 0, 100);
}

export function buildProjectSnapshots(params: {
  events: RevenueLedgerEvent[];
  experiments: RevenueExperimentRecord[];
  config: RevenueConfig;
  now?: number;
  windowDays?: number;
}): RevenueProjectSnapshot[] {
  const now = params.now ?? Date.now();
  const windowMs = (params.windowDays ?? 7) * 24 * 60 * 60 * 1000;
  const projectIds = new Set<string>();
  for (const event of params.events) {
    if (event.ts >= now - windowMs && event.ts <= now) {
      projectIds.add(event.projectId);
    }
  }
  for (const experiment of params.experiments) {
    projectIds.add(experiment.projectId);
  }

  const snapshots: RevenueProjectSnapshot[] = [];
  for (const projectId of projectIds) {
    let revenueUsd = 0;
    let cashSpentUsd = 0;
    let hoursSpent = 0;

    for (const event of params.events) {
      if (event.projectId !== projectId) {
        continue;
      }
      if (event.ts < now - windowMs || event.ts > now) {
        continue;
      }
      if (event.type === "revenue_received") {
        revenueUsd += event.amountUsd ?? 0;
      }
      if (event.type === "cash_spent") {
        cashSpentUsd += event.amountUsd ?? 0;
      }
      if (event.type === "time_spent") {
        hoursSpent += event.hours ?? 0;
      }
    }

    const experiments = params.experiments.filter(
      (experiment) => experiment.projectId === projectId,
    );
    const activeExperiments = experiments.filter(
      (experiment) => experiment.status === "active",
    ).length;
    const passed = experiments.filter((experiment) => experiment.status === "passed").length;
    const killed = experiments.filter((experiment) => experiment.status === "killed").length;
    const totalForSignal = Math.max(1, passed + killed + activeExperiments);
    const signalQualityScore = clamp(
      ((passed + activeExperiments * 0.5) / totalForSignal) * 100,
      0,
      100,
    );
    const expectedDaysToFirstRevenue =
      experiments
        .map(
          (experiment) =>
            experiment.revisedDaysToFirstRevenue ?? experiment.expectedDaysToFirstRevenue,
        )
        .reduce((min, days) => Math.min(min, Math.max(1, days)), Number.POSITIVE_INFINITY) ||
      params.config.thresholds.maxPaybackDays;

    snapshots.push({
      projectId,
      revenueUsd: round2(revenueUsd),
      cashSpentUsd: round2(cashSpentUsd),
      hoursSpent: round2(hoursSpent),
      expectedDaysToFirstRevenue: Number.isFinite(expectedDaysToFirstRevenue)
        ? expectedDaysToFirstRevenue
        : params.config.thresholds.maxPaybackDays,
      signalQualityScore: round2(signalQualityScore),
      activeExperiments,
    });
  }

  return snapshots;
}

function applyShareCaps(
  entries: Array<{ projectId: string; weight: number }>,
  maxProjectShare: number,
): Map<string, number> {
  const shares = new Map<string, number>();
  if (entries.length === 0) {
    return shares;
  }

  const remaining = entries.map((entry) => ({ ...entry, weight: Math.max(0, entry.weight) }));
  let remainingShare = 1;

  while (remaining.length > 0 && remainingShare > 0) {
    const weightTotal = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    const nextCapped = new Set<string>();

    for (const entry of remaining) {
      const proposed =
        weightTotal > 0
          ? (entry.weight / weightTotal) * remainingShare
          : remainingShare / remaining.length;
      if (proposed > maxProjectShare) {
        nextCapped.add(entry.projectId);
      }
    }

    if (nextCapped.size === 0) {
      for (const entry of remaining) {
        const share =
          weightTotal > 0
            ? (entry.weight / weightTotal) * remainingShare
            : remainingShare / remaining.length;
        shares.set(entry.projectId, share);
      }
      return shares;
    }

    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const entry = remaining[i];
      if (!entry || !nextCapped.has(entry.projectId)) {
        continue;
      }
      shares.set(entry.projectId, maxProjectShare);
      remainingShare = Math.max(0, remainingShare - maxProjectShare);
      remaining.splice(i, 1);
    }
  }

  return shares;
}

function totalShare(shares: Map<string, number>): number {
  let total = 0;
  for (const value of shares.values()) {
    total += Math.max(0, value);
  }
  return total;
}

function addShareProportionally(params: {
  shares: Map<string, number>;
  ids: string[];
  amount: number;
  weightById: Map<string, number>;
}): void {
  const amount = Math.max(0, params.amount);
  if (amount <= 0 || params.ids.length === 0) {
    return;
  }
  const weightTotal = params.ids.reduce((sum, id) => sum + (params.weightById.get(id) ?? 1), 0);
  let allocated = 0;
  for (let i = 0; i < params.ids.length; i += 1) {
    const id = params.ids[i];
    if (!id) {
      continue;
    }
    const current = params.shares.get(id) ?? 0;
    const portion =
      i === params.ids.length - 1
        ? amount - allocated
        : weightTotal > 0
          ? amount * ((params.weightById.get(id) ?? 1) / weightTotal)
          : amount / params.ids.length;
    const safePortion = Math.max(0, portion);
    params.shares.set(id, current + safePortion);
    allocated += safePortion;
  }
}

function removeShareProportionally(params: {
  shares: Map<string, number>;
  ids: string[];
  amount: number;
}): number {
  const amount = Math.max(0, params.amount);
  if (amount <= 0 || params.ids.length === 0) {
    return 0;
  }
  const donorTotals = params.ids.reduce((sum, id) => sum + (params.shares.get(id) ?? 0), 0);
  if (donorTotals <= 0) {
    return 0;
  }

  let removed = 0;
  for (let i = 0; i < params.ids.length; i += 1) {
    const id = params.ids[i];
    if (!id) {
      continue;
    }
    const current = Math.max(0, params.shares.get(id) ?? 0);
    if (current <= 0) {
      continue;
    }
    const portion =
      i === params.ids.length - 1 ? amount - removed : amount * (current / donorTotals);
    const safePortion = Math.max(0, Math.min(current, portion));
    params.shares.set(id, current - safePortion);
    removed += safePortion;
  }
  return removed;
}

function hasStrongSignal(snapshot: RevenueProjectSnapshot, config: RevenueConfig): boolean {
  return (
    snapshot.signalQualityScore >= config.capitalLimits.postSignalMinSignalScore ||
    snapshot.revenueUsd > 0
  );
}

function enforcePostSignalFocus(params: {
  shares: Map<string, number>;
  allocatable: Array<{ projectId: string; weight: number }>;
  ranked: Array<{
    snapshot: RevenueProjectSnapshot;
    action: RevenueAllocationAction;
    adjustedScore: number;
  }>;
  config: RevenueConfig;
}): { shares: Map<string, number>; focusProjectIds: Set<string>; enforced: boolean } {
  const rankedEligible = params.ranked
    .filter((entry) => entry.action !== "kill")
    .toSorted((a, b) => b.adjustedScore - a.adjustedScore);
  const focusProjectIds = rankedEligible
    .filter((entry) => hasStrongSignal(entry.snapshot, params.config))
    .slice(0, params.config.capitalLimits.postSignalMaxProjects)
    .map((entry) => entry.snapshot.projectId);

  if (focusProjectIds.length === 0) {
    return {
      shares: params.shares,
      focusProjectIds: new Set<string>(),
      enforced: false,
    };
  }

  const targetShare = clamp(params.config.capitalLimits.postSignalTopShare, 0, 1);
  const focusSet = new Set(focusProjectIds);
  const currentFocusShare = focusProjectIds.reduce(
    (sum, projectId) => sum + (params.shares.get(projectId) ?? 0),
    0,
  );
  if (currentFocusShare >= targetShare) {
    return { shares: params.shares, focusProjectIds: focusSet, enforced: false };
  }

  const weightById = new Map(params.allocatable.map((entry) => [entry.projectId, entry.weight]));
  let needed = targetShare - currentFocusShare;

  const unallocatedShare = Math.max(0, 1 - totalShare(params.shares));
  const fromUnallocated = Math.min(needed, unallocatedShare);
  if (fromUnallocated > 0) {
    addShareProportionally({
      shares: params.shares,
      ids: focusProjectIds,
      amount: fromUnallocated,
      weightById,
    });
    needed -= fromUnallocated;
  }

  if (needed > 0) {
    const donorIds = params.allocatable
      .map((entry) => entry.projectId)
      .filter((projectId) => !focusSet.has(projectId) && (params.shares.get(projectId) ?? 0) > 0);
    const removed = removeShareProportionally({
      shares: params.shares,
      ids: donorIds,
      amount: needed,
    });
    if (removed > 0) {
      addShareProportionally({
        shares: params.shares,
        ids: focusProjectIds,
        amount: removed,
        weightById,
      });
    }
  }

  return {
    shares: params.shares,
    focusProjectIds: focusSet,
    enforced: true,
  };
}

function classifyAction(params: {
  adjustedScore: number;
  roiScoreValue: number;
  liquidityScoreValue: number;
  snapshot: RevenueProjectSnapshot;
  config: RevenueConfig;
  cashBufferUsd: number;
}): { action: RevenueAllocationAction; reasons: string[] } {
  const reasons: string[] = [];
  const profitable = params.snapshot.revenueUsd > params.snapshot.cashSpentUsd;
  const lowCashMode = params.cashBufferUsd < params.config.capitalLimits.liquidityBufferUsd;

  if (lowCashMode) {
    reasons.push("Low-cash mode active");
    if (params.liquidityScoreValue < 70 && !profitable) {
      reasons.push("Slow time-to-cash under liquidity pressure");
      return { action: "kill", reasons };
    }
    if (params.adjustedScore < 50 && !profitable) {
      reasons.push("Adjusted score below low-cash floor");
      return { action: "kill", reasons };
    }
  }

  if (params.snapshot.activeExperiments > params.config.capitalLimits.maxConcurrentExperiments) {
    reasons.push("Project exceeds concurrent experiment cap");
    return { action: "hold", reasons };
  }

  if (params.adjustedScore >= 75 && params.roiScoreValue >= 55) {
    reasons.push("High combined ROI and liquidity score");
    return { action: "scale", reasons };
  }

  if (params.adjustedScore >= 50) {
    reasons.push("Meets hold threshold");
    return { action: "hold", reasons };
  }

  reasons.push("Score below hold threshold");
  return { action: "kill", reasons };
}

export function allocateWeeklyCapital(params: {
  projects: RevenueProjectSnapshot[];
  config: RevenueConfig;
  cashBufferUsd?: number;
}): RevenueAllocationDecision[] {
  const cashBufferUsd = params.cashBufferUsd ?? params.config.capitalLimits.startingCapitalUsd;

  const ranked = params.projects.map((snapshot) => {
    const roiScoreValue = roiScore(snapshot.revenueUsd, snapshot.cashSpentUsd);
    const liquidityScoreValue = liquidityScore(snapshot.expectedDaysToFirstRevenue, params.config);
    const adjustedScore = round2(roiScoreValue * 0.6 + liquidityScoreValue * 0.4);
    const classified = classifyAction({
      adjustedScore,
      roiScoreValue,
      liquidityScoreValue,
      snapshot,
      config: params.config,
      cashBufferUsd,
    });
    return {
      snapshot,
      roiScoreValue: round2(roiScoreValue),
      liquidityScoreValue: round2(liquidityScoreValue),
      adjustedScore,
      action: classified.action,
      reasons: classified.reasons,
    };
  });

  const allocatable = ranked
    .filter((entry) => entry.action !== "kill")
    .map((entry) => ({
      projectId: entry.snapshot.projectId,
      weight: Math.max(1, entry.adjustedScore),
    }));

  const baseShares = applyShareCaps(allocatable, params.config.capitalLimits.maxProjectShare);
  const postSignal = enforcePostSignalFocus({
    shares: baseShares,
    allocatable,
    ranked,
    config: params.config,
  });
  const shares = postSignal.shares;

  return ranked
    .toSorted((a, b) => b.adjustedScore - a.adjustedScore)
    .map<RevenueAllocationDecision>((entry) => {
      const share = entry.action === "kill" ? 0 : (shares.get(entry.snapshot.projectId) ?? 0);
      const targetHours = round2(params.config.capitalLimits.maxWeeklyHours * share);
      const targetCashUsd = round2(params.config.capitalLimits.maxWeeklyCashBurnUsd * share);
      const reasons = [...entry.reasons];
      if (entry.action !== "kill" && postSignal.focusProjectIds.has(entry.snapshot.projectId)) {
        reasons.push(
          `Post-signal focus target: ${Math.round(params.config.capitalLimits.postSignalTopShare * 100)}% on top ${params.config.capitalLimits.postSignalMaxProjects}`,
        );
      }
      if (postSignal.enforced && entry.action !== "kill") {
        reasons.push("Allocation adjusted for post-signal concentration");
      }
      return {
        projectId: entry.snapshot.projectId,
        roiScore: entry.roiScoreValue,
        liquidityScore: entry.liquidityScoreValue,
        adjustedScore: entry.adjustedScore,
        action: entry.action,
        targetHours,
        targetCashUsd,
        reasons,
      };
    });
}
