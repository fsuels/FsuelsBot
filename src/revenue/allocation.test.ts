import { describe, expect, it } from "vitest";
import { allocateWeeklyCapital } from "./allocation.js";
import { DEFAULT_REVENUE_CONFIG } from "./config.js";

describe("revenue allocation", () => {
  it("prioritizes high liquidity and ROI in low-cash mode", () => {
    const decisions = allocateWeeklyCapital({
      config: DEFAULT_REVENUE_CONFIG,
      cashBufferUsd: 500,
      projects: [
        {
          projectId: "fast",
          revenueUsd: 300,
          cashSpentUsd: 120,
          hoursSpent: 8,
          expectedDaysToFirstRevenue: 7,
          signalQualityScore: 80,
          activeExperiments: 1,
        },
        {
          projectId: "slow",
          revenueUsd: 0,
          cashSpentUsd: 90,
          hoursSpent: 7,
          expectedDaysToFirstRevenue: 40,
          signalQualityScore: 45,
          activeExperiments: 1,
        },
      ],
    });

    const fast = decisions.find((decision) => decision.projectId === "fast");
    const slow = decisions.find((decision) => decision.projectId === "slow");
    expect(fast?.action).not.toBe("kill");
    expect(slow?.action).toBe("kill");
  });

  it("enforces max per-project share", () => {
    const decisions = allocateWeeklyCapital({
      config: DEFAULT_REVENUE_CONFIG,
      cashBufferUsd: 1000,
      projects: [
        {
          projectId: "one",
          revenueUsd: 0,
          cashSpentUsd: 0,
          hoursSpent: 6,
          expectedDaysToFirstRevenue: 8,
          signalQualityScore: 45,
          activeExperiments: 1,
        },
      ],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.targetHours).toBeLessThanOrEqual(
      DEFAULT_REVENUE_CONFIG.capitalLimits.maxWeeklyHours *
        DEFAULT_REVENUE_CONFIG.capitalLimits.maxProjectShare,
    );
    expect(decisions[0]?.targetCashUsd).toBeLessThanOrEqual(
      DEFAULT_REVENUE_CONFIG.capitalLimits.maxWeeklyCashBurnUsd *
        DEFAULT_REVENUE_CONFIG.capitalLimits.maxProjectShare,
    );
  });

  it("applies post-signal concentration to top project", () => {
    const decisions = allocateWeeklyCapital({
      config: DEFAULT_REVENUE_CONFIG,
      cashBufferUsd: 1000,
      projects: [
        {
          projectId: "winner",
          revenueUsd: 200,
          cashSpentUsd: 0,
          hoursSpent: 5,
          expectedDaysToFirstRevenue: 7,
          signalQualityScore: 92,
          activeExperiments: 1,
        },
        {
          projectId: "contender-a",
          revenueUsd: 0,
          cashSpentUsd: 0,
          hoursSpent: 4,
          expectedDaysToFirstRevenue: 9,
          signalQualityScore: 40,
          activeExperiments: 1,
        },
        {
          projectId: "contender-b",
          revenueUsd: 0,
          cashSpentUsd: 0,
          hoursSpent: 4,
          expectedDaysToFirstRevenue: 9,
          signalQualityScore: 40,
          activeExperiments: 1,
        },
      ],
    });

    const winner = decisions.find((decision) => decision.projectId === "winner");
    expect(winner?.action).not.toBe("kill");
    expect(winner?.targetHours).toBeGreaterThanOrEqual(
      DEFAULT_REVENUE_CONFIG.capitalLimits.maxWeeklyHours *
        DEFAULT_REVENUE_CONFIG.capitalLimits.postSignalTopShare,
    );
  });
});
