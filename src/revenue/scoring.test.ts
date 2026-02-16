import { describe, expect, it } from "vitest";
import { DEFAULT_REVENUE_CONFIG } from "./config.js";
import { deriveTimeToCashScore, scoreOpportunity } from "./scoring.js";

describe("revenue scoring", () => {
  it("maps expected days to configured time-to-cash bands", () => {
    expect(deriveTimeToCashScore(6, DEFAULT_REVENUE_CONFIG)).toBe(100);
    expect(deriveTimeToCashScore(14, DEFAULT_REVENUE_CONFIG)).toBe(85);
    expect(deriveTimeToCashScore(35, DEFAULT_REVENUE_CONFIG)).toBe(30);
  });

  it("produces go when metrics and cash cycle pass thresholds", () => {
    const scored = scoreOpportunity(
      {
        title: "AI Listing Optimization",
        projectId: "svc",
        demand: 90,
        pricingPower: 82,
        competition: 35,
        regRisk: 10,
        speedToValidation: 84,
        marginPotential: 85,
        deliveryEffort: 22,
        channelFriction: 15,
        refundSupportRisk: 10,
        expectedDaysToFirstRevenue: 7,
        paybackDaysEstimate: 14,
        confidence: 1,
      },
      DEFAULT_REVENUE_CONFIG,
      1_700_000_000_000,
    );

    expect(scored.decision).toBe("go");
    expect(scored.score).toBeGreaterThanOrEqual(DEFAULT_REVENUE_CONFIG.thresholds.goMin);
    expect(scored.timeToCashScore).toBeGreaterThanOrEqual(85);
  });

  it("blocks go decision when cash cycle exceeds threshold", () => {
    const scored = scoreOpportunity(
      {
        title: "Slow Enterprise Offer",
        projectId: "svc",
        demand: 92,
        pricingPower: 80,
        competition: 35,
        regRisk: 20,
        speedToValidation: 70,
        marginPotential: 82,
        deliveryEffort: 20,
        channelFriction: 25,
        refundSupportRisk: 10,
        expectedDaysToFirstRevenue: 45,
        paybackDaysEstimate: 60,
      },
      DEFAULT_REVENUE_CONFIG,
      1_700_000_000_001,
    );

    expect(scored.decision).not.toBe("go");
    expect(scored.reasons.join(" ")).toContain("Cash cycle exceeds threshold");
  });

  it("forces final decision after research timeout", () => {
    const scored = scoreOpportunity(
      {
        title: "Borderline niche",
        projectId: "svc",
        demand: 78,
        pricingPower: 70,
        competition: 45,
        regRisk: 30,
        speedToValidation: 68,
        marginPotential: 68,
        deliveryEffort: 35,
        channelFriction: 35,
        refundSupportRisk: 25,
        expectedDaysToFirstRevenue: 18,
        paybackDaysEstimate: 20,
        researchPassCount: 4,
      },
      DEFAULT_REVENUE_CONFIG,
      1_700_000_000_002,
    );

    expect(scored.forcedDecision).toBe(true);
    expect(scored.decision).not.toBe("watch");
  });
});
