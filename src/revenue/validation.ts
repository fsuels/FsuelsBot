import type {
  RevenueConfig,
  RevenueCriteria,
  RevenueExperimentCheckpoint,
  RevenueExperimentEvaluation,
  RevenueExperimentMetrics,
  RevenueExperimentRecord,
  RevenueExperimentTemplate,
  RevenueExperimentTemplateSpec,
  RevenueMetricCondition,
} from "./types.js";
import { toSlug } from "./store.js";

function metricValue(
  metrics: RevenueExperimentMetrics,
  metric: RevenueMetricCondition["metric"],
): number {
  const value = metrics[metric];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function conditionMatches(
  metrics: RevenueExperimentMetrics,
  condition: RevenueMetricCondition,
): boolean {
  const value = metricValue(metrics, condition.metric);
  if (typeof condition.gte === "number" && value < condition.gte) {
    return false;
  }
  if (typeof condition.lte === "number" && value > condition.lte) {
    return false;
  }
  return true;
}

function criteriaMatches(
  criteria: RevenueCriteria,
  metrics: RevenueExperimentMetrics,
  expectedDaysToFirstRevenue: number,
): boolean {
  const all = criteria.all ?? [];
  const any = criteria.any ?? [];
  const hasConditions =
    all.length > 0 ||
    any.length > 0 ||
    criteria.requireNoPaidSignal === true ||
    typeof criteria.maxExpectedDaysToFirstRevenue === "number";
  if (!hasConditions) {
    return false;
  }

  if (all.length > 0 && !all.every((condition) => conditionMatches(metrics, condition))) {
    return false;
  }
  if (any.length > 0 && !any.some((condition) => conditionMatches(metrics, condition))) {
    return false;
  }
  if (criteria.requireNoPaidSignal && metricValue(metrics, "paidSignals") > 0) {
    return false;
  }
  if (
    typeof criteria.maxExpectedDaysToFirstRevenue === "number" &&
    expectedDaysToFirstRevenue <= criteria.maxExpectedDaysToFirstRevenue
  ) {
    return false;
  }
  return true;
}

function mergeMetrics(
  current: RevenueExperimentMetrics,
  patch?: RevenueExperimentMetrics,
): RevenueExperimentMetrics {
  if (!patch) {
    return current;
  }
  return {
    outboundSends:
      typeof patch.outboundSends === "number" ? patch.outboundSends : current.outboundSends,
    qualifiedReplies:
      typeof patch.qualifiedReplies === "number"
        ? patch.qualifiedReplies
        : current.qualifiedReplies,
    depositCommitments:
      typeof patch.depositCommitments === "number"
        ? patch.depositCommitments
        : current.depositCommitments,
    paidSignals: typeof patch.paidSignals === "number" ? patch.paidSignals : current.paidSignals,
    orders: typeof patch.orders === "number" ? patch.orders : current.orders,
    interactions:
      typeof patch.interactions === "number" ? patch.interactions : current.interactions,
    visits: typeof patch.visits === "number" ? patch.visits : current.visits,
    signups: typeof patch.signups === "number" ? patch.signups : current.signups,
    highIntentReplies:
      typeof patch.highIntentReplies === "number"
        ? patch.highIntentReplies
        : current.highIntentReplies,
  };
}

export const DEFAULT_EXPERIMENT_TEMPLATES: Record<
  RevenueExperimentTemplate,
  RevenueExperimentTemplateSpec
> = {
  outbound: {
    template: "outbound",
    passCriteria: {
      any: [
        { metric: "paidSignals", gte: 1 },
        { metric: "depositCommitments", gte: 2 },
      ],
    },
    killDay7Criteria: {
      any: [{ metric: "qualifiedReplies", lte: 1 }],
      requireNoPaidSignal: true,
    },
    killDay14Criteria: {
      requireNoPaidSignal: true,
      maxExpectedDaysToFirstRevenue: 30,
    },
  },
  marketplace: {
    template: "marketplace",
    passCriteria: {
      any: [
        { metric: "orders", gte: 2 },
        { metric: "interactions", gte: 10 },
      ],
    },
    killDay7Criteria: {
      any: [{ metric: "interactions", lte: 0 }],
    },
    killDay14Criteria: {
      all: [
        { metric: "orders", lte: 0 },
        { metric: "interactions", lte: 3 },
      ],
      maxExpectedDaysToFirstRevenue: 30,
    },
  },
  landing_page: {
    template: "landing_page",
    passCriteria: {
      all: [
        { metric: "signups", gte: 20 },
        { metric: "highIntentReplies", gte: 3 },
      ],
    },
    killDay7Criteria: {
      any: [
        { metric: "visits", lte: 50 },
        { metric: "signups", lte: 3 },
      ],
    },
    killDay14Criteria: {
      any: [{ metric: "highIntentReplies", lte: 0 }],
      requireNoPaidSignal: true,
      maxExpectedDaysToFirstRevenue: 30,
    },
  },
  custom: {
    template: "custom",
    passCriteria: {},
    killDay7Criteria: {},
    killDay14Criteria: {},
  },
};

function sanitizeTemplate(template: RevenueExperimentTemplate): RevenueExperimentTemplateSpec {
  return DEFAULT_EXPERIMENT_TEMPLATES[template] ?? DEFAULT_EXPERIMENT_TEMPLATES.custom;
}

function buildExperimentId(title: string, createdAt: number): string {
  const slug = toSlug(title) || "experiment";
  return `${slug}-${createdAt}`;
}

export function createExperimentFromTemplate(params: {
  projectId: string;
  title: string;
  template: RevenueExperimentTemplate;
  config: RevenueConfig;
  sourceOpportunityId?: string;
  budgetUsd?: number;
  budgetHours?: number;
  expectedDaysToFirstRevenue?: number;
  paybackTargetDays?: number;
  notes?: string;
  now?: number;
}): RevenueExperimentRecord {
  const now = params.now ?? Date.now();
  const base = sanitizeTemplate(params.template);
  return {
    id: buildExperimentId(params.title, now),
    projectId: params.projectId,
    title: params.title,
    template: params.template,
    status: "active",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    budgetUsd: Math.min(
      params.budgetUsd ?? params.config.capitalLimits.maxCashBurnPerExperimentUsd,
      params.config.capitalLimits.maxCashBurnPerExperimentUsd,
    ),
    budgetHours: Math.min(params.budgetHours ?? 8, params.config.capitalLimits.maxWeeklyHours),
    expectedDaysToFirstRevenue: Math.max(
      1,
      Math.floor(
        params.expectedDaysToFirstRevenue ?? params.config.thresholds.maxTimeToFirstDollarDays,
      ),
    ),
    paybackTargetDays: Math.max(
      1,
      Math.floor(params.paybackTargetDays ?? params.config.thresholds.maxPaybackDays),
    ),
    passCriteria: base.passCriteria,
    killDay7Criteria: base.killDay7Criteria,
    killDay14Criteria: base.killDay14Criteria,
    metrics: {},
    notes: params.notes,
    sourceOpportunityId: params.sourceOpportunityId,
  };
}

function hasLeadingSignal(metrics: RevenueExperimentMetrics): boolean {
  const qualifiedReplies = metricValue(metrics, "qualifiedReplies");
  const depositCommitments = metricValue(metrics, "depositCommitments");
  const orders = metricValue(metrics, "orders");
  const highIntentReplies = metricValue(metrics, "highIntentReplies");
  return qualifiedReplies > 0 || depositCommitments > 0 || orders > 0 || highIntentReplies > 0;
}

export function evaluateExperiment(params: {
  experiment: RevenueExperimentRecord;
  checkpoint: RevenueExperimentCheckpoint;
  config: RevenueConfig;
  metricsPatch?: RevenueExperimentMetrics;
}): RevenueExperimentEvaluation {
  const mergedMetrics = mergeMetrics(params.experiment.metrics, params.metricsPatch);
  const expectedDays =
    params.experiment.revisedDaysToFirstRevenue ?? params.experiment.expectedDaysToFirstRevenue;

  if (criteriaMatches(params.experiment.passCriteria, mergedMetrics, expectedDays)) {
    return {
      decision: "pass",
      checkpoint: params.checkpoint,
      reasons: ["Pass criteria met"],
      nextStatus: "passed",
    };
  }

  const reasons: string[] = [];
  const checkpointCriteria =
    params.checkpoint === "day7"
      ? params.experiment.killDay7Criteria
      : params.experiment.killDay14Criteria;

  const criteriaTriggered = criteriaMatches(checkpointCriteria, mergedMetrics, expectedDays);

  if (criteriaTriggered) {
    reasons.push(`Kill criteria met at ${params.checkpoint}`);
  }

  if (
    params.checkpoint === "day7" &&
    !hasLeadingSignal(mergedMetrics) &&
    expectedDays > params.config.thresholds.maxTimeToFirstDollarDays
  ) {
    reasons.push("No leading monetization signal and time-to-cash exceeds day-7 threshold");
  }

  if (params.checkpoint === "day14") {
    if (metricValue(mergedMetrics, "paidSignals") <= 0) {
      reasons.push("No paid signal by day 14");
    }
    if (expectedDays > params.config.thresholds.maxPaybackDays) {
      reasons.push("Revised time-to-cash exceeds payback threshold");
    }
  }

  if (reasons.length > 0) {
    return {
      decision: "kill",
      checkpoint: params.checkpoint,
      reasons,
      nextStatus: "killed",
    };
  }

  if (params.checkpoint === "day14") {
    return {
      decision: "kill",
      checkpoint: params.checkpoint,
      reasons: ["Day-14 hard gate: unresolved experiment must pass or be killed"],
      nextStatus: "killed",
    };
  }

  return {
    decision: "hold",
    checkpoint: params.checkpoint,
    reasons: ["Insufficient evidence to pass or kill"],
    nextStatus: "active",
  };
}

export function applyExperimentUpdate(params: {
  experiment: RevenueExperimentRecord;
  metricsPatch?: RevenueExperimentMetrics;
  status?: RevenueExperimentRecord["status"];
  revisedDaysToFirstRevenue?: number;
  notes?: string;
  now?: number;
}): RevenueExperimentRecord {
  const now = params.now ?? Date.now();
  const metrics = mergeMetrics(params.experiment.metrics, params.metricsPatch);
  return {
    ...params.experiment,
    metrics,
    status: params.status ?? params.experiment.status,
    revisedDaysToFirstRevenue:
      typeof params.revisedDaysToFirstRevenue === "number"
        ? Math.max(1, Math.floor(params.revisedDaysToFirstRevenue))
        : params.experiment.revisedDaysToFirstRevenue,
    notes: params.notes ?? params.experiment.notes,
    updatedAt: now,
  };
}
