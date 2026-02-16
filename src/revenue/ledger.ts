import type {
  RevenueDailySummary,
  RevenueDecision,
  RevenueLedgerEvent,
  RevenueLedgerEventType,
} from "./types.js";

function eventId(type: RevenueLedgerEventType, ts: number, projectId: string): string {
  return `${type}:${projectId}:${ts}:${Math.random().toString(16).slice(2, 10)}`;
}

export function createLedgerEvent(params: {
  type: RevenueLedgerEventType;
  projectId: string;
  ts?: number;
  experimentId?: string;
  opportunityId?: string;
  amountUsd?: number;
  hours?: number;
  decision?: RevenueDecision;
  fromStatus?: RevenueLedgerEvent["fromStatus"];
  toStatus?: RevenueLedgerEvent["toStatus"];
  metadata?: RevenueLedgerEvent["metadata"];
  notes?: string;
}): RevenueLedgerEvent {
  const ts = params.ts ?? Date.now();
  return {
    id: eventId(params.type, ts, params.projectId),
    ts,
    type: params.type,
    projectId: params.projectId,
    experimentId: params.experimentId,
    opportunityId: params.opportunityId,
    amountUsd: params.amountUsd,
    hours: params.hours,
    decision: params.decision,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    metadata: params.metadata,
    notes: params.notes,
  };
}

function withinWindow(ts: number, now: number, windowMs: number): boolean {
  return ts >= now - windowMs && ts <= now;
}

function safeNumber(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

export function summarizeDailyLedger(params: {
  events: RevenueLedgerEvent[];
  now?: number;
  windowHours?: number;
}): RevenueDailySummary {
  const now = params.now ?? Date.now();
  const windowMs = (params.windowHours ?? 24) * 60 * 60 * 1000;
  const result: RevenueDailySummary = {
    revenueUsd: 0,
    cashSpentUsd: 0,
    hoursSpent: 0,
    opportunitiesScored: 0,
    goCount: 0,
    watchCount: 0,
    noGoCount: 0,
    paidSignals: 0,
  };

  for (const event of params.events) {
    if (!withinWindow(event.ts, now, windowMs)) {
      continue;
    }
    if (event.type === "revenue_received") {
      result.revenueUsd += safeNumber(event.amountUsd);
      if (safeNumber(event.amountUsd) > 0) {
        result.paidSignals += 1;
      }
      continue;
    }
    if (event.type === "cash_spent") {
      result.cashSpentUsd += safeNumber(event.amountUsd);
      continue;
    }
    if (event.type === "time_spent") {
      result.hoursSpent += safeNumber(event.hours);
      continue;
    }
    if (event.type === "opportunity_scored") {
      result.opportunitiesScored += 1;
      continue;
    }
    if (event.type === "decision_made") {
      if (event.decision === "go") {
        result.goCount += 1;
      }
      if (event.decision === "watch") {
        result.watchCount += 1;
      }
      if (event.decision === "no-go") {
        result.noGoCount += 1;
      }
    }
  }

  result.revenueUsd = Number(result.revenueUsd.toFixed(2));
  result.cashSpentUsd = Number(result.cashSpentUsd.toFixed(2));
  result.hoursSpent = Number(result.hoursSpent.toFixed(2));
  return result;
}

export function summarizeLedgerTotals(params: {
  events: RevenueLedgerEvent[];
  now?: number;
  windowDays?: number;
}): { revenueUsd: number; cashSpentUsd: number; hoursSpent: number } {
  const now = params.now ?? Date.now();
  const windowMs = (params.windowDays ?? 7) * 24 * 60 * 60 * 1000;
  let revenueUsd = 0;
  let cashSpentUsd = 0;
  let hoursSpent = 0;

  for (const event of params.events) {
    if (!withinWindow(event.ts, now, windowMs)) {
      continue;
    }
    if (event.type === "revenue_received") {
      revenueUsd += safeNumber(event.amountUsd);
      continue;
    }
    if (event.type === "cash_spent") {
      cashSpentUsd += safeNumber(event.amountUsd);
      continue;
    }
    if (event.type === "time_spent") {
      hoursSpent += safeNumber(event.hours);
    }
  }

  return {
    revenueUsd: Number(revenueUsd.toFixed(2)),
    cashSpentUsd: Number(cashSpentUsd.toFixed(2)),
    hoursSpent: Number(hoursSpent.toFixed(2)),
  };
}

export function groupEventsByProject(
  events: RevenueLedgerEvent[],
): Map<string, RevenueLedgerEvent[]> {
  const grouped = new Map<string, RevenueLedgerEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.projectId) ?? [];
    bucket.push(event);
    grouped.set(event.projectId, bucket);
  }
  return grouped;
}

export function computeReplyMetrics(events: RevenueLedgerEvent[]): {
  approvedDrafts: number;
  sentDrafts: number;
  replyRate: number;
  conversionRate: number;
} {
  let approvedDrafts = 0;
  let sentDrafts = 0;
  let paidSignals = 0;

  for (const event of events) {
    if (event.type === "decision_made" && event.metadata?.kind === "approval") {
      if (event.metadata?.status === "approved") {
        approvedDrafts += 1;
      }
      if (event.metadata?.status === "sent") {
        sentDrafts += 1;
      }
      continue;
    }
    if (event.type === "revenue_received" && safeNumber(event.amountUsd) > 0) {
      paidSignals += 1;
    }
  }

  const replyRate = sentDrafts > 0 ? approvedDrafts / sentDrafts : 0;
  const conversionRate = sentDrafts > 0 ? paidSignals / sentDrafts : 0;

  return {
    approvedDrafts,
    sentDrafts,
    replyRate: Number(replyRate.toFixed(3)),
    conversionRate: Number(conversionRate.toFixed(3)),
  };
}
