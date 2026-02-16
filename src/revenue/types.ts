export type RevenueDecision = "go" | "watch" | "no-go";

export type RevenueExperimentTemplate = "outbound" | "marketplace" | "landing_page" | "custom";

export type RevenueExperimentStatus = "planned" | "active" | "passed" | "killed" | "completed";

export type RevenueScoringWeights = {
  demand: number;
  pricingPower: number;
  competitionInverse: number;
  regRiskInverse: number;
  speedToValidation: number;
  marginPotential: number;
  deliveryEffortInverse: number;
  channelFrictionInverse: number;
  refundSupportRiskInverse: number;
  timeToCashScore: number;
};

export type RevenueTimeToCashBand = {
  maxDays: number;
  score: number;
};

export type RevenueDecisionThresholds = {
  goMin: number;
  watchMin: number;
  minDemandForGo: number;
  minMarginForGo: number;
  maxTimeToFirstDollarDays: number;
  maxPaybackDays: number;
  highUpfrontCostFraction: number;
  highUpfrontPaybackDays: number;
  minDemandConfirmationsForHighUpfront: number;
  researchTimeoutPasses: number;
  researchTimeoutMinutes: number;
};

export type RevenueCapitalLimits = {
  startingCapitalUsd: number;
  liquidityBufferUsd: number;
  maxCashBurnPerExperimentUsd: number;
  maxWeeklyCashBurnUsd: number;
  maxWeeklyHours: number;
  maxConcurrentExperiments: number;
  maxProjectShare: number;
  postSignalTopShare: number;
  postSignalMaxProjects: number;
  postSignalMinSignalScore: number;
};

export type RevenueOpsConfig = {
  maxOutboundDraftsPerDay: number;
  maxApprovalMinutesPerDay: number;
  autoApproveRisk: "low" | "medium";
  autoRejectMissingFields: boolean;
  minOpportunitiesScoredPerDay: number;
  minKillRate14d: number;
};

export type RevenueServiceSku = {
  id: string;
  name: string;
  priceUsd: number;
  turnaroundHours: number;
  description: string;
};

export type RevenueConfig = {
  version: number;
  weights: RevenueScoringWeights;
  timeToCashBands: RevenueTimeToCashBand[];
  thresholds: RevenueDecisionThresholds;
  capitalLimits: RevenueCapitalLimits;
  ops: RevenueOpsConfig;
  demandSources: string[];
  services: RevenueServiceSku[];
  outboundCompliance: {
    maxSendsPerDay: number;
    requirePersonalization: boolean;
    requireOptOut: boolean;
  };
};

export type RevenueScoreInputs = {
  demand: number;
  pricingPower: number;
  competition: number;
  regRisk: number;
  speedToValidation: number;
  marginPotential: number;
  deliveryEffort: number;
  channelFriction: number;
  refundSupportRisk: number;
  confidence?: number;
  timeToCashScore?: number;
  expectedDaysToFirstRevenue?: number;
  paybackDaysEstimate?: number;
  upfrontCostUsd?: number;
  demandConfirmations?: number;
  researchPassCount?: number;
  researchMinutesSpent?: number;
};

export type RevenueOpportunityCandidate = RevenueScoreInputs & {
  id?: string;
  projectId?: string;
  title: string;
  niche?: string;
  source?: string;
  notes?: string;
  createdAt?: number;
};

export type RevenueOpportunityRecord = RevenueOpportunityCandidate & {
  id: string;
  createdAt: number;
  score: number;
  rawScore: number;
  confidence: number;
  decision: RevenueDecision;
  forcedDecision: boolean;
  timeToCashScore: number;
  reasons: string[];
};

export type RevenueMetricName =
  | "outboundSends"
  | "qualifiedReplies"
  | "depositCommitments"
  | "paidSignals"
  | "orders"
  | "interactions"
  | "visits"
  | "signups"
  | "highIntentReplies";

export type RevenueExperimentMetrics = {
  outboundSends?: number;
  qualifiedReplies?: number;
  depositCommitments?: number;
  paidSignals?: number;
  orders?: number;
  interactions?: number;
  visits?: number;
  signups?: number;
  highIntentReplies?: number;
};

export type RevenueMetricCondition = {
  metric: RevenueMetricName;
  gte?: number;
  lte?: number;
};

export type RevenueCriteria = {
  all?: RevenueMetricCondition[];
  any?: RevenueMetricCondition[];
  requireNoPaidSignal?: boolean;
  maxExpectedDaysToFirstRevenue?: number;
};

export type RevenueExperimentTemplateSpec = {
  template: RevenueExperimentTemplate;
  passCriteria: RevenueCriteria;
  killDay7Criteria: RevenueCriteria;
  killDay14Criteria: RevenueCriteria;
};

export type RevenueExperimentRecord = {
  id: string;
  projectId: string;
  title: string;
  template: RevenueExperimentTemplate;
  status: RevenueExperimentStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  budgetUsd: number;
  budgetHours: number;
  expectedDaysToFirstRevenue: number;
  revisedDaysToFirstRevenue?: number;
  paybackTargetDays: number;
  passCriteria: RevenueCriteria;
  killDay7Criteria: RevenueCriteria;
  killDay14Criteria: RevenueCriteria;
  metrics: RevenueExperimentMetrics;
  notes?: string;
  sourceOpportunityId?: string;
};

export type RevenueExperimentCheckpoint = "day7" | "day14";

export type RevenueExperimentEvaluation = {
  decision: "pass" | "kill" | "hold";
  checkpoint: RevenueExperimentCheckpoint;
  reasons: string[];
  nextStatus: RevenueExperimentStatus;
};

export type RevenueLedgerEventType =
  | "time_spent"
  | "cash_spent"
  | "revenue_received"
  | "experiment_status_changed"
  | "decision_made"
  | "opportunity_scored"
  | "allocation_decided";

export type RevenueLedgerEvent = {
  id: string;
  ts: number;
  type: RevenueLedgerEventType;
  projectId: string;
  experimentId?: string;
  opportunityId?: string;
  amountUsd?: number;
  hours?: number;
  decision?: RevenueDecision;
  fromStatus?: RevenueExperimentStatus;
  toStatus?: RevenueExperimentStatus;
  metadata?: Record<string, string | number | boolean | null>;
  notes?: string;
};

export type RevenueApprovalKind = "outreach_draft" | "offer_draft" | "deliverable" | "listing";

export type RevenueApprovalStatus = "pending" | "approved" | "rejected" | "sent" | "delivered";

export type RevenueApprovalRisk = "low" | "medium" | "high";

export type RevenueApprovalItem = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RevenueApprovalStatus;
  kind: RevenueApprovalKind;
  projectId: string;
  experimentId?: string;
  opportunityId?: string;
  title: string;
  draft: Record<string, string>;
  risk: RevenueApprovalRisk;
  requiredFields: string[];
  tags?: string[];
  reason?: string;
};

export type RevenueOrder = {
  id: string;
  createdAt: number;
  updatedAt: number;
  projectId: string;
  clientName: string;
  skuId: string;
  status: "queued" | "in_progress" | "delivered";
  amountUsd: number;
  brief?: string;
};

export type RevenueProjectSnapshot = {
  projectId: string;
  revenueUsd: number;
  cashSpentUsd: number;
  hoursSpent: number;
  expectedDaysToFirstRevenue: number;
  signalQualityScore: number;
  activeExperiments: number;
};

export type RevenueAllocationAction = "scale" | "hold" | "kill";

export type RevenueAllocationDecision = {
  projectId: string;
  roiScore: number;
  liquidityScore: number;
  adjustedScore: number;
  action: RevenueAllocationAction;
  targetHours: number;
  targetCashUsd: number;
  reasons: string[];
};

export type RevenueDailySummary = {
  revenueUsd: number;
  cashSpentUsd: number;
  hoursSpent: number;
  opportunitiesScored: number;
  goCount: number;
  watchCount: number;
  noGoCount: number;
  paidSignals: number;
};

export type RevenueBaselineSnapshot = {
  generatedAt: number;
  opportunitiesCount: number;
  activeExperimentsCount: number;
  approvalsPendingCount: number;
  approvalsResolved24hCount: number;
  ordersQueuedCount: number;
  revenueLast7dUsd: number;
  cashSpentLast7dUsd: number;
  hoursLast7d: number;
};

export type RevenueAutopilotState = {
  enabled: boolean;
  demandLimit?: number;
  outreachMaxDrafts?: number;
  deliveryLimit?: number;
  keepInbox: boolean;
  lastDailyRunDate?: string;
  lastDailyAttemptDate?: string;
  lastWeeklyRunKey?: string;
  lastWeeklyAttemptKey?: string;
  lastRunAt?: number;
  lastError?: string;
};
