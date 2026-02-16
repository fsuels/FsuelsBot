import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./jobs.js", () => ({
  runRevenueDailyRoutine: vi.fn(async () => ({
    demand: {
      reportPath: "",
      processed: 1,
      inserted: 1,
      duplicates: 0,
      goCount: 1,
      watchCount: 0,
      noGoCount: 0,
    },
    seed: { created: true, reportPath: "", experimentId: "exp-1" },
    outreach: { reportPath: "", drafted: 1, autoApproved: 1, pending: 0, rejected: 0 },
    delivery: { reportPath: "", generated: 1, approvalsQueued: 0 },
    evaluate: { reportPath: "", evaluated: 1, passed: 1, killed: 0, held: 0 },
    report: {
      reportPath: "",
      summary: {
        revenueUsd: 100,
        cashSpentUsd: 10,
        hoursSpent: 1,
        opportunitiesScored: 1,
        goCount: 1,
        watchCount: 0,
        noGoCount: 0,
        paidSignals: 1,
      },
    },
  })),
  runWeeklyCapitalReview: vi.fn(async () => ({
    reportPath: "",
    decisions: [],
    cashBufferUsd: 900,
  })),
}));

import {
  configureRevenueAutopilot,
  getRevenueAutopilotState,
  runRevenueAutopilotIfDue,
} from "./autopilot.js";
import { runRevenueDailyRoutine, runWeeklyCapitalReview } from "./jobs.js";

describe("revenue autopilot", () => {
  beforeEach(() => {
    vi.mocked(runRevenueDailyRoutine).mockClear();
    vi.mocked(runWeeklyCapitalReview).mockClear();
  });

  it("runs daily and weekly once when enabled", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revenue-autopilot-"));
    try {
      await configureRevenueAutopilot({
        revenueRootDir: rootDir,
        enabled: true,
        demandLimit: 8,
        outreachMaxDrafts: 4,
        deliveryLimit: 3,
      });

      const monday = new Date(2026, 1, 16, 9, 0, 0, 0).getTime();
      const firstRun = await runRevenueAutopilotIfDue({ revenueRootDir: rootDir, now: monday });

      expect(firstRun.ranDaily).toBe(true);
      expect(firstRun.ranWeekly).toBe(true);
      expect(runRevenueDailyRoutine).toHaveBeenCalledOnce();
      expect(runWeeklyCapitalReview).toHaveBeenCalledOnce();

      const secondRun = await runRevenueAutopilotIfDue({ revenueRootDir: rootDir, now: monday });
      expect(secondRun.ranDaily).toBe(false);
      expect(secondRun.ranWeekly).toBe(false);

      const tuesday = new Date(2026, 1, 17, 9, 0, 0, 0).getTime();
      const thirdRun = await runRevenueAutopilotIfDue({ revenueRootDir: rootDir, now: tuesday });
      expect(thirdRun.ranDaily).toBe(true);
      expect(thirdRun.ranWeekly).toBe(false);
      expect(runRevenueDailyRoutine).toHaveBeenCalledTimes(2);
      expect(runWeeklyCapitalReview).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("stores and reports disabled state", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revenue-autopilot-"));
    try {
      await configureRevenueAutopilot({ revenueRootDir: rootDir, enabled: false });
      const state = await getRevenueAutopilotState({ revenueRootDir: rootDir });
      expect(state.enabled).toBe(false);

      const now = new Date(2026, 1, 16, 9, 0, 0, 0).getTime();
      const run = await runRevenueAutopilotIfDue({ revenueRootDir: rootDir, now });
      expect(run.ranDaily).toBe(false);
      expect(run.ranWeekly).toBe(false);
      expect(runRevenueDailyRoutine).not.toHaveBeenCalled();
      expect(runWeeklyCapitalReview).not.toHaveBeenCalled();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
