import path from "node:path";
import type {
  RevenueAllocationDecision,
  RevenueApprovalItem,
  RevenueBaselineSnapshot,
  RevenueConfig,
  RevenueExperimentRecord,
  RevenueLedgerEvent,
  RevenueLedgerEventType,
  RevenueOpportunityCandidate,
  RevenueOpportunityRecord,
  RevenueOrder,
} from "./types.js";
import { allocateWeeklyCapital, buildProjectSnapshots } from "./allocation.js";
import {
  autoResolveApproval,
  buildApprovalBatchMarkdown,
  createApprovalItem,
  foldApprovalQueue,
  updateApprovalStatus,
} from "./approval.js";
import { ensureRevenueConfig } from "./config.js";
import {
  computeReplyMetrics,
  createLedgerEvent,
  summarizeDailyLedger,
  summarizeLedgerTotals,
} from "./ledger.js";
import { scoreOpportunity } from "./scoring.js";
import {
  appendJsonlLine,
  appendJsonlLines,
  dateStamp,
  ensureRevenueDirs,
  isoTimestamp,
  readJsonFile,
  readJsonlFile,
  resetJsonlFile,
  resolveRevenuePaths,
  writeJsonFile,
  writeMarkdownFile,
} from "./store.js";
import {
  applyExperimentUpdate,
  createExperimentFromTemplate,
  evaluateExperiment,
} from "./validation.js";

async function initializeRevenue(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}) {
  const paths = resolveRevenuePaths(params);
  await ensureRevenueDirs(paths);
  const { config, path: configPath } = await ensureRevenueConfig({
    env: params?.env,
    stateDir: params?.stateDir,
    configPath: paths.configPath,
  });
  return { config, configPath, paths };
}

async function readApprovalState(pathname: string): Promise<{
  raw: RevenueApprovalItem[];
  latest: RevenueApprovalItem[];
}> {
  const raw = await readJsonlFile<RevenueApprovalItem>(pathname);
  return {
    raw,
    latest: foldApprovalQueue(raw),
  };
}

function markdownList(items: string[]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }
  return items.map((item) => `- ${item}`);
}

function computeKillRate14d(params: { experiments: RevenueExperimentRecord[]; now: number }): {
  considered: number;
  killed: number;
  rate: number;
} {
  const windowStart = params.now - 14 * 24 * 60 * 60 * 1000;
  let considered = 0;
  let killed = 0;
  for (const experiment of params.experiments) {
    const startedAt = experiment.startedAt ?? experiment.createdAt;
    if (startedAt < windowStart || startedAt > params.now) {
      continue;
    }
    if (
      experiment.status === "active" ||
      experiment.status === "passed" ||
      experiment.status === "killed" ||
      experiment.status === "completed"
    ) {
      considered += 1;
    }
    if (experiment.status === "killed") {
      killed += 1;
    }
  }
  const rate = considered > 0 ? killed / considered : 0;
  return { considered, killed, rate };
}

function enforceKillRateFloor(params: {
  decisions: RevenueAllocationDecision[];
  config: RevenueConfig;
  killRate14d: { considered: number; killed: number; rate: number };
}): { decisions: RevenueAllocationDecision[]; forcedProjectId?: string } {
  const floor = params.config.ops.minKillRate14d;
  if (params.killRate14d.considered < 3 || params.killRate14d.rate > floor) {
    return { decisions: params.decisions };
  }

  const candidate = params.decisions
    .filter((decision) => decision.action === "hold")
    .toSorted((a, b) => a.adjustedScore - b.adjustedScore)
    .at(0);
  if (!candidate || params.decisions.length <= 1) {
    return { decisions: params.decisions };
  }

  const reason = `Forced kill: 14d kill-rate ${(params.killRate14d.rate * 100).toFixed(
    1,
  )}% below floor ${(floor * 100).toFixed(1)}%`;
  const updated = params.decisions.map((decision) =>
    decision.projectId === candidate.projectId
      ? {
          ...decision,
          action: "kill" as const,
          targetHours: 0,
          targetCashUsd: 0,
          reasons: [...decision.reasons, reason],
        }
      : decision,
  );
  return { decisions: updated, forcedProjectId: candidate.projectId };
}

export async function runBaselineSnapshot(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
}): Promise<{ reportPath: string; snapshot: RevenueBaselineSnapshot; configPath: string }> {
  const now = params?.now ?? Date.now();
  const { config, configPath, paths } = await initializeRevenue(params);

  const opportunities = await readJsonlFile<RevenueOpportunityRecord>(paths.opportunitiesPath);
  const experiments = await readJsonFile<RevenueExperimentRecord[]>(paths.experimentsPath, []);
  const approvals = await readApprovalState(paths.approvalQueuePath);
  const orders = await readJsonFile<RevenueOrder[]>(paths.ordersPath, []);
  const events = await readJsonlFile<RevenueLedgerEvent>(paths.ledgerPath);

  const totals7d = summarizeLedgerTotals({ events, now, windowDays: 7 });
  const approvalsResolved24hCount = approvals.latest.filter((item) => {
    if (item.updatedAt < now - 24 * 60 * 60 * 1000) {
      return false;
    }
    return item.status === "approved" || item.status === "rejected" || item.status === "sent";
  }).length;

  const snapshot: RevenueBaselineSnapshot = {
    generatedAt: now,
    opportunitiesCount: opportunities.length,
    activeExperimentsCount: experiments.filter((experiment) => experiment.status === "active")
      .length,
    approvalsPendingCount: approvals.latest.filter((item) => item.status === "pending").length,
    approvalsResolved24hCount,
    ordersQueuedCount: orders.filter((order) => order.status === "queued").length,
    revenueLast7dUsd: totals7d.revenueUsd,
    cashSpentLast7dUsd: totals7d.cashSpentUsd,
    hoursLast7d: totals7d.hoursSpent,
  };

  const lines: string[] = [];
  lines.push(`# Revenue Baseline ${dateStamp(new Date(now))}`);
  lines.push("");
  lines.push(`Generated: ${isoTimestamp(now)}`);
  lines.push(`Config: ${configPath}`);
  lines.push("");
  lines.push("## Current State");
  lines.push(`- Opportunities scored: ${snapshot.opportunitiesCount}`);
  lines.push(`- Active experiments: ${snapshot.activeExperimentsCount}`);
  lines.push(`- Pending approvals: ${snapshot.approvalsPendingCount}`);
  lines.push(`- Approvals resolved in last 24h: ${snapshot.approvalsResolved24hCount}`);
  lines.push(`- Queued orders: ${snapshot.ordersQueuedCount}`);
  lines.push(`- Revenue (7d): $${snapshot.revenueLast7dUsd.toFixed(2)}`);
  lines.push(`- Cash spent (7d): $${snapshot.cashSpentLast7dUsd.toFixed(2)}`);
  lines.push(`- Hours logged (7d): ${snapshot.hoursLast7d.toFixed(2)}h`);
  lines.push("");
  lines.push("## Start Here (under 48h)");
  lines.push(
    ...markdownList([
      "Run daily demand scan and target at least five scored opportunities per day.",
      "Run daily outreach batch with strict cap (10 max drafts/day).",
      "Offer one services-first SKU immediately and route all drafts through one approval batch.",
    ]),
  );
  lines.push("");
  lines.push("## Configured Service SKUs");
  for (const service of config.services) {
    lines.push(`- ${service.name}: $${service.priceUsd} (${service.turnaroundHours}h)`);
  }

  const reportPath = path.join(paths.reportsDir, `baseline-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));
  return { reportPath, snapshot, configPath };
}

export async function runDailyDemandScan(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  consumeInbox?: boolean;
  limit?: number;
  now?: number;
}): Promise<{
  reportPath: string;
  processed: number;
  inserted: number;
  duplicates: number;
  goCount: number;
  watchCount: number;
  noGoCount: number;
}> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);

  const candidates = await readJsonlFile<RevenueOpportunityCandidate>(
    paths.opportunityCandidatesPath,
  );
  const limit = Math.max(1, (params?.limit ?? candidates.length) || 1);
  const toProcess = candidates.slice(0, limit);
  const remaining = candidates.slice(limit);

  const existing = await readJsonlFile<RevenueOpportunityRecord>(paths.opportunitiesPath);
  const seenIds = new Set(existing.map((item) => item.id));
  const seenKeys = new Set(
    existing.map((item) => `${item.title.trim().toLowerCase()}::${item.source ?? ""}`),
  );

  const scoredRows: RevenueOpportunityRecord[] = [];
  let duplicates = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const candidate = toProcess[i];
    const candidateKey = `${candidate.title.trim().toLowerCase()}::${candidate.source ?? ""}`;
    const provisional = scoreOpportunity(candidate, config, now + i);
    if (seenIds.has(provisional.id) || seenKeys.has(candidateKey)) {
      duplicates += 1;
      continue;
    }
    seenIds.add(provisional.id);
    seenKeys.add(candidateKey);
    scoredRows.push(provisional);
  }

  if (scoredRows.length > 0) {
    await appendJsonlLines(paths.opportunitiesPath, scoredRows);
  }

  const ledgerEvents: RevenueLedgerEvent[] = [];
  for (const scored of scoredRows) {
    ledgerEvents.push(
      createLedgerEvent({
        type: "opportunity_scored",
        projectId: scored.projectId ?? "unassigned",
        opportunityId: scored.id,
        ts: scored.createdAt,
        metadata: {
          score: scored.score,
          source: scored.source ?? "unknown",
        },
      }),
    );
    ledgerEvents.push(
      createLedgerEvent({
        type: "decision_made",
        projectId: scored.projectId ?? "unassigned",
        opportunityId: scored.id,
        ts: scored.createdAt,
        decision: scored.decision,
        metadata: {
          score: scored.score,
          forcedDecision: scored.forcedDecision,
        },
      }),
    );
  }
  if (ledgerEvents.length > 0) {
    await appendJsonlLines(paths.ledgerPath, ledgerEvents);
  }

  if (params?.consumeInbox) {
    await resetJsonlFile(paths.opportunityCandidatesPath);
    if (remaining.length > 0) {
      await appendJsonlLines(paths.opportunityCandidatesPath, remaining);
    }
  }

  const goCount = scoredRows.filter((row) => row.decision === "go").length;
  const watchCount = scoredRows.filter((row) => row.decision === "watch").length;
  const noGoCount = scoredRows.filter((row) => row.decision === "no-go").length;

  const lines: string[] = [];
  lines.push(`# Demand Scan ${dateStamp(new Date(now))}`);
  lines.push("");
  lines.push(`Processed candidates: ${toProcess.length}`);
  lines.push(`Inserted opportunities: ${scoredRows.length}`);
  lines.push(`Duplicates skipped: ${duplicates}`);
  lines.push(`Go / Watch / No-Go: ${goCount} / ${watchCount} / ${noGoCount}`);
  lines.push("");
  if (scoredRows.length < config.ops.minOpportunitiesScoredPerDay) {
    lines.push(
      `- Warning: scored ${scoredRows.length}, below minimum ${config.ops.minOpportunitiesScoredPerDay}. Rotate sources next run.`,
    );
  } else {
    lines.push(
      `- Throughput target met (${config.ops.minOpportunitiesScoredPerDay}+ opportunities/day).`,
    );
  }

  const reportPath = path.join(paths.reportsDir, `demand-scan-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));

  return {
    reportPath,
    processed: toProcess.length,
    inserted: scoredRows.length,
    duplicates,
    goCount,
    watchCount,
    noGoCount,
  };
}

export async function runDailyOutreachBatch(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
  maxDrafts?: number;
}): Promise<{
  reportPath: string;
  drafted: number;
  autoApproved: number;
  pending: number;
  rejected: number;
}> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const opportunities = await readJsonlFile<RevenueOpportunityRecord>(paths.opportunitiesPath);
  const approvals = await readApprovalState(paths.approvalQueuePath);

  const existingOpportunityIds = new Set(
    approvals.latest
      .filter(
        (item) =>
          item.status === "pending" ||
          item.status === "approved" ||
          item.status === "sent" ||
          item.status === "delivered",
      )
      .map((item) => item.opportunityId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  const maxDrafts = Math.min(
    params?.maxDrafts ?? config.ops.maxOutboundDraftsPerDay,
    config.outboundCompliance.maxSendsPerDay,
  );

  const candidates = opportunities
    .filter((item) => item.decision === "go")
    .filter((item) => !existingOpportunityIds.has(item.id))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, maxDrafts);

  const newItems: RevenueApprovalItem[] = [];
  const ledgerEvents: RevenueLedgerEvent[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const createdAt = now + i;
    const sku = config.services[0];
    const draft = {
      targetPersona: candidate.niche ?? "Operator",
      offer: `${sku.name} ($${sku.priceUsd})`,
      claimSupport: candidate.reasons.join("; "),
      optOut: "Reply STOP to opt out.",
      personalization: `Reference: ${candidate.title}`,
    };

    const item = createApprovalItem({
      kind: "outreach_draft",
      title: `Outreach: ${candidate.title}`,
      projectId: candidate.projectId ?? "unassigned",
      opportunityId: candidate.id,
      draft,
      createdAt,
    });

    const autoDecision = autoResolveApproval({ item, config });
    const resolved = updateApprovalStatus({
      item,
      status: autoDecision.status,
      reason: autoDecision.reason,
      now: createdAt,
    });

    newItems.push(resolved);
    ledgerEvents.push(
      createLedgerEvent({
        type: "decision_made",
        projectId: resolved.projectId,
        opportunityId: resolved.opportunityId,
        ts: createdAt,
        decision: "go",
        metadata: {
          kind: "approval",
          status: resolved.status,
        },
        notes: resolved.title,
      }),
    );
  }

  if (newItems.length > 0) {
    await appendJsonlLines(paths.approvalQueuePath, newItems);
  }
  if (ledgerEvents.length > 0) {
    await appendJsonlLines(paths.ledgerPath, ledgerEvents);
  }

  const batchMarkdown = buildApprovalBatchMarkdown({
    date: dateStamp(new Date(now)),
    items: newItems,
    maxApprovalMinutes: config.ops.maxApprovalMinutesPerDay,
  });

  const reportPath = path.join(paths.reportsDir, `approval-batch-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, batchMarkdown);

  return {
    reportPath,
    drafted: newItems.length,
    autoApproved: newItems.filter((item) => item.status === "approved").length,
    pending: newItems.filter((item) => item.status === "pending").length,
    rejected: newItems.filter((item) => item.status === "rejected").length,
  };
}

function buildDeliverableMarkdown(params: {
  order: RevenueOrder;
  skuName: string;
  now: number;
}): string {
  return [
    `# Deliverable ${params.order.id}`,
    "",
    `- Client: ${params.order.clientName}`,
    `- SKU: ${params.skuName}`,
    `- Project: ${params.order.projectId}`,
    `- Amount: $${params.order.amountUsd.toFixed(2)}`,
    `- Generated: ${isoTimestamp(params.now)}`,
    "",
    "## Brief",
    params.order.brief?.trim() || "No client brief provided.",
    "",
    "## Output",
    "- Summary",
    "- Recommended actions",
    "- Next-step offer",
    "",
    "## QA Checklist",
    "- [ ] Deliverable complete",
    "- [ ] Claims supported",
    "- [ ] File links added",
  ].join("\n");
}

export async function runWeekdayDeliveryBatch(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
  limit?: number;
}): Promise<{
  reportPath: string;
  generated: number;
  approvalsQueued: number;
}> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const orders = await readJsonFile<RevenueOrder[]>(paths.ordersPath, []);
  const limit = Math.max(1, params?.limit ?? 10);

  const queued = orders.filter((order) => order.status === "queued").slice(0, limit);
  const ledgerEvents: RevenueLedgerEvent[] = [];
  const approvalItems: RevenueApprovalItem[] = [];

  for (let i = 0; i < queued.length; i++) {
    const order = queued[i];
    const sku = config.services.find((service) => service.id === order.skuId) ??
      config.services[0] ?? {
        id: "custom",
        name: "Custom Deliverable",
        priceUsd: order.amountUsd,
        turnaroundHours: 24,
        description: "",
      };
    const createdAt = now + i;
    const filePath = path.join(paths.deliverablesDir, `${order.id}.md`);
    await writeMarkdownFile(
      filePath,
      buildDeliverableMarkdown({ order, skuName: sku.name, now: createdAt }),
    );

    const approval = createApprovalItem({
      kind: "deliverable",
      title: `Deliverable QA: ${order.id}`,
      projectId: order.projectId,
      draft: {
        deliverable: filePath,
        qaChecklist: "Claims + completeness + client brief alignment",
      },
      createdAt,
    });
    const resolved = autoResolveApproval({ item: approval, config });
    approvalItems.push(
      updateApprovalStatus({
        item: approval,
        status: resolved.status,
        reason: resolved.reason,
        now: createdAt,
      }),
    );

    order.status = "in_progress";
    order.updatedAt = createdAt;

    ledgerEvents.push(
      createLedgerEvent({
        type: "time_spent",
        projectId: order.projectId,
        ts: createdAt,
        hours: Math.max(0.25, Math.min(4, sku.turnaroundHours / 24)),
        notes: `Generated deliverable draft for ${order.id}`,
      }),
    );
  }

  if (queued.length > 0) {
    await writeJsonFile(paths.ordersPath, orders);
  }
  if (approvalItems.length > 0) {
    await appendJsonlLines(paths.approvalQueuePath, approvalItems);
  }
  if (ledgerEvents.length > 0) {
    await appendJsonlLines(paths.ledgerPath, ledgerEvents);
  }

  const lines: string[] = [];
  lines.push(`# Delivery Batch ${dateStamp(new Date(now))}`);
  lines.push("");
  lines.push(`- Generated deliverables: ${queued.length}`);
  lines.push(`- Approval items queued: ${approvalItems.length}`);
  lines.push(`- Orders moved to in_progress: ${queued.length}`);
  const reportPath = path.join(paths.reportsDir, `delivery-batch-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));

  return {
    reportPath,
    generated: queued.length,
    approvalsQueued: approvalItems.length,
  };
}

export async function runDailyRevenueReport(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
}): Promise<{ reportPath: string; summary: ReturnType<typeof summarizeDailyLedger> }> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const events = await readJsonlFile<RevenueLedgerEvent>(paths.ledgerPath);
  const orders = await readJsonFile<RevenueOrder[]>(paths.ordersPath, []);
  const approvals = await readApprovalState(paths.approvalQueuePath);

  const summary = summarizeDailyLedger({ events, now, windowHours: 24 });
  const pipelineValue = orders
    .filter((order) => order.status !== "delivered")
    .reduce((sum, order) => sum + order.amountUsd, 0);
  const pendingApprovals = approvals.latest.filter((item) => item.status === "pending").length;
  const replyMetrics = computeReplyMetrics(events);

  const timeByProject = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "time_spent") {
      continue;
    }
    if (event.ts < now - 24 * 60 * 60 * 1000 || event.ts > now) {
      continue;
    }
    const current = timeByProject.get(event.projectId) ?? 0;
    timeByProject.set(event.projectId, current + (event.hours ?? 0));
  }

  const blockers: string[] = [];
  if (summary.goCount === 0) {
    blockers.push("No go opportunities generated in the last 24h");
  }
  if (summary.paidSignals === 0) {
    blockers.push("No paid signal in the last 24h");
  }
  if (pendingApprovals > config.ops.maxOutboundDraftsPerDay) {
    blockers.push("Approval backlog exceeds one daily batch");
  }

  const nextFocus: string[] = [];
  if (summary.goCount === 0) {
    nextFocus.push("Increase demand scan quality and prioritize higher-margin niches");
  }
  if (summary.paidSignals === 0) {
    nextFocus.push("Route top go opportunities into outbound batch within 24h");
  }
  if (pendingApprovals > 0) {
    nextFocus.push("Clear pending approvals within the 20-minute cap");
  }
  if (nextFocus.length === 0) {
    nextFocus.push("Scale highest adjusted-score project in weekly review");
  }

  const lines: string[] = [];
  lines.push(`# Daily Revenue Report ${dateStamp(new Date(now))}`);
  lines.push("");
  lines.push(`- Revenue received: $${summary.revenueUsd.toFixed(2)}`);
  lines.push(`- Cash spent: $${summary.cashSpentUsd.toFixed(2)}`);
  lines.push(`- Time spent: ${summary.hoursSpent.toFixed(2)}h`);
  lines.push(`- Opportunities scored: ${summary.opportunitiesScored}`);
  lines.push(
    `- Go / Watch / No-Go: ${summary.goCount} / ${summary.watchCount} / ${summary.noGoCount}`,
  );
  lines.push(`- Pipeline value: $${pipelineValue.toFixed(2)}`);
  lines.push(`- Reply rate: ${(replyMetrics.replyRate * 100).toFixed(1)}%`);
  lines.push(`- Conversion rate: ${(replyMetrics.conversionRate * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("## Time by Project (24h)");
  if (timeByProject.size === 0) {
    lines.push("- none");
  } else {
    for (const [projectId, hours] of [...timeByProject.entries()].toSorted((a, b) => b[1] - a[1])) {
      lines.push(`- ${projectId}: ${hours.toFixed(2)}h`);
    }
  }
  lines.push("");
  lines.push("## Top Blockers");
  lines.push(...markdownList(blockers));
  lines.push("");
  lines.push("## Next-Day Focus");
  lines.push(...markdownList(nextFocus));

  const reportPath = path.join(paths.reportsDir, `daily-revenue-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));

  return { reportPath, summary };
}

export type RevenueDailyRoutineResult = {
  demand: Awaited<ReturnType<typeof runDailyDemandScan>>;
  seed: Awaited<ReturnType<typeof seedExperimentFromTopGoOpportunity>>;
  outreach: Awaited<ReturnType<typeof runDailyOutreachBatch>>;
  delivery: Awaited<ReturnType<typeof runWeekdayDeliveryBatch>>;
  evaluate: Awaited<ReturnType<typeof runExperimentEvaluation>>;
  report: Awaited<ReturnType<typeof runDailyRevenueReport>>;
};

export async function runRevenueDailyRoutine(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
  demandLimit?: number;
  outreachMaxDrafts?: number;
  deliveryLimit?: number;
  keepInbox?: boolean;
}): Promise<RevenueDailyRoutineResult> {
  const demand = await runDailyDemandScan({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
    consumeInbox: params?.keepInbox !== true,
    limit: params?.demandLimit,
  });
  const seed = await seedExperimentFromTopGoOpportunity({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
  });
  const outreach = await runDailyOutreachBatch({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
    maxDrafts: params?.outreachMaxDrafts,
  });
  const delivery = await runWeekdayDeliveryBatch({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
    limit: params?.deliveryLimit,
  });
  const evaluate = await runExperimentEvaluation({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
  });
  const report = await runDailyRevenueReport({
    env: params?.env,
    stateDir: params?.stateDir,
    revenueRootDir: params?.revenueRootDir,
    now: params?.now,
  });

  return { demand, seed, outreach, delivery, evaluate, report };
}

type RevenueManualLedgerEventType = Extract<
  RevenueLedgerEventType,
  "revenue_received" | "cash_spent" | "time_spent"
>;

export async function recordRevenueLedgerEvent(params: {
  type: RevenueManualLedgerEventType;
  projectId: string;
  amountUsd?: number;
  hours?: number;
  notes?: string;
  experimentId?: string;
  ts?: number;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
}): Promise<{ ledgerPath: string; event: RevenueLedgerEvent }> {
  const { paths } = await initializeRevenue(params);
  const projectId = params.projectId.trim();
  if (!projectId) {
    throw new Error("projectId is required");
  }

  if (params.type === "time_spent") {
    if (typeof params.hours !== "number" || !Number.isFinite(params.hours) || params.hours <= 0) {
      throw new Error("hours must be a positive number");
    }
  } else if (
    typeof params.amountUsd !== "number" ||
    !Number.isFinite(params.amountUsd) ||
    params.amountUsd <= 0
  ) {
    throw new Error("amountUsd must be a positive number");
  }

  const event = createLedgerEvent({
    type: params.type,
    projectId,
    experimentId: params.experimentId,
    amountUsd: params.amountUsd,
    hours: params.hours,
    ts: params.ts ?? Date.now(),
    notes: params.notes,
    metadata: { source: "telegram_command" },
  });
  await appendJsonlLine(paths.ledgerPath, event);

  return { ledgerPath: paths.ledgerPath, event };
}

export async function runWeeklyCapitalReview(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
}): Promise<{
  reportPath: string;
  decisions: RevenueAllocationDecision[];
  cashBufferUsd: number;
}> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const events = await readJsonlFile<RevenueLedgerEvent>(paths.ledgerPath);
  const experiments = await readJsonFile<RevenueExperimentRecord[]>(paths.experimentsPath, []);

  const lifetimeTotals = summarizeLedgerTotals({ events, now, windowDays: 3650 });
  const cashBufferUsd =
    config.capitalLimits.startingCapitalUsd -
    lifetimeTotals.cashSpentUsd +
    lifetimeTotals.revenueUsd;

  const snapshots = buildProjectSnapshots({ events, experiments, config, now, windowDays: 7 });
  const baseDecisions = allocateWeeklyCapital({
    projects: snapshots,
    config,
    cashBufferUsd,
  });
  const killRate14d = computeKillRate14d({ experiments, now });
  const killRateEnforcement = enforceKillRateFloor({
    decisions: baseDecisions,
    config,
    killRate14d,
  });
  const decisions = killRateEnforcement.decisions;

  for (const decision of decisions) {
    await appendJsonlLine(paths.allocationsPath, {
      ...decision,
      ts: now,
    });
    await appendJsonlLine(
      paths.ledgerPath,
      createLedgerEvent({
        type: "allocation_decided",
        projectId: decision.projectId,
        ts: now,
        metadata: {
          action: decision.action,
          adjustedScore: decision.adjustedScore,
          targetHours: decision.targetHours,
          targetCashUsd: decision.targetCashUsd,
        },
        notes: decision.reasons.join("; "),
      }),
    );
  }

  const lines: string[] = [];
  lines.push(`# Weekly Capital Review ${dateStamp(new Date(now))}`);
  lines.push("");
  lines.push(`- Cash buffer: $${cashBufferUsd.toFixed(2)}`);
  lines.push(`- Weekly cash cap: $${config.capitalLimits.maxWeeklyCashBurnUsd.toFixed(2)}`);
  lines.push(`- Weekly time cap: ${config.capitalLimits.maxWeeklyHours.toFixed(2)}h`);
  lines.push(
    `- Max per-project share: ${(config.capitalLimits.maxProjectShare * 100).toFixed(0)}%`,
  );
  lines.push(
    `- Post-signal focus share: ${(config.capitalLimits.postSignalTopShare * 100).toFixed(0)}%`,
  );
  lines.push(
    `- 14d kill rate: ${(killRate14d.rate * 100).toFixed(1)}% (${killRate14d.killed}/${killRate14d.considered})`,
  );
  lines.push(`- Kill-rate floor: ${(config.ops.minKillRate14d * 100).toFixed(1)}%`);
  if (killRateEnforcement.forcedProjectId) {
    lines.push(`- Forced kill project: ${killRateEnforcement.forcedProjectId}`);
  }
  lines.push("");
  lines.push("## Decisions");
  if (decisions.length === 0) {
    lines.push("- none");
  } else {
    for (const decision of decisions) {
      lines.push(
        `- ${decision.projectId}: ${decision.action.toUpperCase()} | adjusted=${decision.adjustedScore.toFixed(
          1,
        )} | roi=${decision.roiScore.toFixed(1)} | liquidity=${decision.liquidityScore.toFixed(
          1,
        )} | time=${decision.targetHours.toFixed(1)}h | cash=$${decision.targetCashUsd.toFixed(2)}`,
      );
      for (const reason of decision.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
  }

  const reportPath = path.join(paths.reportsDir, `weekly-capital-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));
  return { reportPath, decisions, cashBufferUsd };
}

export async function runExperimentEvaluation(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
}): Promise<{
  reportPath: string;
  evaluated: number;
  passed: number;
  killed: number;
  held: number;
}> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const experiments = await readJsonFile<RevenueExperimentRecord[]>(paths.experimentsPath, []);

  let evaluated = 0;
  let passed = 0;
  let killed = 0;
  let held = 0;

  const updatedExperiments: RevenueExperimentRecord[] = [];
  const ledgerEvents: RevenueLedgerEvent[] = [];

  for (const experiment of experiments) {
    if (experiment.status !== "active") {
      updatedExperiments.push(experiment);
      continue;
    }

    const startedAt = experiment.startedAt ?? experiment.createdAt;
    const ageDays = (now - startedAt) / (24 * 60 * 60 * 1000);
    let checkpoint: "day7" | "day14" | null = null;

    if (ageDays >= 14) {
      checkpoint = "day14";
    } else if (ageDays >= 7) {
      checkpoint = "day7";
    }

    if (!checkpoint) {
      updatedExperiments.push(experiment);
      continue;
    }

    evaluated += 1;
    const evaluation = evaluateExperiment({
      experiment,
      checkpoint,
      config,
    });

    if (evaluation.decision === "pass") {
      passed += 1;
    } else if (evaluation.decision === "kill") {
      killed += 1;
    } else {
      held += 1;
    }

    const updated = applyExperimentUpdate({
      experiment,
      status: evaluation.nextStatus,
      notes: evaluation.reasons.join("; "),
      now,
    });
    updatedExperiments.push(updated);

    if (updated.status !== experiment.status) {
      ledgerEvents.push(
        createLedgerEvent({
          type: "experiment_status_changed",
          projectId: updated.projectId,
          experimentId: updated.id,
          ts: now,
          fromStatus: experiment.status,
          toStatus: updated.status,
          notes: evaluation.reasons.join("; "),
        }),
      );
    }
  }

  if (updatedExperiments.length > 0) {
    await writeJsonFile(paths.experimentsPath, updatedExperiments);
  }
  if (ledgerEvents.length > 0) {
    await appendJsonlLines(paths.ledgerPath, ledgerEvents);
  }

  const lines = [
    `# Experiment Evaluation ${dateStamp(new Date(now))}`,
    "",
    `- Evaluated: ${evaluated}`,
    `- Passed: ${passed}`,
    `- Killed: ${killed}`,
    `- Held: ${held}`,
  ];

  const reportPath = path.join(paths.reportsDir, `experiment-eval-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(reportPath, lines.join("\n"));

  return { reportPath, evaluated, passed, killed, held };
}

export async function seedExperimentFromTopGoOpportunity(params?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  revenueRootDir?: string;
  now?: number;
}): Promise<{ created: boolean; experimentId?: string; reportPath: string }> {
  const now = params?.now ?? Date.now();
  const { config, paths } = await initializeRevenue(params);
  const opportunities = await readJsonlFile<RevenueOpportunityRecord>(paths.opportunitiesPath);
  const experiments = await readJsonFile<RevenueExperimentRecord[]>(paths.experimentsPath, []);

  const existingOpportunityIds = new Set(
    experiments
      .map((experiment) => experiment.sourceOpportunityId)
      .filter((value): value is string => typeof value === "string"),
  );

  const candidate = opportunities
    .filter((item) => item.decision === "go")
    .filter((item) => !existingOpportunityIds.has(item.id))
    .toSorted((a, b) => b.score - a.score)
    .at(0);

  if (!candidate) {
    const reportPath = path.join(
      paths.reportsDir,
      `experiment-seed-${dateStamp(new Date(now))}.md`,
    );
    await writeMarkdownFile(
      reportPath,
      [
        `# Experiment Seed ${dateStamp(new Date(now))}`,
        "",
        "- No eligible GO opportunity found.",
      ].join("\n"),
    );
    return { created: false, reportPath };
  }

  const experiment = createExperimentFromTemplate({
    projectId: candidate.projectId ?? "unassigned",
    title: `Validate: ${candidate.title}`,
    template: "outbound",
    config,
    sourceOpportunityId: candidate.id,
    expectedDaysToFirstRevenue: candidate.expectedDaysToFirstRevenue,
    paybackTargetDays: candidate.paybackDaysEstimate,
    now,
  });

  experiments.push(experiment);
  await writeJsonFile(paths.experimentsPath, experiments);

  await appendJsonlLine(
    paths.ledgerPath,
    createLedgerEvent({
      type: "experiment_status_changed",
      projectId: experiment.projectId,
      experimentId: experiment.id,
      ts: now,
      fromStatus: "planned",
      toStatus: "active",
      notes: `Seeded from opportunity ${candidate.id}`,
    }),
  );

  const reportPath = path.join(paths.reportsDir, `experiment-seed-${dateStamp(new Date(now))}.md`);
  await writeMarkdownFile(
    reportPath,
    [
      `# Experiment Seed ${dateStamp(new Date(now))}`,
      "",
      `- Created experiment: ${experiment.id}`,
      `- Source opportunity: ${candidate.id}`,
      `- Project: ${experiment.projectId}`,
    ].join("\n"),
  );

  return { created: true, experimentId: experiment.id, reportPath };
}
