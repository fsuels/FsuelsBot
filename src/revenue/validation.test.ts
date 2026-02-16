import { describe, expect, it } from "vitest";
import { DEFAULT_REVENUE_CONFIG } from "./config.js";
import { createExperimentFromTemplate, evaluateExperiment } from "./validation.js";

describe("revenue validation", () => {
  it("kills outbound experiment on day 7 when replies are weak", () => {
    const experiment = createExperimentFromTemplate({
      projectId: "svc",
      title: "Outbound test",
      template: "outbound",
      config: DEFAULT_REVENUE_CONFIG,
      expectedDaysToFirstRevenue: 18,
      now: 1_700_000_000_000,
    });

    const evaluation = evaluateExperiment({
      experiment: {
        ...experiment,
        metrics: {
          outboundSends: 20,
          qualifiedReplies: 1,
          paidSignals: 0,
        },
      },
      checkpoint: "day7",
      config: DEFAULT_REVENUE_CONFIG,
    });

    expect(evaluation.decision).toBe("kill");
    expect(evaluation.nextStatus).toBe("killed");
  });

  it("passes outbound experiment on day 14 with paid signal", () => {
    const experiment = createExperimentFromTemplate({
      projectId: "svc",
      title: "Outbound pass",
      template: "outbound",
      config: DEFAULT_REVENUE_CONFIG,
      now: 1_700_000_000_001,
    });

    const evaluation = evaluateExperiment({
      experiment: {
        ...experiment,
        metrics: {
          outboundSends: 18,
          qualifiedReplies: 4,
          paidSignals: 1,
        },
      },
      checkpoint: "day14",
      config: DEFAULT_REVENUE_CONFIG,
    });

    expect(evaluation.decision).toBe("pass");
    expect(evaluation.nextStatus).toBe("passed");
  });

  it("does not auto-pass custom template with empty criteria", () => {
    const experiment = createExperimentFromTemplate({
      projectId: "svc",
      title: "Custom eval",
      template: "custom",
      config: DEFAULT_REVENUE_CONFIG,
      now: 1_700_000_000_002,
    });

    const evaluation = evaluateExperiment({
      experiment,
      checkpoint: "day7",
      config: DEFAULT_REVENUE_CONFIG,
    });

    expect(evaluation.decision).toBe("hold");
  });

  it("kills unresolved custom experiment at day 14 hard gate", () => {
    const experiment = createExperimentFromTemplate({
      projectId: "svc",
      title: "Custom day14 kill",
      template: "custom",
      config: DEFAULT_REVENUE_CONFIG,
      now: 1_700_000_000_003,
    });

    const evaluation = evaluateExperiment({
      experiment,
      checkpoint: "day14",
      config: DEFAULT_REVENUE_CONFIG,
    });

    expect(evaluation.decision).toBe("kill");
    expect(evaluation.nextStatus).toBe("killed");
  });
});
