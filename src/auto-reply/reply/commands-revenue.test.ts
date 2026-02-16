import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import {
  configureRevenueAutopilot,
  getRevenueAutopilotState,
  runRevenueAutopilotIfDue,
} from "../../revenue/autopilot.js";
import {
  recordRevenueLedgerEvent,
  runBaselineSnapshot,
  runDailyDemandScan,
  runDailyOutreachBatch,
  runDailyRevenueReport,
  runExperimentEvaluation,
  runRevenueDailyRoutine,
  runWeekdayDeliveryBatch,
  runWeeklyCapitalReview,
  seedExperimentFromTopGoOpportunity,
} from "../../revenue/jobs.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

vi.mock("../../revenue/jobs.js", () => ({
  runBaselineSnapshot: vi.fn(async () => ({
    reportPath: "/tmp/revenue/baseline.md",
    configPath: "/tmp/revenue/config.json",
    snapshot: {
      generatedAt: 1,
      opportunitiesCount: 12,
      activeExperimentsCount: 2,
      approvalsPendingCount: 3,
      approvalsResolved24hCount: 4,
      ordersQueuedCount: 1,
      revenueLast7dUsd: 120,
      cashSpentLast7dUsd: 45,
      hoursLast7d: 6,
    },
  })),
  runDailyDemandScan: vi.fn(async () => ({
    reportPath: "/tmp/revenue/demand.md",
    processed: 10,
    inserted: 8,
    duplicates: 2,
    goCount: 3,
    watchCount: 4,
    noGoCount: 1,
  })),
  runDailyOutreachBatch: vi.fn(async () => ({
    reportPath: "/tmp/revenue/outreach.md",
    drafted: 5,
    autoApproved: 3,
    pending: 1,
    rejected: 1,
  })),
  runWeekdayDeliveryBatch: vi.fn(async () => ({
    reportPath: "/tmp/revenue/delivery.md",
    generated: 2,
    approvalsQueued: 2,
  })),
  runDailyRevenueReport: vi.fn(async () => ({
    reportPath: "/tmp/revenue/report.md",
    summary: {
      revenueUsd: 100,
      cashSpentUsd: 25,
      hoursSpent: 3,
      opportunitiesScored: 7,
      goCount: 2,
      watchCount: 3,
      noGoCount: 2,
      paidSignals: 1,
    },
  })),
  runWeeklyCapitalReview: vi.fn(async () => ({
    reportPath: "/tmp/revenue/weekly.md",
    cashBufferUsd: 900,
    decisions: [
      {
        projectId: "svc-main",
        roiScore: 70,
        liquidityScore: 80,
        adjustedScore: 74,
        action: "hold",
        targetHours: 8,
        targetCashUsd: 100,
        reasons: ["Meets hold threshold"],
      },
    ],
  })),
  runExperimentEvaluation: vi.fn(async () => ({
    reportPath: "/tmp/revenue/evaluate.md",
    evaluated: 3,
    passed: 1,
    killed: 1,
    held: 1,
  })),
  runRevenueDailyRoutine: vi.fn(async () => ({
    demand: {
      reportPath: "/tmp/revenue/demand.md",
      processed: 10,
      inserted: 8,
      duplicates: 2,
      goCount: 3,
      watchCount: 4,
      noGoCount: 1,
    },
    seed: {
      created: true,
      experimentId: "exp-1",
      reportPath: "/tmp/revenue/seed.md",
    },
    outreach: {
      reportPath: "/tmp/revenue/outreach.md",
      drafted: 5,
      autoApproved: 3,
      pending: 1,
      rejected: 1,
    },
    delivery: {
      reportPath: "/tmp/revenue/delivery.md",
      generated: 2,
      approvalsQueued: 2,
    },
    evaluate: {
      reportPath: "/tmp/revenue/evaluate.md",
      evaluated: 3,
      passed: 1,
      killed: 1,
      held: 1,
    },
    report: {
      reportPath: "/tmp/revenue/report.md",
      summary: {
        revenueUsd: 100,
        cashSpentUsd: 25,
        hoursSpent: 3,
        opportunitiesScored: 7,
        goCount: 2,
        watchCount: 3,
        noGoCount: 2,
        paidSignals: 1,
      },
    },
  })),
  recordRevenueLedgerEvent: vi.fn(async () => ({
    ledgerPath: "/tmp/revenue/ledger.jsonl",
    event: {
      id: "evt1",
      ts: 1,
      type: "revenue_received",
      projectId: "svc-main",
      amountUsd: 149,
    },
  })),
  seedExperimentFromTopGoOpportunity: vi.fn(async () => ({
    created: true,
    experimentId: "exp-1",
    reportPath: "/tmp/revenue/seed.md",
  })),
}));

vi.mock("../../revenue/autopilot.js", () => ({
  getRevenueAutopilotState: vi.fn(async () => ({
    enabled: true,
    demandLimit: 12,
    outreachMaxDrafts: 6,
    deliveryLimit: 4,
    keepInbox: false,
    lastDailyRunDate: "2026-02-16",
    lastWeeklyRunKey: "2026-W08",
    lastError: undefined,
  })),
  configureRevenueAutopilot: vi.fn(async () => ({
    enabled: true,
    demandLimit: 12,
    outreachMaxDrafts: 6,
    deliveryLimit: 4,
    keepInbox: false,
  })),
  runRevenueAutopilotIfDue: vi.fn(async () => ({
    state: {
      enabled: true,
      demandLimit: 12,
      outreachMaxDrafts: 6,
      deliveryLimit: 4,
      keepInbox: false,
    },
    ranDaily: true,
    ranWeekly: false,
    errors: [],
  })),
}));

type CommandsParams = Parameters<typeof handleCommands>[0];

function buildParams(commandBody: string, commandAuthorized = true): CommandsParams {
  const cfg = {
    commands: { text: true },
    channels: { telegram: { allowFrom: ["*"] } },
  } as OpenClawConfig;

  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: commandAuthorized,
    Provider: "telegram",
    Surface: "telegram",
    SenderId: "123456",
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: process.cwd(),
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "telegram",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("handleRevenueCommand", () => {
  it("shows usage for /revenue", async () => {
    const result = await handleCommands(buildParams("/revenue"));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Revenue command usage");
  });

  it("shows checklist guidance", async () => {
    const result = await handleCommands(buildParams("/revenue checklist"));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Revenue checklist (simple)");
    expect(result.reply?.text).toContain("/revenue daily");
  });

  it("runs baseline action", async () => {
    const result = await handleCommands(buildParams("/revenue baseline"));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Revenue baseline complete");
    expect(runBaselineSnapshot).toHaveBeenCalledOnce();
  });

  it("runs demand action with limit", async () => {
    const result = await handleCommands(buildParams("/revenue demand --limit 9"));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Revenue demand scan complete");
    expect(runDailyDemandScan).toHaveBeenCalledWith({
      consumeInbox: true,
      limit: 9,
    });
  });

  it("ignores unauthorized /revenue", async () => {
    const result = await handleCommands(buildParams("/revenue baseline", false));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("routes remaining actions", async () => {
    await handleCommands(buildParams("/revenue outreach"));
    await handleCommands(buildParams("/revenue delivery"));
    await handleCommands(buildParams("/revenue report"));
    await handleCommands(buildParams("/revenue weekly"));
    await handleCommands(buildParams("/revenue seed"));
    await handleCommands(buildParams("/revenue evaluate"));
    await handleCommands(buildParams("/revenue paid svc-main 149 pilot"));

    expect(runDailyOutreachBatch).toHaveBeenCalled();
    expect(runWeekdayDeliveryBatch).toHaveBeenCalled();
    expect(runDailyRevenueReport).toHaveBeenCalled();
    expect(runWeeklyCapitalReview).toHaveBeenCalled();
    expect(seedExperimentFromTopGoOpportunity).toHaveBeenCalled();
    expect(runExperimentEvaluation).toHaveBeenCalled();
    expect(recordRevenueLedgerEvent).toHaveBeenCalledWith({
      type: "revenue_received",
      projectId: "svc-main",
      amountUsd: 149,
      notes: "pilot",
    });
  });

  it("runs daily routine with options", async () => {
    vi.mocked(runRevenueDailyRoutine).mockClear();

    const result = await handleCommands(
      buildParams("/revenue daily --limit 12 --max-drafts 6 --delivery-limit 4 --keep-inbox"),
    );

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Revenue daily routine complete.");
    expect(runRevenueDailyRoutine).toHaveBeenCalledWith({
      keepInbox: true,
      demandLimit: 12,
      outreachMaxDrafts: 6,
      deliveryLimit: 4,
    });
  });

  it("supports autopilot commands", async () => {
    const status = await handleCommands(buildParams("/revenue autopilot status"));
    const enable = await handleCommands(
      buildParams("/revenue autopilot on --limit 12 --max-drafts 6 --delivery-limit 4"),
    );
    const disable = await handleCommands(buildParams("/revenue autopilot off"));

    expect(status.reply?.text).toContain("Revenue autopilot status");
    expect(enable.reply?.text).toContain("Revenue autopilot enabled");
    expect(disable.reply?.text).toContain("Revenue autopilot disabled");
    expect(getRevenueAutopilotState).toHaveBeenCalled();
    expect(configureRevenueAutopilot).toHaveBeenCalled();
    expect(runRevenueAutopilotIfDue).toHaveBeenCalled();
  });

  it("validates paid usage args", async () => {
    const result = await handleCommands(buildParams("/revenue paid svc-main nope"));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Usage: /revenue paid");
  });
});
