import type { CommandHandler } from "./commands-types.js";
import { logVerbose } from "../../globals.js";
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

function isRevenueCommand(normalizedBody: string): boolean {
  return normalizedBody === "/revenue" || normalizedBody.startsWith("/revenue ");
}

function parseRevenueAction(normalizedBody: string): {
  action: string;
  options: string;
} {
  const rest = normalizedBody.replace(/^\/revenue\s*/i, "").trim();
  if (!rest) {
    return { action: "help", options: "" };
  }
  const [actionRaw, ...restParts] = rest.split(/\s+/);
  return {
    action: (actionRaw ?? "help").trim().toLowerCase(),
    options: restParts.join(" ").trim(),
  };
}

function buildRevenueUsage(): string {
  return [
    "Revenue command usage:",
    "- /revenue checklist",
    "- /revenue daily [--limit N] [--max-drafts N] [--delivery-limit N] [--keep-inbox]",
    "- /revenue autopilot status",
    "- /revenue autopilot on [--limit N] [--max-drafts N] [--delivery-limit N] [--keep-inbox]",
    "- /revenue autopilot off",
    "- /revenue baseline",
    "- /revenue demand",
    "- /revenue outreach",
    "- /revenue delivery",
    "- /revenue report",
    "- /revenue weekly",
    "- /revenue seed",
    "- /revenue evaluate",
    "- /revenue paid <projectId> <amountUsd> [notes]",
    "",
    "Notes:",
    "- Data lives under ~/.openclaw/revenue by default",
    "- Seed candidates at revenue/inbox/opportunity-candidates.jsonl",
  ].join("\n");
}

function buildRevenueChecklist(): string {
  return [
    "Revenue checklist (simple):",
    "",
    "Daily (one command):",
    "1) /revenue daily",
    "2) When cash comes in: /revenue paid <projectId> <amountUsd> [notes]",
    "",
    "Set-and-forget mode:",
    "1) /revenue autopilot on",
    "2) /revenue autopilot status",
    "",
    "Weekly:",
    "1) /revenue weekly",
    "",
    "Manual fallback (if you want step-by-step):",
    "1) /revenue demand",
    "2) /revenue seed",
    "3) /revenue outreach",
    "4) /revenue delivery",
    "5) /revenue evaluate",
    "6) /revenue report",
    "",
    "Memory trick: Scan -> Seed -> Sell -> Ship -> Score -> Summary",
  ].join("\n");
}

function boolOption(options: string, key: string): boolean {
  if (!options) {
    return false;
  }
  const lower = options.toLowerCase();
  return lower.includes(`--${key}`);
}

function parsePositiveIntOption(options: string, key: string): number | undefined {
  if (!options) {
    return undefined;
  }
  const match = options.match(new RegExp(`--${key}\\s+(\\d+)`, "i"));
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parseSubAction(options: string): { action: string; options: string } {
  const trimmed = options.trim();
  if (!trimmed) {
    return { action: "status", options: "" };
  }
  const [actionRaw, ...restParts] = trimmed.split(/\s+/);
  return {
    action: (actionRaw ?? "status").trim().toLowerCase(),
    options: restParts.join(" ").trim(),
  };
}

function parsePaidArgs(options: string): {
  projectId: string;
  amountUsd: number;
  notes?: string;
} | null {
  if (!options) {
    return null;
  }
  const [projectIdRaw, amountRaw, ...noteParts] = options.trim().split(/\s+/);
  if (!projectIdRaw || !amountRaw) {
    return null;
  }
  const amountUsd = Number.parseFloat(amountRaw);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return null;
  }
  const notes = noteParts.join(" ").trim();
  return {
    projectId: projectIdRaw.trim(),
    amountUsd: Number(amountUsd.toFixed(2)),
    notes: notes.length > 0 ? notes : undefined,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const handleRevenueCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalizedBody = params.command.commandBodyNormalized;
  if (!isRevenueCommand(normalizedBody)) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /revenue from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const parsed = parseRevenueAction(normalizedBody);

  try {
    if (parsed.action === "help") {
      return {
        shouldContinue: false,
        reply: { text: buildRevenueUsage() },
      };
    }

    if (parsed.action === "checklist" || parsed.action === "plan") {
      return {
        shouldContinue: false,
        reply: { text: buildRevenueChecklist() },
      };
    }

    if (parsed.action === "daily" || parsed.action === "today") {
      const dailyResult = await runRevenueDailyRoutine({
        keepInbox: boolOption(parsed.options, "keep-inbox"),
        demandLimit: parsePositiveIntOption(parsed.options, "limit"),
        outreachMaxDrafts: parsePositiveIntOption(parsed.options, "max-drafts"),
        deliveryLimit: parsePositiveIntOption(parsed.options, "delivery-limit"),
      });

      const nextSteps: string[] = [];
      if (dailyResult.demand.goCount <= 0) {
        nextSteps.push("Add better opportunities to inbox; no GO opportunities found today.");
      }
      if (!dailyResult.seed.created) {
        nextSteps.push("No experiment seeded; run more demand scans before next seed.");
      }
      if (dailyResult.outreach.pending > 0) {
        nextSteps.push("Review pending outreach approvals to unlock sending.");
      }
      if (dailyResult.report.summary.paidSignals <= 0) {
        nextSteps.push(
          "Log every payment with /revenue paid so allocation decisions stay accurate.",
        );
      }
      if (nextSteps.length === 0) {
        nextSteps.push("Keep cadence tomorrow with /revenue daily.");
      }

      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue daily routine complete.",
            `- Demand Go/Watch/No-Go: ${dailyResult.demand.goCount}/${dailyResult.demand.watchCount}/${dailyResult.demand.noGoCount}`,
            `- Experiment seeded: ${dailyResult.seed.created ? "yes" : "no"} (${dailyResult.seed.experimentId ?? "n/a"})`,
            `- Outreach drafted/pending: ${dailyResult.outreach.drafted}/${dailyResult.outreach.pending}`,
            `- Deliverables generated: ${dailyResult.delivery.generated}`,
            `- Experiments evaluated (pass/kill/hold): ${dailyResult.evaluate.passed}/${dailyResult.evaluate.killed}/${dailyResult.evaluate.held}`,
            `- Revenue today: $${dailyResult.report.summary.revenueUsd.toFixed(2)}`,
            "",
            "Next actions:",
            ...nextSteps.map((step) => `- ${step}`),
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "autopilot" || parsed.action === "auto") {
      const sub = parseSubAction(parsed.options);
      if (sub.action === "status") {
        const state = await getRevenueAutopilotState();
        return {
          shouldContinue: false,
          reply: {
            text: [
              "Revenue autopilot status:",
              `- Enabled: ${state.enabled ? "yes" : "no"}`,
              `- Demand limit: ${state.demandLimit ?? "default"}`,
              `- Outreach max drafts: ${state.outreachMaxDrafts ?? "default"}`,
              `- Delivery limit: ${state.deliveryLimit ?? "default"}`,
              `- Keep inbox: ${state.keepInbox ? "yes" : "no"}`,
              `- Last daily run: ${state.lastDailyRunDate ?? "never"}`,
              `- Last weekly run: ${state.lastWeeklyRunKey ?? "never"}`,
              `- Last error: ${state.lastError ?? "none"}`,
            ].join("\n"),
          },
        };
      }

      if (sub.action === "on" || sub.action === "enable") {
        const updated = await configureRevenueAutopilot({
          enabled: true,
          keepInbox: boolOption(sub.options, "keep-inbox"),
          demandLimit: parsePositiveIntOption(sub.options, "limit"),
          outreachMaxDrafts: parsePositiveIntOption(sub.options, "max-drafts"),
          deliveryLimit: parsePositiveIntOption(sub.options, "delivery-limit"),
        });
        const warmup = await runRevenueAutopilotIfDue({ forceDaily: true });
        return {
          shouldContinue: false,
          reply: {
            text: [
              "Revenue autopilot enabled.",
              `- Demand limit: ${updated.demandLimit ?? "default"}`,
              `- Outreach max drafts: ${updated.outreachMaxDrafts ?? "default"}`,
              `- Delivery limit: ${updated.deliveryLimit ?? "default"}`,
              `- Keep inbox: ${updated.keepInbox ? "yes" : "no"}`,
              `- Warmup run daily: ${warmup.ranDaily ? "yes" : "no"}`,
              warmup.errors.length > 0
                ? `- Warmup errors: ${warmup.errors.join(" | ")}`
                : "- Warmup errors: none",
            ].join("\n"),
          },
        };
      }

      if (sub.action === "off" || sub.action === "disable") {
        await configureRevenueAutopilot({ enabled: false });
        return {
          shouldContinue: false,
          reply: {
            text: "Revenue autopilot disabled.",
          },
        };
      }

      if (sub.action === "run") {
        const ran = await runRevenueAutopilotIfDue({ forceDaily: true, forceWeekly: true });
        return {
          shouldContinue: false,
          reply: {
            text: [
              "Revenue autopilot run complete.",
              `- Daily ran: ${ran.ranDaily ? "yes" : "no"}`,
              `- Weekly ran: ${ran.ranWeekly ? "yes" : "no"}`,
              ran.errors.length > 0 ? `- Errors: ${ran.errors.join(" | ")}` : "- Errors: none",
            ].join("\n"),
          },
        };
      }

      return {
        shouldContinue: false,
        reply: {
          text: "Usage: /revenue autopilot status | on [--limit N] [--max-drafts N] [--delivery-limit N] [--keep-inbox] | off | run",
        },
      };
    }

    if (parsed.action === "baseline") {
      const result = await runBaselineSnapshot();
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue baseline complete.",
            `- Opportunities: ${result.snapshot.opportunitiesCount}`,
            `- Active experiments: ${result.snapshot.activeExperimentsCount}`,
            `- Pending approvals: ${result.snapshot.approvalsPendingCount}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "demand" || parsed.action === "scan") {
      const result = await runDailyDemandScan({
        consumeInbox: !boolOption(parsed.options, "keep-inbox"),
        limit: parsePositiveIntOption(parsed.options, "limit"),
      });
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue demand scan complete.",
            `- Processed: ${result.processed}`,
            `- Inserted: ${result.inserted}`,
            `- Go/Watch/No-Go: ${result.goCount}/${result.watchCount}/${result.noGoCount}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "outreach") {
      const result = await runDailyOutreachBatch({
        maxDrafts: parsePositiveIntOption(parsed.options, "max-drafts"),
      });
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue outreach batch complete.",
            `- Drafted: ${result.drafted}`,
            `- Auto-approved: ${result.autoApproved}`,
            `- Pending: ${result.pending}`,
            `- Rejected: ${result.rejected}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "delivery") {
      const result = await runWeekdayDeliveryBatch({
        limit: parsePositiveIntOption(parsed.options, "limit"),
      });
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue delivery batch complete.",
            `- Generated: ${result.generated}`,
            `- Approvals queued: ${result.approvalsQueued}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "report") {
      const result = await runDailyRevenueReport();
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Daily revenue report complete.",
            `- Revenue: $${result.summary.revenueUsd.toFixed(2)}`,
            `- Cash spent: $${result.summary.cashSpentUsd.toFixed(2)}`,
            `- Hours: ${result.summary.hoursSpent.toFixed(2)}`,
            `- Go/Watch/No-Go: ${result.summary.goCount}/${result.summary.watchCount}/${result.summary.noGoCount}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "weekly") {
      const result = await runWeeklyCapitalReview();
      const top = result.decisions[0];
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Weekly capital review complete.",
            `- Cash buffer: $${result.cashBufferUsd.toFixed(2)}`,
            `- Decisions: ${result.decisions.length}`,
            top
              ? `- Top: ${top.projectId} => ${top.action.toUpperCase()} (score ${top.adjustedScore.toFixed(1)})`
              : "- Top: none",
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "seed") {
      const result = await seedExperimentFromTopGoOpportunity();
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Experiment seed complete.",
            `- Created: ${result.created ? "yes" : "no"}`,
            `- Experiment: ${result.experimentId ?? "n/a"}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "evaluate") {
      const result = await runExperimentEvaluation();
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Experiment evaluation complete.",
            `- Evaluated: ${result.evaluated}`,
            `- Passed/Killed/Held: ${result.passed}/${result.killed}/${result.held}`,
            `- Report: ${result.reportPath}`,
          ].join("\n"),
        },
      };
    }

    if (parsed.action === "paid") {
      const paidArgs = parsePaidArgs(parsed.options);
      if (!paidArgs) {
        return {
          shouldContinue: false,
          reply: {
            text: "Usage: /revenue paid <projectId> <amountUsd> [notes]",
          },
        };
      }
      const result = await recordRevenueLedgerEvent({
        type: "revenue_received",
        projectId: paidArgs.projectId,
        amountUsd: paidArgs.amountUsd,
        notes: paidArgs.notes,
      });
      return {
        shouldContinue: false,
        reply: {
          text: [
            "Revenue payment logged.",
            `- Project: ${result.event.projectId}`,
            `- Amount: $${paidArgs.amountUsd.toFixed(2)}`,
            `- Ledger: ${result.ledgerPath}`,
          ].join("\n"),
        },
      };
    }

    return {
      shouldContinue: false,
      reply: {
        text: `Unknown /revenue action: ${parsed.action}\n\n${buildRevenueUsage()}`,
      },
    };
  } catch (error) {
    return {
      shouldContinue: false,
      reply: {
        text: `Revenue command failed: ${formatError(error)}`,
      },
    };
  }
};

export async function runRevenueAutopilotOnMessage(params: {
  surface: string;
  isAuthorizedSender: boolean;
  normalizedBody: string;
}): Promise<void> {
  if (!params.isAuthorizedSender) {
    return;
  }
  if (params.surface !== "telegram") {
    return;
  }
  if (params.normalizedBody.startsWith("/")) {
    return;
  }
  if (isRevenueCommand(params.normalizedBody)) {
    return;
  }
  const result = await runRevenueAutopilotIfDue();
  if (result.errors.length > 0) {
    logVerbose(`Revenue autopilot errors: ${result.errors.join(" | ")}`);
  }
}
