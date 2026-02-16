import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RevenueExperimentRecord, RevenueLedgerEvent } from "./types.js";
import { recordRevenueLedgerEvent, runWeeklyCapitalReview } from "./jobs.js";
import { createLedgerEvent } from "./ledger.js";
import {
  appendJsonlLine,
  ensureRevenueDirs,
  readJsonlFile,
  resolveRevenuePaths,
  writeJsonFile,
} from "./store.js";

function buildExperiment(params: {
  id: string;
  projectId: string;
  status: RevenueExperimentRecord["status"];
  createdAt: number;
  expectedDaysToFirstRevenue?: number;
}): RevenueExperimentRecord {
  return {
    id: params.id,
    projectId: params.projectId,
    title: params.id,
    template: "outbound",
    status: params.status,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
    startedAt: params.createdAt,
    budgetUsd: 100,
    budgetHours: 4,
    expectedDaysToFirstRevenue: params.expectedDaysToFirstRevenue ?? 7,
    paybackTargetDays: 21,
    passCriteria: {},
    killDay7Criteria: {},
    killDay14Criteria: {},
    metrics: {},
  };
}

describe("revenue jobs", () => {
  it("records paid signals to ledger", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revenue-jobs-"));
    try {
      const result = await recordRevenueLedgerEvent({
        type: "revenue_received",
        projectId: "svc-main",
        amountUsd: 149,
        notes: "pilot",
        ts: 1_700_000_000_000,
        revenueRootDir: rootDir,
      });

      const paths = resolveRevenuePaths({ revenueRootDir: rootDir });
      const events = await readJsonlFile<RevenueLedgerEvent>(paths.ledgerPath);

      expect(result.ledgerPath).toBe(paths.ledgerPath);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("revenue_received");
      expect(events[0]?.projectId).toBe("svc-main");
      expect(events[0]?.amountUsd).toBe(149);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("forces at least one kill when 14-day kill rate is below floor", async () => {
    const now = 1_700_000_000_000;
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revenue-jobs-"));
    try {
      const paths = resolveRevenuePaths({ revenueRootDir: rootDir });
      await ensureRevenueDirs(paths);

      const experiments: RevenueExperimentRecord[] = [
        buildExperiment({
          id: "exp-winner",
          projectId: "winner",
          status: "active",
          createdAt: now - 2 * 24 * 60 * 60 * 1000,
        }),
        buildExperiment({
          id: "exp-a",
          projectId: "contender-a",
          status: "active",
          createdAt: now - 2 * 24 * 60 * 60 * 1000,
        }),
        buildExperiment({
          id: "exp-b",
          projectId: "contender-b",
          status: "active",
          createdAt: now - 3 * 24 * 60 * 60 * 1000,
        }),
      ];
      await writeJsonFile(paths.experimentsPath, experiments);

      await appendJsonlLine(
        paths.ledgerPath,
        createLedgerEvent({
          type: "revenue_received",
          projectId: "winner",
          amountUsd: 200,
          ts: now - 12 * 60 * 60 * 1000,
        }),
      );

      const result = await runWeeklyCapitalReview({
        revenueRootDir: rootDir,
        now,
      });

      const forced = result.decisions.find((decision) =>
        decision.reasons.some((reason) => reason.includes("Forced kill")),
      );
      expect(forced).toBeDefined();
      expect(forced?.action).toBe("kill");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
